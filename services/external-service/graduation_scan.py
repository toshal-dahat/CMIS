"""
Graduation handover scan: find students with Grad Date <= today, AccountStatus = STUDENT,
generate magic-link tokens, and deliver them (email or log for dev).
"""

import os
import secrets
import hashlib
from datetime import datetime, timezone

import boto3

STUDENTS_TABLE = os.environ.get("STUDENTS_TABLE", "cmis-external-students")
HANDOVER_TOKENS_TABLE = os.environ.get("HANDOVER_TOKENS_TABLE", "cmis-external-handover-tokens")
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")
TOKEN_TTL_SECONDS = 7 * 24 * 3600  # 7 days

dynamo = boto3.resource("dynamodb")
students_table = dynamo.Table(STUDENTS_TABLE)
tokens_table = dynamo.Table(HANDOVER_TOKENS_TABLE)


def run_scan() -> dict:
    """
    Scan students table for account_status=STUDENT and grad_date <= today.
    For each, generate token, store in handover_tokens, and deliver magic link.
    Returns summary of processed students.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    response = students_table.query(
        IndexName="grad-status-index",
        KeyConditionExpression="account_status = :s AND grad_date <= :d",
        ExpressionAttributeValues={":s": "STUDENT", ":d": today},
    )
    items = response.get("Items", [])
    while "LastEvaluatedKey" in response:
        response = students_table.query(
            IndexName="grad-status-index",
            KeyConditionExpression="account_status = :s AND grad_date <= :d",
            ExpressionAttributeValues={":s": "STUDENT", ":d": today},
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        items.extend(response.get("Items", []))

    processed = 0
    errors = []

    for student in items:
        uin = student.get("uin")
        personal_email = (student.get("personal_email") or "").strip()
        tamu_email = (student.get("tamu_email") or "").strip().lower() or None
        class_year = (student.get("class_year") or "").strip() or None

        if not uin or not personal_email or "@" not in personal_email:
            errors.append(f"Skip uin={uin}: missing personal_email")
            continue

        try:
            raw_token = secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
            expires_at = int(datetime.now(timezone.utc).timestamp()) + TOKEN_TTL_SECONDS

            tokens_table.put_item(
                Item={
                    "token_hash": token_hash,
                    "uin": uin,
                    "personal_email": personal_email,
                    "tamu_email": tamu_email or "",
                    "class_year": class_year or "",
                    "expires_at": expires_at,
                    "claimed": False,
                }
            )

            magic_link = f"{FRONTEND_BASE_URL.rstrip('/')}/#claim?token={raw_token}"
            _deliver_magic_link(personal_email, magic_link, uin)
            processed += 1
        except Exception as e:
            errors.append(f"uin={uin}: {e}")

    return {"processed": processed, "total_eligible": len(items), "errors": errors}


def _deliver_magic_link(email: str, magic_link: str, uin: str) -> None:
    """Send magic link via SES or log for dev. SES requires verified sender."""
    ses_sender = os.environ.get("SES_VERIFIED_SENDER")
    if ses_sender:
        try:
            ses = boto3.client("ses")
            ses.send_email(
                Source=ses_sender,
                Destination={"ToAddresses": [email]},
                Message={
                    "Subject": {"Data": "Confirm your email address - CMIS graduate account"},
                    "Body": {
                        "Text": {
                            "Data": f"""Hello,

This is the magic link for your graduation handover.

Click the link below to confirm your email and set up your account (expires in 7 days):
{magic_link}

If you did not request this, you can ignore this email."""
                        }
                    },
                },
            )
            print(f"[graduation_scan] Email sent to {email} (UIN {uin})")
            return
        except Exception as e:
            print(f"[graduation_scan] SES failed for {email}: {e}; falling back to log")
    # Dev / no SES: log the link so we can test
    print(f"[graduation_scan] Magic link for {email} (UIN {uin}): {magic_link}")


def request_magic_link_for_email(email: str) -> dict:
    """
    Self-service: user requests magic link by entering their personal email.
    Looks up eligible student, generates token, delivers via SES or returns link for dev.
    Returns { success, message, magicLink? } or { error, ... }.
    """
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return {"error": "Valid email is required", "status": 400}

    ses_sender = os.environ.get("SES_VERIFIED_SENDER")

    response = students_table.scan(
        FilterExpression="personal_email = :e AND account_status = :s",
        ExpressionAttributeValues={
            ":e": email,
            ":s": "STUDENT",
        },
    )
    items = response.get("Items", [])
    while "LastEvaluatedKey" in response:
        response = students_table.scan(
            FilterExpression="personal_email = :e AND account_status = :s",
            ExpressionAttributeValues={":e": email, ":s": "STUDENT"},
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        items.extend(response.get("Items", []))

    if not items:
        return {"error": "No eligible graduate account found for this email. Check the spelling (e.g. double letters). If you recently graduated, your record may not be processed yet.", "status": 404}

    student = items[0]
    uin = student.get("uin")
    personal_email = (student.get("personal_email") or "").strip()
    tamu_email = (student.get("tamu_email") or "").strip().lower() or None
    class_year = (student.get("class_year") or "").strip() or None

    try:
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        expires_at = int(datetime.now(timezone.utc).timestamp()) + TOKEN_TTL_SECONDS

        tokens_table.put_item(
            Item={
                "token_hash": token_hash,
                "uin": uin,
                "personal_email": personal_email,
                "tamu_email": tamu_email or "",
                "class_year": class_year or "",
                "expires_at": expires_at,
                "claimed": False,
            }
        )

        magic_link = f"{FRONTEND_BASE_URL.rstrip('/')}/#claim?token={raw_token}"
        _deliver_magic_link(personal_email, magic_link, uin)

        if ses_sender:
            return {"success": True, "message": "Check your email for the claim link. It expires in 7 days."}
        return {"success": True, "message": "Your claim link is ready.", "magicLink": magic_link}
    except Exception as e:
        return {"error": f"Failed to generate link: {e}", "status": 500}
