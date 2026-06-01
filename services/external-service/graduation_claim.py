"""
Graduation handover claim: validate magic-link token, create Cognito user,
assign FORMER_STUDENT, link UIN.
"""

import hashlib
import os
from datetime import datetime, timezone
from typing import Optional

import boto3

import auth
import db
import handover

HANDOVER_TOKENS_TABLE = os.environ.get("HANDOVER_TOKENS_TABLE", "cmis-external-handover-tokens")
dynamo = boto3.resource("dynamodb")
tokens_table = dynamo.Table(HANDOVER_TOKENS_TABLE)


def get_token_info(token: str) -> Optional[dict]:
    """
    Validate token and return { uin, personal_email, class_year } if valid.
    Returns None if token invalid, expired, or already claimed.
    """
    token = (token or "").strip()
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    r = tokens_table.get_item(Key={"token_hash": token_hash})
    item = r.get("Item")
    if not item:
        return None
    if item.get("claimed"):
        return None
    if item.get("expires_at", 0) < int(datetime.now(timezone.utc).timestamp()):
        return None

    return {
        "uin": item.get("uin"),
        "personal_email": (item.get("personal_email") or "").strip().lower(),
        "class_year": (item.get("class_year") or "").strip() or None,
    }


def claim_with_password(token: str, password: str) -> dict:
    """
    Validate token, create Cognito user with password, mark token claimed,
    link UIN and assign FORMER_STUDENT. Returns user info or error.
    """
    info = get_token_info(token)
    if not info:
        return {"error": "Invalid or expired token", "status": 400}

    email = info["personal_email"]
    uin = info["uin"]
    class_year = info["class_year"]

    if not password or len(password) < 10:
        return {"error": "Password must be at least 10 characters", "status": 400}

    # Check if email already has account
    existing_user = db.get_user_by_email(email)
    if existing_user:
        if existing_user.get("linked_uin"):
            return {"error": "This email is already linked to a student UIN", "status": 409}
        user_id = existing_user.get("user_id")
    else:
        try:
            signup_result = auth.sign_up(email, password)
            user_id = signup_result.get("UserSub")
            if not user_id:
                return {"error": "Registration failed", "status": 500}
        except auth.client.exceptions.UsernameExistsException:
            return {"error": "An account with this email already exists. Log in and use Graduation Handover.", "status": 409}
        except Exception as e:
            return {"error": f"Registration failed: {e}", "status": 500}

        auth.admin_confirm_sign_up(email)
        db.put_user(
            user_id=user_id,
            email=email,
            role="FRIEND",
            class_year=class_year,
            linked_uin=None,
        )

    # Link UIN (creates/updates DynamoDB, Cognito attrs)
    result = handover.link_uin_to_user(user_id, uin, class_year, personal_email=email)
    if "error" in result:
        return result

    # Mark token as claimed
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    tokens_table.update_item(
        Key={"token_hash": token_hash},
        UpdateExpression="SET claimed = :c",
        ExpressionAttributeValues={":c": True},
    )

    # Send confirmation email (SES) if configured
    _send_account_confirmation_email(email, uin)

    return result


def _send_account_confirmation_email(email: str, uin: str) -> None:
    """Send welcome/confirmation email when account is successfully created via claim."""
    ses_sender = os.environ.get("SES_VERIFIED_SENDER")
    if not ses_sender:
        return
    try:
        ses = boto3.client("ses")
        ses.send_email(
            Source=ses_sender,
            Destination={"ToAddresses": [email]},
            Message={
                "Subject": {"Data": "Welcome back! Your CMIS graduate account is ready"},
                "Body": {
                    "Text": {
                        "Data": f"""Welcome back!

Your CMIS graduate account has been successfully created. Your student UIN ({uin}) is now linked to this account, and your role has been set to FORMER_STUDENT.

You can log in anytime with the email and password you set. If you have any questions, please contact support.

— CMIS Engagement Platform"""
                    }
                },
            },
        )
        print(f"[graduation_claim] Confirmation email sent to {email} (UIN {uin})")
    except Exception as e:
        print(f"[graduation_claim] Failed to send confirmation email to {email}: {e}")
