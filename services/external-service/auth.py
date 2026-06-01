"""Cognito auth helpers: sign-up, sign-in, and token validation."""

import os
import boto3
from typing import Any, Dict, Optional

USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
CLIENT_ID = os.environ.get("CLIENT_ID", "")
client = boto3.client("cognito-idp")


def sign_up(email: str, password: str) -> Dict[str, Any]:
    """Register a new user in Cognito. Returns Cognito SignUp response."""
    return client.sign_up(
        ClientId=CLIENT_ID,
        Username=email,
        Password=password,
        UserAttributes=[
            {"Name": "email", "Value": email},
            {"Name": "preferred_username", "Value": email},
        ],
    )


def admin_confirm_sign_up(username: str) -> None:
    """Mark user as confirmed so they can sign in without email verification."""
    client.admin_confirm_sign_up(UserPoolId=USER_POOL_ID, Username=username)


def confirm_sign_up(email: str, code: str) -> None:
    """Confirm sign-up with code (if admin requires confirmation)."""
    client.confirm_sign_up(
        ClientId=CLIENT_ID,
        Username=email,
        ConfirmationCode=code,
    )


def admin_set_user_password(username: str, password: str, permanent: bool = True) -> None:
    """Set password (e.g. when auto-confirming users)."""
    client.admin_set_user_password(
        UserPoolId=USER_POOL_ID,
        Username=username,
        Password=password,
        Permanent=permanent,
    )


def admin_set_custom_attributes(username: str, role: str, class_year: Optional[str] = None, linked_uin: Optional[str] = None) -> None:
    """Set custom attributes on Cognito user after sign-up.
    Silently skips if the user pool does not have these attributes (e.g. older pool schema).
    Role/class_year/linked_uin are stored in DynamoDB, which is the source of truth."""
    attrs = [{"Name": "custom:role", "Value": role}]
    if class_year is not None:
        attrs.append({"Name": "custom:class_year", "Value": str(class_year)})
    if linked_uin is not None:
        attrs.append({"Name": "custom:linked_uin", "Value": linked_uin})
    try:
        client.admin_update_user_attributes(
            UserPoolId=USER_POOL_ID,
            Username=username,
            UserAttributes=attrs,
        )
    except client.exceptions.InvalidParameterException:
        pass  # Pool schema may not include custom attrs; DynamoDB has the data


def initiate_auth(email: str, password: str) -> Dict[str, Any]:
    """Sign in with email/password (USER_PASSWORD_AUTH). Returns tokens."""
    return client.initiate_auth(
        ClientId=CLIENT_ID,
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={
            "USERNAME": email,
            "PASSWORD": password,
        },
    )


def get_user_by_token(access_token: str) -> Dict[str, Any]:
    """Get Cognito user info from access token."""
    return client.get_user(AccessToken=access_token)


def forgot_password(username: str) -> Dict[str, Any]:
    """Start forgot-password flow. Cognito sends code to user's verified email."""
    return client.forgot_password(
        ClientId=CLIENT_ID,
        Username=username,
    )


def confirm_forgot_password(username: str, confirmation_code: str, new_password: str) -> None:
    """Complete forgot-password with code from email and new password."""
    client.confirm_forgot_password(
        ClientId=CLIENT_ID,
        Username=username,
        ConfirmationCode=confirmation_code,
        Password=new_password,
    )


def parse_token_from_header(headers: Optional[Dict[str, str]]) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    if not headers:
        return None
    auth = headers.get("authorization") or headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        return None
    return auth[7:].strip()
