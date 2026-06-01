"""
Lambda handler for External Service (Team Gig 'Em).
Routes: POST /auth/signup, POST /auth/signin, POST /auth/forgot-password, POST /auth/reset-password,
GET /me, POST /graduation-handover, GET/POST /graduation-handover/claim, EventBridge graduation scan.
"""

import json
import os

import auth
import db
import role_engine
import handover
import graduation_scan
import graduation_claim

USER_POOL_ID = os.environ.get("USER_POOL_ID")
CLIENT_ID = os.environ.get("CLIENT_ID")
EXTERNAL_USERS_TABLE = os.environ.get("EXTERNAL_USERS_TABLE")


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
# Body: { "uin", "classYear": optional, "personalEmail", "password" }
# ---------------------------------------------------------------------------
def do_graduation_handover(event: dict, body: dict) -> dict:
    token = auth.parse_token_from_header(event.get("headers") or {})
    if not token:
        return _response({"error": "Authorization required"}, 401)
    try:
        cognito_user = auth.get_user_by_token(token)
    except Exception:
        return _response({"error": "Invalid or expired token"}, 401)

    sub = None
    email = None
    for attr in cognito_user.get("UserAttributes", []):
        if attr["Name"] == "sub":
            sub = attr["Value"]
        elif attr["Name"] == "email":
            email = attr["Value"]
    if not sub:
        return _response({"error": "User not found"}, 404)

    uin = (body.get("uin") or "").strip()
    class_year = (body.get("classYear") or "").strip() or None
    personal_email = (body.get("personalEmail") or "").strip().lower()
    password = body.get("password")

    if not personal_email or "@" not in personal_email:
        return _response({"error": "Personal email is required"}, 400)
    if not password:
        return _response({"error": "Password is required to verify your identity"}, 400)
    if not email or "@" not in email:
        return _response({"error": "Could not determine account email"}, 500)

    try:
        auth.initiate_auth(email, password)
    except auth.client.exceptions.NotAuthorizedException:
        return _response({"error": "Invalid password"}, 401)
    except auth.client.exceptions.UserNotFoundException:
        return _response({"error": "Invalid password"}, 401)
    except Exception as e:
        return _response({"error": "Password verification failed", "detail": str(e)}, 500)

    try:
        result = handover.link_uin_to_user(sub, uin, class_year, personal_email=personal_email)
    except Exception as e:
        return _response({"error": "Handover failed", "detail": str(e)}, 500)

    if "error" in result:
        return _response({"error": result["error"]}, result.get("status", 400))
    return _response(result)


# ---------------------------------------------------------------------------
# GET /graduation-handover/lookup?uin= - return student profile for verification (no link)
# ---------------------------------------------------------------------------
def do_handover_lookup(event: dict) -> dict:
    token = auth.parse_token_from_header(event.get("headers") or {})
    if not token:
        return _response({"error": "Authorization required"}, 401)
    try:
        cognito_user = auth.get_user_by_token(token)
    except Exception:
        return _response({"error": "Invalid or expired token"}, 401)
    sub = None
    for attr in cognito_user.get("UserAttributes", []):
        if attr["Name"] == "sub":
            sub = attr["Value"]
            break
    if not sub:
        return _response({"error": "User not found"}, 404)
    query = event.get("queryStringParameters") or {}
    uin = (query.get("uin") or "").strip()
    if not uin:
        return _response({"error": "UIN is required"}, 400)
    result = handover.lookup_student(sub, uin)
    if "error" in result:
        return _response({"error": result["error"]}, result.get("status", 400))
    return _response(result)


def lambda_handler(event: dict, context: object) -> dict:
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
        query = event.get("queryStringParameters") or {}
        token = query.get("token", "").strip()
        info = graduation_claim.get_token_info(token)
        if not info:
            return _response({"error": "Invalid or expired token"}, 400)
        return _response({"email": info["personal_email"], "uin": info["uin"], "classYear": info["class_year"]})

    if path_parts == ["graduation-handover", "claim"] and method == "POST":
        token = (body.get("token") or "").strip()
        password = body.get("password") or ""
        result = graduation_claim.claim_with_password(token, password)
        if "error" in result:
            return _response({"error": result["error"]}, result.get("status", 400))
        return _response(result, 200)

    return _response({"error": "Not Found", "path": "/" + "/".join(path_parts)}, 404)
