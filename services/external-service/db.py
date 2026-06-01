"""DynamoDB access for external users and graduation handover links."""

import os
import boto3
from typing import Optional

TABLE_NAME = os.environ.get("EXTERNAL_USERS_TABLE", "cmis-external-users")
dynamo = boto3.resource("dynamodb")
table = dynamo.Table(TABLE_NAME)


def get_user_by_id(user_id: str) -> Optional[dict]:
    """Get external user by Cognito user_id (sub)."""
    r = table.get_item(Key={"user_id": user_id})
    return r.get("Item")


def get_user_by_email(email: str) -> Optional[dict]:
    """Get external user by email (GSI)."""
    r = table.query(
        IndexName="email-index",
        KeyConditionExpression="email = :e",
        ExpressionAttributeValues={":e": email},
    )
    items = r.get("Items", [])
    return items[0] if items else None


def get_user_by_linked_uin(uin: str) -> Optional[dict]:
    """Get external user by linked UIN (for handover uniqueness)."""
    r = table.query(
        IndexName="linked-uin-index",
        KeyConditionExpression="linked_uin = :u",
        ExpressionAttributeValues={":u": uin},
    )
    items = r.get("Items", [])
    return items[0] if items else None


def put_user(
    user_id: str,
    email: str,
    role: str,
    class_year: Optional[str] = None,
    linked_uin: Optional[str] = None,
) -> None:
    """Create or replace external user record."""
    item = {
        "user_id": user_id,
        "email": email,
        "role": role,
    }
    if class_year:
        item["class_year"] = class_year
    if linked_uin:
        item["linked_uin"] = linked_uin
    table.put_item(Item=item)


def update_user_role_and_uin(
    user_id: str, role: str, linked_uin: str, personal_email: Optional[str] = None
) -> None:
    """Update user after graduation handover (set FORMER_STUDENT, linked_uin, optional personal_email)."""
    expr = "SET #r = :r, linked_uin = :u"
    values = {":r": role, ":u": linked_uin}
    if personal_email:
        expr += ", personal_email = :p"
        values[":p"] = personal_email.strip().lower()
    table.update_item(
        Key={"user_id": user_id},
        UpdateExpression=expr,
        ExpressionAttributeNames={"#r": "role"},
        ExpressionAttributeValues=values,
    )


def update_profile(
    user_id: str,
    class_year: Optional[str] = None,
    linked_in_url: Optional[str] = None,
) -> None:
    """Update profile fields (class_year, linked_in_url). Only updates provided values."""
    expr_parts = []
    values = {}
    names = {}
    if class_year is not None:
        expr_parts.append("#cy = :cy")
        names["#cy"] = "class_year"
        values[":cy"] = str(class_year).strip() or ""
    if linked_in_url is not None:
        expr_parts.append("linked_in_url = :li")
        values[":li"] = str(linked_in_url).strip() or ""
    if not expr_parts:
        return
    kwargs = {
        "Key": {"user_id": user_id},
        "UpdateExpression": "SET " + ", ".join(expr_parts),
        "ExpressionAttributeValues": values,
    }
    if names:
        kwargs["ExpressionAttributeNames"] = names
    table.update_item(**kwargs)
