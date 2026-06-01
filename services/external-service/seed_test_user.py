#!/usr/bin/env python3
"""
Seed a test record in DynamoDB.
Usage:
  # Create record for existing Cognito user by email (gets sub from Cognito):
  USER_POOL_ID=xxx EXTERNAL_USERS_TABLE=xxx python seed_test_user.py user@example.com

  # Or create with explicit user_id (must match Cognito sub for /me to work):
  EXTERNAL_USERS_TABLE=xxx python seed_test_user.py --user-id abc-123-xyz user@example.com
"""
import os
import sys
from typing import Optional

import boto3

TABLE_NAME = os.environ.get("EXTERNAL_USERS_TABLE", "cmis-external-users")
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")


def get_sub_by_email(email: str) -> Optional[str]:
    """Get Cognito sub (Username) for user by email."""
    if not USER_POOL_ID:
        return None
    client = boto3.client("cognito-idp")
    r = client.list_users(UserPoolId=USER_POOL_ID, Filter=f'email = "{email}"', Limit=1)
    users = r.get("Users", [])
    if not users:
        return None
    return users[0]["Username"]


def seed_user(user_id: str, email: str, role: str = "FRIEND", class_year: Optional[str] = None, linked_uin: Optional[str] = None):
    dynamo = boto3.resource("dynamodb")
    table = dynamo.Table(TABLE_NAME)
    item = {"user_id": user_id, "email": email, "role": role}
    if class_year:
        item["class_year"] = class_year
    if linked_uin:
        item["linked_uin"] = linked_uin
    table.put_item(Item=item)
    print(f"Created DynamoDB record: user_id={user_id}, email={email}, role={role}")


def main():
    args = sys.argv[1:]
    user_id = None
    email = None
    if args and args[0] == "--user-id" and len(args) >= 3:
        user_id = args[1]
        email = args[2].lower()
    elif args:
        email = args[0].lower()
        user_id = get_sub_by_email(email)

    if not email:
        print("Usage: python seed_test_user.py [--user-id <user_id>] <email>")
        sys.exit(1)
    if not user_id:
        print("Could not find Cognito user for that email. Use --user-id to specify manually.")
        print("Or set USER_POOL_ID and ensure the user exists in Cognito.")
        sys.exit(1)

    seed_user(user_id, email, role="FRIEND")
    print("Done. Log in with this user and visit Profile to test.")


if __name__ == "__main__":
    main()
