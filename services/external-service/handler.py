"""
Lambda handler for External Service (Team Gig 'Em).
Routes: POST /auth/signup, POST /auth/signin, POST /auth/forgot-password, POST /auth/reset-password,
GET /me, POST /graduation-handover, GET/POST /graduation-handover/claim, EventBridge graduation scan.
"""

import json
import os
from datetime import date
import base64
import time

import boto3
import auth
import db
import role_engine
import handover
import graduation_scan
import graduation_claim

USER_POOL_ID = os.environ.get("USER_POOL_ID")
CLIENT_ID = os.environ.get("CLIENT_ID")
EXTERNAL_USERS_TABLE = os.environ.get("EXTERNAL_USERS_TABLE")
STUDENT_PROFILES_TABLE = os.environ.get("STUDENT_PROFILES_TABLE", "")
CMIS_USER_POOL_ID = os.environ.get("CMIS_USER_POOL_ID", "")

dynamo = boto3.resource("dynamodb")
student_profiles_table = dynamo.Table(STUDENT_PROFILES_TABLE) if STUDENT_PROFILES_TABLE else None
cognito_idp = boto3.client("cognito-idp")


def _response(body: dict, status: int = 200, cors: bool = True) -> dict:
    h = {"Content-Type": "application/json"}
    if cors:
        h["Access-Control-Allow-Origin"] = "*"
        h["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return {"statusCode": status, "headers": h, "body": json.dumps(body)}


def _parse_body(event: dict) -> dict:
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _route(event: dict) -> tuple:
    """Return (path_parts, method, body). HTTP API payload 2.0: path in rawPath or requestContext.http.path."""
    req = event.get("requestContext", {}) or {}
    http = req.get("http", {})
    method = (http.get("method") or event.get("httpMethod") or "GET").upper()
    path = (event.get("rawPath") or http.get("path") or event.get("path") or "/").strip("/")
    path_parts = [p for p in path.split("/") if p]
    body = _parse_body(event)
    return path_parts, method, body


def _decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload without verifying signature (best-effort)."""
    if not token or token.count(".") != 2:
        return {}
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload_json = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8")
        return json.loads(payload_json) if payload_json else {}
    except Exception:
        return {}


def _get_user_from_bearer(event: dict) -> tuple:
    """
    Returns (sub, email) for a request.
    Accepts either:
    - Cognito Access Token (via Cognito GetUser), OR
    - Cognito ID Token (decoded locally with exp check)
    """
    token = auth.parse_token_from_header(event.get("headers") or {})
    if not token:
        raise ValueError("missing_token")

    # Try Cognito GetUser first (access token).
    try:
        cognito_user = auth.get_user_by_token(token)
        sub = None
        email = None
        for attr in cognito_user.get("UserAttributes", []):
            if attr["Name"] == "sub":
                sub = attr["Value"]
            elif attr["Name"] == "email":
                email = attr["Value"]
        if sub:
            return sub, email
    except Exception:
        pass

    # Fallback: decode ID token payload.
    payload = _decode_jwt_payload(token)
    if not payload:
        raise ValueError("invalid_token")
    exp = payload.get("exp")
    if isinstance(exp, (int, float)) and int(exp) < int(time.time()):
        raise ValueError("expired_token")
    sub = payload.get("sub")
    email = payload.get("email")
    if not sub:
        raise ValueError("invalid_token")
    return str(sub), str(email) if email else None


def _get_student_profile(user_id: str) -> dict | None:
    if not student_profiles_table:
        raise RuntimeError("STUDENT_PROFILES_TABLE is not configured")
    r = student_profiles_table.get_item(Key={"userId": user_id})
    return r.get("Item")


def _update_student_profile_alumni(user_id: str, personal_email: str, existing_email: str | None = None) -> dict:
    if not student_profiles_table:
        raise RuntimeError("STUDENT_PROFILES_TABLE is not configured")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    # Build a comma-separated list of known emails (TAMU + personal) in the single "email" field.
    emails: list[str] = []
    if existing_email:
        for part in str(existing_email).split(","):
            p = part.strip()
            if p:
                emails.append(p.lower())
    if personal_email:
        p = personal_email.strip().lower()
        if p and p not in emails:
            emails.append(p)
    combined_email = ", ".join(emails) if emails else (personal_email or "")

    res = student_profiles_table.update_item(
        Key={"userId": user_id},
        UpdateExpression="SET #role = :r, email = :e, alumniConvertedAt = :c, updatedAt = :u",
        ExpressionAttributeNames={"#role": "role"},
        ExpressionAttributeValues={
            ":r": "FORMER_STUDENT",
            ":e": combined_email,
            ":c": now,
            ":u": now,
        },
        ReturnValues="ALL_NEW",
    )
    return res.get("Attributes") or {}


def _link_personal_email_to_cmis_user(user_id: str, current_email: str | None, personal_email: str) -> None:
    """Make the existing CMIS user (same sub/userId) sign-in-able via personal email.

    CMIS User Pool uses username_attributes=["email"] and EMAIL_OTP is enabled.
    If we update the user's email to personal_email, the same sub/userId will be used,
    so the existing StudentProfiles record continues to be found.
    """
    if not CMIS_USER_POOL_ID:
        raise RuntimeError("CMIS_USER_POOL_ID is not configured")
    normalized = (personal_email or "").strip().lower()
    if not normalized or "@" not in normalized:
        raise ValueError("invalid_personal_email")

    # In Cognito APIs, Username is often the internal username (commonly the sub),
    # but for safety we attempt both sub and current email.
    candidates = [user_id]
    if current_email:
        candidates.append(current_email.strip().lower())

    last_err: Exception | None = None
    for username in candidates:
        try:
            cognito_idp.admin_update_user_attributes(
                UserPoolId=CMIS_USER_POOL_ID,
                Username=username,
                UserAttributes=[
                    {"Name": "email", "Value": normalized},
                    {"Name": "preferred_username", "Value": normalized},
                    {"Name": "email_verified", "Value": "true"},
                ],
            )
            return
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise last_err


# ---------------------------------------------------------------------------
# EventBridge: Graduation scan (Scheduled rule)
# ---------------------------------------------------------------------------
def do_graduation_scan() -> dict:
    """Scan students, generate tokens, deliver magic links."""
    try:
        result = graduation_scan.run_scan()
        return _response(result, 200)
    except Exception as e:
        return _response({"error": "Scan failed", "detail": str(e)}, 500)


# ---------------------------------------------------------------------------
# POST /auth/signup
# Body: { "email", "password", "formerStudent": bool, "classYear": optional }
# ---------------------------------------------------------------------------
def do_signup(body: dict) -> dict:
    email = (body.get("email") or "").strip().lower()
    password = body.get("password")
    former_student = body.get("formerStudent", False)
    class_year = (body.get("classYear") or "").strip() or None

    if not email or "@" not in email:
        return _response({"error": "Valid email is required"}, 400)
    if not password or len(password) < 10:
        return _response({"error": "Password must be at least 10 characters"}, 400)

    try:
        role, resolved_class_year = role_engine.resolve_role(email, former_student, class_year)
    except ValueError as e:
        return _response({"error": str(e)}, 400)

    try:
        signup_result = auth.sign_up(email, password)
        user_id = signup_result.get("UserSub")
        if not user_id:
            return _response({"error": "Registration failed", "detail": "No UserSub in Cognito response"}, 500)
    except auth.client.exceptions.UsernameExistsException:
        return _response({"error": "An account with this email already exists"}, 409)
    except auth.client.exceptions.InvalidPasswordException as e:
        return _response({"error": "Password does not meet requirements", "detail": str(e)}, 400)
    except auth.client.exceptions.InvalidParameterException as e:
        return _response({"error": "Invalid request", "detail": str(e)}, 400)
    except Exception as e:
        return _response({"error": "Registration failed", "detail": str(e)}, 500)

    try:
        auth.admin_confirm_sign_up(email)
        auth.admin_set_custom_attributes(
            username=email,
            role=role,
            class_year=resolved_class_year,
            linked_uin=None,
        )
        db.put_user(
            user_id=user_id,
            email=email,
            role=role,
            class_year=resolved_class_year,
            linked_uin=None,
        )
    except auth.client.exceptions.UserNotFoundException:
        return _response({"error": "Registration failed", "detail": "User was not created in Cognito"}, 500)
    except Exception as e:
        return _response({"error": "Registration failed", "detail": str(e)}, 500)

    return _response({
        "message": "Registration successful",
        "userId": user_id,
        "email": email,
        "role": role,
        "classYear": resolved_class_year,
    }, 201)


# ---------------------------------------------------------------------------
# POST /auth/signin
# Body: { "email", "password" }
# ---------------------------------------------------------------------------
def do_signin(body: dict) -> dict:
    email = (body.get("email") or "").strip().lower()
    password = body.get("password")

    if not email or not password:
        return _response({"error": "Email and password are required"}, 400)

    try:
        result = auth.initiate_auth(email, password)
    except auth.client.exceptions.NotAuthorizedException:
        return _response({"error": "Invalid email or password"}, 401)
    except auth.client.exceptions.UserNotFoundException:
        return _response({"error": "Invalid email or password"}, 401)
    except Exception as e:
        return _response({"error": "Sign in failed", "detail": str(e)}, 500)

    auth_result = result.get("AuthenticationResult", {})
    id_token = auth_result.get("IdToken")
    access_token = auth_result.get("AccessToken")
    refresh_token = auth_result.get("RefreshToken")
    expires_in = auth_result.get("ExpiresIn")

    user_record = db.get_user_by_email(email)
    role = (user_record or {}).get("role", "FRIEND")
    class_year = (user_record or {}).get("class_year")
    linked_uin = (user_record or {}).get("linked_uin")

    return _response({
        "idToken": id_token,
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresIn": expires_in,
        "user": {
            "email": email,
            "role": role,
            "classYear": class_year,
            "linkedUin": linked_uin,
        },
    })


# ---------------------------------------------------------------------------
# POST /auth/forgot-password - send reset code to user's email (Cognito)
# Body: { "email" }
# ---------------------------------------------------------------------------
def do_forgot_password(body: dict) -> dict:
    email = (body.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return _response({"error": "Valid email is required"}, 400)
    try:
        auth.forgot_password(email)
        return _response({"message": "If an account exists for this email, a reset code has been sent. Check your inbox."})
    except auth.client.exceptions.UserNotFoundException:
        return _response({"message": "If an account exists for this email, a reset code has been sent. Check your inbox."})
    except auth.client.exceptions.LimitExceededException:
        return _response({"error": "Too many requests. Please try again later."}, 429)
    except Exception as e:
        return _response({"error": "Could not send reset code", "detail": str(e)}, 500)


# ---------------------------------------------------------------------------
# POST /auth/reset-password - set new password with code from email
# Body: { "email", "code", "newPassword" }
# ---------------------------------------------------------------------------
def do_reset_password(body: dict) -> dict:
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()
    new_password = body.get("newPassword") or ""
    if not email or "@" not in email:
        return _response({"error": "Valid email is required"}, 400)
    if not code:
        return _response({"error": "Reset code from your email is required"}, 400)
    if not new_password or len(new_password) < 10:
        return _response({"error": "New password must be at least 10 characters"}, 400)
    try:
        auth.confirm_forgot_password(email, code, new_password)
        return _response({"message": "Password has been reset. You can sign in with your new password."})
    except auth.client.exceptions.CodeMismatchException:
        return _response({"error": "Invalid or expired reset code"}, 400)
    except auth.client.exceptions.ExpiredCodeException:
        return _response({"error": "Reset code has expired. Request a new one."}, 400)
    except Exception as e:
        return _response({"error": "Reset failed", "detail": str(e)}, 500)


# ---------------------------------------------------------------------------
# GET /me - current user from Bearer token
# ---------------------------------------------------------------------------
def do_me(event: dict) -> dict:
    token = auth.parse_token_from_header(event.get("headers") or {})
    if not token:
        return _response({"error": "Authorization required"}, 401)
    try:
        cognito_user = auth.get_user_by_token(token)
    except Exception:
        return _response({"error": "Invalid or expired token"}, 401)

    sub = None
    email = None
    role = "FRIEND"
    class_year = None
    linked_uin = None
    for attr in cognito_user.get("UserAttributes", []):
        if attr["Name"] == "sub":
            sub = attr["Value"]
        elif attr["Name"] == "email":
            email = attr["Value"]
        elif attr["Name"] == "custom:role":
            role = attr["Value"]
        elif attr["Name"] == "custom:class_year":
            class_year = attr["Value"] or None
        elif attr["Name"] == "custom:linked_uin":
            linked_uin = attr["Value"] or None
    if not sub:
        return _response({"error": "User not found"}, 404)

    user_record = db.get_user_by_id(sub)
    if not user_record:
        if not email:
            return _response({"error": "Profile not found"}, 404)
        db.put_user(
            user_id=sub,
            email=email,
            role=role,
            class_year=class_year,
            linked_uin=linked_uin,
        )
        user_record = {"email": email, "role": role, "class_year": class_year, "linked_uin": linked_uin}

    return _response({
        "userId": sub,
        "email": user_record.get("email"),
        "role": user_record.get("role"),
        "classYear": user_record.get("class_year"),
        "linkedUin": user_record.get("linked_uin"),
    })


# ---------------------------------------------------------------------------
# POST /graduation-handover
# Body: { "uin", "classYear": optional, "personalEmail" }
# ---------------------------------------------------------------------------
def do_graduation_handover(event: dict, body: dict) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    personal_email = (body.get("personalEmail") or "").strip().lower()
    uin = (body.get("uin") or "").strip()

    if not personal_email or "@" not in personal_email:
        return _response({"error": "Personal email is required"}, 400)

    try:
        profile = _get_student_profile(sub)
        if not profile:
            return _response({"error": "Profile not found"}, 404)
        # If the UI provides a UIN, ensure it matches the StudentProfiles record.
        if uin and str(profile.get("uin") or "").strip() and str(profile.get("uin") or "").strip() != uin:
            return _response({"error": "UIN does not match your student profile"}, 400)
        updated = _update_student_profile_alumni(sub, personal_email, existing_email=profile.get("email"))
    except Exception as e:
        return _response({"error": "Handover failed", "detail": str(e)}, 500)

    return _response({"message": "Graduation handover complete", "profile": updated})


# ---------------------------------------------------------------------------
# GET /graduation-handover/lookup?uin= - return student profile for verification (no link)
# ---------------------------------------------------------------------------
def do_handover_lookup(event: dict) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)
    query = event.get("queryStringParameters") or {}
    uin = (query.get("uin") or "").strip()
    if not uin:
        return _response({"error": "UIN is required"}, 400)

    try:
        profile = _get_student_profile(sub)
        if not profile:
            return _response({"error": "Profile not found"}, 404)
        return _response({"studentProfile": {"uin": profile.get("uin"), "gradDate": profile.get("gradDate"), "role": profile.get("role")}})
    except Exception as e:
        return _response({"error": str(e)}, 500)


# ---------------------------------------------------------------------------
# GET /graduation-status
# Query params:
#   - gradDate: required for decision (YYYY-MM or YYYY-MM-DD)
# Returns:
#   - { showPrompt: bool, reason: string, role?: string, linkedUin?: string, gradDate?: string }
# ---------------------------------------------------------------------------
def do_graduation_status(event: dict) -> dict:
    # Public endpoint: works without Authorization.
    # If Authorization is provided and valid, we suppress the prompt for alumni users
    # based on StudentProfiles.role (source of truth).
    role = None
    linked_uin = None
    token = auth.parse_token_from_header(event.get("headers") or {})
    if token:
        try:
            sub, _email = _get_user_from_bearer(event)
            prof = _get_student_profile(sub)
            role = (prof or {}).get("role")
            if role == "FORMER_STUDENT":
                return _response({"showPrompt": False, "reason": "already_alumni", "role": role, "linkedUin": None})
        except Exception:
            # Ignore auth failures for this public endpoint.
            role = None
            linked_uin = None

    query = event.get("queryStringParameters") or {}
    raw_grad_date = (query.get("gradDate") or "").strip()
    if not raw_grad_date:
        return _response({"showPrompt": False, "reason": "no_grad_date"})

    try:
        parts = raw_grad_date.split("-")
        if len(parts) < 2:
            raise ValueError("Invalid gradDate format")
        grad_year = int(parts[0])
        grad_month = int(parts[1])
        if grad_month < 1 or grad_month > 12:
            raise ValueError("Invalid gradDate month")
    except Exception:
        return _response({"error": "Invalid gradDate format. Expected YYYY-MM or YYYY-MM-DD."}, 400)

    today = date.today()
    graduated_by_month = (today.year, today.month) >= (grad_year, grad_month)

    return _response({
        "showPrompt": bool(graduated_by_month),
        "reason": "after_grad_month" if graduated_by_month else "before_grad_month",
        "role": role,
        "linkedUin": linked_uin,
        "gradDate": raw_grad_date,
    })


def lambda_handler(event: dict, context: object) -> dict:
    try:
        return _lambda_handler_impl(event, context)
    except Exception as e:
        return _response({"error": "Server error", "detail": str(e)}, 500)


def _lambda_handler_impl(event: dict, context: object) -> dict:
    # EventBridge scheduled invocation (graduation scan)
    if event.get("source") == "aws.events" or event.get("detail-type") == "Scheduled Event":
        return do_graduation_scan()

    path_parts, method, body = _route(event)

    if method == "OPTIONS":
        return _response({}, 200)

    if not path_parts and method == "GET":
        return _response({"service": "external", "version": "1.0"})

    if path_parts == ["auth", "signup"] and method == "POST":
        return do_signup(body)

    if path_parts == ["auth", "signin"] and method == "POST":
        return do_signin(body)

    if path_parts == ["auth", "forgot-password"] and method == "POST":
        return do_forgot_password(body)

    if path_parts == ["auth", "reset-password"] and method == "POST":
        return do_reset_password(body)

    if path_parts == ["me"] and method == "GET":
        return do_me(event)

    if path_parts == ["graduation-handover", "lookup"] and method == "GET":
        return do_handover_lookup(event)

    if path_parts == ["graduation-handover"] and method == "POST":
        return do_graduation_handover(event, body)

    if path_parts == ["graduation-handover", "request-link"] and method == "POST":
        email = (body.get("email") or "").strip().lower()
        result = graduation_scan.request_magic_link_for_email(email)
        if "error" in result:
            return _response({"error": result["error"]}, result.get("status", 400))
        return _response(result, 200)

    if path_parts == ["graduation-handover", "claim"] and method == "GET":
        try:
            query = event.get("queryStringParameters") or {}
            token = (query.get("token") or "").strip()
            info = graduation_claim.get_token_info(token)
            if not info:
                return _response({"error": "Invalid or expired token"}, 400)
            return _response({"email": info["personal_email"], "uin": info["uin"], "classYear": info["class_year"]})
        except Exception as e:
            return _response({"error": "Invalid or expired token", "detail": str(e)}, 500)

    if path_parts == ["graduation-handover", "claim"] and method == "POST":
        token = (body.get("token") or "").strip()
        password = body.get("password") or ""
        result = graduation_claim.claim_with_password(token, password)
        if "error" in result:
            return _response({"error": result["error"]}, result.get("status", 400))
        return _response(result, 200)

    if path_parts == ["graduation-status"] and method == "GET":
        return do_graduation_status(event)

    return _response({"error": "Not Found", "path": "/" + "/".join(path_parts)}, 404)
