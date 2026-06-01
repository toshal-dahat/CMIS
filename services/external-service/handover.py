"""
Graduation Handover: link a new external account to an old Student UIN,
transferring history and setting primary role to FORMER_STUDENT.
"""

import os
from typing import Optional

import boto3
import db
import auth

STUDENTS_TABLE = os.environ.get("STUDENTS_TABLE", "cmis-external-students")
dynamo = boto3.resource("dynamodb")
students_table = dynamo.Table(STUDENTS_TABLE)


def link_uin_to_user(
    user_id: str,
    uin: str,
    class_year: Optional[str] = None,
    personal_email: Optional[str] = None,
) -> dict:
    """
    Link external user to student UIN (graduation handover).
    - Validates user exists and UIN not already linked to another account.
    - Updates DynamoDB: role=FORMER_STUDENT, linked_uin=uin.
    - Updates Cognito custom attributes.
    Returns updated user info.
    """
    existing = db.get_user_by_id(user_id)
    if not existing:
        return {"error": "User not found", "status": 404}

    if existing.get("linked_uin"):
        return {"error": "Account already linked to a student UIN", "status": 409}

    other = db.get_user_by_linked_uin(uin)
    if other and other.get("user_id") != user_id:
        return {"error": "This UIN is already linked to another account", "status": 409}

    uin_clean = str(uin).strip()
    if not uin_clean:
        return {"error": "UIN is required", "status": 400}

    personal_email_clean = (personal_email or "").strip().lower()
    if not personal_email_clean or "@" not in personal_email_clean:
        return {"error": "Personal email is required", "status": 400}

    # Validate personal_email against student record
    try:
        student = students_table.get_item(Key={"uin": uin_clean}).get("Item")
        if not student:
            return {"error": "UIN not found in student records", "status": 404}
        record_email = (student.get("personal_email") or "").strip().lower()
        if record_email and record_email != personal_email_clean:
            return {
                "error": "Personal email does not match the one on file for this UIN",
                "status": 400,
            }
    except Exception as e:
        return {"error": f"Could not verify student record: {e}", "status": 500}

    db.update_user_role_and_uin(
        user_id, "FORMER_STUDENT", uin_clean, personal_email=personal_email_clean or None
    )
    if class_year:
        db.table.update_item(
            Key={"user_id": user_id},
            UpdateExpression="SET class_year = :y",
            ExpressionAttributeValues={":y": str(class_year).strip()},
        )

    # Update Cognito custom attributes so tokens reflect new role and UIN
    email = existing.get("email")
    if email:
        auth.admin_set_custom_attributes(
            username=email,
            role="FORMER_STUDENT",
            class_year=class_year or existing.get("class_year"),
            linked_uin=uin_clean,
        )

    updated = db.get_user_by_id(user_id)
    return {"user": updated, "message": "Graduation handover complete"}


def lookup_student(user_id: str, uin: str) -> dict:
    """
    Look up student by UIN for handover verification (Step 1 of two-step flow).
    Returns student profile for display; does not perform link.
    """
    existing = db.get_user_by_id(user_id)
    if not existing:
        return {"error": "User not found", "status": 404}
    if existing.get("linked_uin"):
        return {"error": "You have already linked a student account", "status": 409}
    uin_clean = str(uin).strip()
    if len(uin_clean) != 9 or not uin_clean.isdigit():
        return {"error": "UIN must be exactly 9 digits", "status": 400}
    other = db.get_user_by_linked_uin(uin_clean)
    if other and other.get("user_id") != user_id:
        return {"error": "This student account has already been claimed", "status": 409}
    try:
        student = students_table.get_item(Key={"uin": uin_clean}).get("Item")
    except Exception as e:
        return {"error": str(e), "status": 500}
    if not student:
        return {"error": "No student record found for this UIN", "status": 404}
    return {
        "studentProfile": {
            "uin": student.get("uin"),
            "gradDate": student.get("grad_date"),
            "accountStatus": student.get("account_status"),
        },
        "message": "Please verify this is your student record",
    }
