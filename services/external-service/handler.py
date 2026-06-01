"""
Lambda handler for External Service (Team Gig 'Em).
Routes: POST /auth/signup, POST /auth/signin, POST /auth/forgot-password, POST /auth/reset-password,
GET /me, POST /graduation-handover, GET/POST /graduation-handover/claim, EventBridge graduation scan,
EventBridge mentorship annual batch, async late-registration matching.
"""

import json
import os
import re
from datetime import date, datetime, timezone
from decimal import Decimal
import base64
import time
import uuid

import boto3
from botocore.exceptions import ClientError
import auth
import db
import role_engine
import handover
import graduation_scan
import graduation_claim
import mentorship_board
import mentorship_embeddings
import mentorship_service

USER_POOL_ID = os.environ.get("USER_POOL_ID")
CLIENT_ID = os.environ.get("CLIENT_ID")
EXTERNAL_USERS_TABLE = os.environ.get("EXTERNAL_USERS_TABLE")
STUDENT_PROFILES_TABLE = os.environ.get("STUDENT_PROFILES_TABLE", "")
CMIS_USER_POOL_ID = os.environ.get("CMIS_USER_POOL_ID", "")
CMIS_GROUP_FRIENDS = os.environ.get("CMIS_GROUP_FRIENDS", "friends")
CMIS_GROUP_ALUMNI = os.environ.get("CMIS_GROUP_ALUMNI", "alumni")

dynamo = boto3.resource("dynamodb")
student_profiles_table = dynamo.Table(STUDENT_PROFILES_TABLE) if STUDENT_PROFILES_TABLE else None
_cognito_idp = None
_lambda_client = None


def _cognito_idp_client():
    global _cognito_idp
    if _cognito_idp is None:
        _cognito_idp = boto3.client("cognito-idp")
    return _cognito_idp


def _lambda_invoke_client():
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = boto3.client("lambda")
    return _lambda_client


class _JsonDecimalEncoder(json.JSONEncoder):
    """DynamoDB Number attributes deserialize as Decimal; JSON cannot encode them natively."""

    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def _response(body: dict, status: int = 200, cors: bool = True) -> dict:
    h = {"Content-Type": "application/json"}
    if cors:
        h["Access-Control-Allow-Origin"] = "*"
        h["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return {"statusCode": status, "headers": h, "body": json.dumps(body, cls=_JsonDecimalEncoder)}


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


def _email_parts_from_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [p.strip().lower() for p in re.split(r"[,\s;]+", str(value)) if p and p.strip()]


def _name_from_profile(profile: dict | None) -> str:
    return str((profile or {}).get("name") or "Your mentor")


def _is_mentor_profile(profile: dict | None) -> bool:
    if not profile:
        return False
    return (
        profile.get("mentorshipInterested") is True
        and str(profile.get("mentorship") or "").strip().lower() == "mentor"
    )


def _is_mentee_profile(profile: dict | None) -> bool:
    if not profile:
        return False
    return (
        profile.get("mentorshipInterested") is True
        and str(profile.get("mentorship") or "").strip().lower() == "mentee"
    )


# Stripped from Dynamo rows before merge so stale denormalized attributes are not returned.
_MENTEE_MENTOR_API_DETAIL_KEYS = frozenset(
    {
        "menteeLinkedInUrl",
        "menteeDegree",
        "menteeUniversity",
        "menteeStudentGoals",
        "menteeMentorshipGoals",
        "menteeProfileGpa",
        "menteeResumePreview",
        "menteeEducationSummary",
        "menteeResumeDownloadUrl",
        "menteeResumeFileName",
    }
)


def _enrich_mentor_match_rows_with_mentee_profiles(rows: list[dict]) -> list[dict]:
    """Hydrate mentor-facing rows from StudentProfiles (+ resume via mentorship_service)."""
    cache: dict[str, dict | None] = {}
    out: list[dict] = []
    for row in rows:
        r = dict(row)
        for k in _MENTEE_MENTOR_API_DETAIL_KEYS:
            r.pop(k, None)
        uid = str(r.get("menteeUserId") or "").strip()
        if uid:
            if uid not in cache:
                cache[uid] = _get_student_profile(uid)
            prof = cache[uid]
            if prof:
                r.update(mentorship_service.mentee_mentor_view_from_profile(prof))
        out.append(r)
    return out


def _single_active_mentor_queue(rows: list[dict]) -> list[dict]:
    """
    Enforce one-at-a-time mentor review in API responses:
    - keep only the top active queue item (SUGGESTED / PENDING_MENTOR)
    - preserve all non-active history rows
    """
    active: list[dict] = []
    rest: list[dict] = []
    for r in rows:
        s = str((r or {}).get("status") or "").upper()
        if s in ("SUGGESTED", "PENDING_MENTOR"):
            active.append(r)
        else:
            rest.append(r)
    top_active = active[:1]
    return top_active + rest


def _mentor_pause_until_str(profile: dict | None) -> str:
    if not profile:
        return ""
    v = profile.get("mentorshipMentorPauseUntil")
    if v is None:
        return ""
    return str(v).strip()


def _mentor_pause_is_active(profile: dict | None) -> bool:
    raw = _mentor_pause_until_str(profile)
    if not raw:
        return False
    try:
        if "T" in raw:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return datetime.now(timezone.utc) < dt
        day = datetime.strptime(raw[:10], "%Y-%m-%d").date()
        return date.today() <= day
    except Exception:
        return False


def _is_requester_admin(event: dict) -> bool:
    """True if the bearer token belongs to a Cognito user in the `admins` group (or ADMIN_USER_IDS sub allowlist)."""
    token = auth.parse_token_from_header(event.get("headers") or {})
    if not token:
        return False

    # Fast-path: trust JWT claims when present (works for both ID/access tokens).
    # This avoids false negatives when AdminListGroupsForUser/GetUser calls fail transiently.
    try:
        payload = _decode_jwt_payload(token)
        groups = payload.get("cognito:groups")
        if isinstance(groups, list):
            for g in groups:
                gn = str(g or "").strip().lower()
                if gn in ("admins", "admin"):
                    return True
    except Exception:
        pass

    allow_ids = [x.strip() for x in (os.environ.get("ADMIN_USER_IDS") or "").split(",") if x.strip()]
    if allow_ids:
        try:
            cognito_user = auth.get_user_by_token(token)
            for attr in cognito_user.get("UserAttributes", []):
                if attr.get("Name") == "sub" and str(attr.get("Value") or "") in allow_ids:
                    return True
        except Exception:
            pass
        payload = _decode_jwt_payload(token)
        sub = str(payload.get("sub") or "").strip()
        if sub and sub in allow_ids:
            return True

    if not USER_POOL_ID:
        return False
    try:
        cognito_user = auth.get_user_by_token(token)
        username = cognito_user.get("Username")
        if not username:
            return False
        cidp = _cognito_idp_client()
        resp = cidp.admin_list_groups_for_user(UserPoolId=USER_POOL_ID, Username=username, Limit=60)
        for g in resp.get("Groups", []):
            gn = str(g.get("GroupName", "")).strip().lower()
            if gn in ("admins", "admin"):
                return True
    except Exception:
        return False
    return False


def _list_mentee_profiles(exclude_user_id: str) -> list[dict]:
    if not student_profiles_table:
        raise RuntimeError("STUDENT_PROFILES_TABLE is not configured")
    result = student_profiles_table.scan()
    items = result.get("Items") or []
    while "LastEvaluatedKey" in result:
        result = student_profiles_table.scan(ExclusiveStartKey=result["LastEvaluatedKey"])
        items.extend(result.get("Items") or [])
    mentees = []
    for p in items:
        if p.get("userId") == exclude_user_id:
            continue
        if not _is_mentee_profile(p):
            continue
        mentees.append(p)
    return mentees


def _list_mentor_profiles(exclude_user_id: str) -> list[dict]:
    if not student_profiles_table:
        raise RuntimeError("STUDENT_PROFILES_TABLE is not configured")
    result = student_profiles_table.scan()
    items = result.get("Items") or []
    while "LastEvaluatedKey" in result:
        result = student_profiles_table.scan(ExclusiveStartKey=result["LastEvaluatedKey"])
        items.extend(result.get("Items") or [])
    mentors = []
    for p in items:
        if p.get("userId") == exclude_user_id:
            continue
        if not _is_mentor_profile(p):
            continue
        mentors.append(p)
    return mentors


def do_mentorship_candidates(event: dict) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    mentor_profile = _get_student_profile(sub)
    if not mentor_profile and email:
        mentor_profile = _get_student_profile_by_any_email(email)
    if not _is_mentor_profile(mentor_profile):
        return _response({"error": "Mentor profile required for this endpoint"}, 403)

    try:
        allocator_snapshot = mentorship_service.load_allocator_snapshot()
        pause_until = _mentor_pause_until_str(mentor_profile)
        paused = _mentor_pause_is_active(mentor_profile)
        btier, bmult, breason = mentorship_board.resolve_mentor_board_tier(mentor_profile)

        if paused:
            return _response(
                {
                    "candidates": [],
                    "totalCandidates": 0,
                    "mentorBoard": {"tier": btier, "multiplier": bmult, "reason": breason},
                    "mentorPauseUntil": pause_until or None,
                    "mentorPaused": True,
                    "allocator": {
                        "exclusiveLocks": len(allocator_snapshot.get("exclusive_lock") or {}),
                        "note": "Paused until reminder date; no new suggestions built.",
                    },
                }
            )

        mentees = _list_mentee_profiles(exclude_user_id=sub)
        max_m = mentorship_service.mentee_max_active_matches()
        mentees = [
            p
            for p in mentees
            if mentorship_service.count_channel_opened_for_mentee(str(p.get("userId") or "")) < max_m
        ]
        mentees = mentorship_service.filter_mentees_exclusive_for_mentor(sub, mentees, allocator_snapshot)
        mentees = mentorship_service.sort_mentee_profiles_for_allocator(sub, mentees, allocator_snapshot)
        raw_token = auth.parse_token_from_header(event.get("headers") or {})
        candidates = mentorship_service.build_mentor_candidates(
            mentor_profile,
            mentees,
            mentor_auth_token=raw_token,
            include_unavailable=True,
        )
        available_candidates = [c for c in candidates if bool(c.get("isAvailableToMatch"))]
        mname = str(mentor_profile.get("name") or "").strip() or None
        saved = mentorship_service.upsert_suggestions(
            sub,
            available_candidates,
            limit=1,
            mentor_display_name=mname,
            allocator_snapshot=allocator_snapshot,
        )

        # Strip scores from the mentor's view (order is retained)
        for c in saved:
            c.pop("semanticScore", None)
            c.pop("similarityScore", None)
            c.pop("ruleScore", None)
            c.pop("baseFinalScore", None)
            c.pop("boostedScore", None)
            c.pop("finalScore", None)

        saved = _single_active_mentor_queue(_enrich_mentor_match_rows_with_mentee_profiles(saved))
        saved = mentorship_service.redact_mentor_candidate_rows_for_api(saved)
        ranked_preview = []
        for c in candidates[:12]:
            pct = 0
            try:
                pct = int(round(float(c.get("finalScore") or c.get("boostedScore") or 0) * 100))
            except Exception:
                pct = 0
            ranked_preview.append(
                {
                    "menteeUserId": c.get("menteeUserId"),
                    "menteeName": c.get("menteeName"),
                    "matchPercent": max(0, min(100, pct)),
                    "isAvailableToMatch": bool(c.get("isAvailableToMatch")),
                    "availabilityReason": c.get("availabilityReason"),
                    "reasonSummary": c.get("reasonSummary"),
                }
            )

        return _response(
            {
                "candidates": saved,
                "totalCandidates": len(available_candidates),
                "rankedPreview": ranked_preview,
                "mentorBoard": {"tier": btier, "multiplier": bmult, "reason": breason},
                "mentorPauseUntil": pause_until or None,
                "mentorPaused": False,
                "allocator": {
                    "exclusiveLocks": len(allocator_snapshot.get("exclusive_lock") or {}),
                    "note": "Mentees in SUGGESTED/PENDING are exclusive to one mentor until decline/skip.",
                },
            }
        )
    except Exception as e:
        return _response({"error": "Failed to build mentorship candidates", "detail": str(e)}, 500)


def do_mentorship_list_matches(event: dict) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    mentor_profile = _get_student_profile(sub)
    if not mentor_profile and email:
        mentor_profile = _get_student_profile_by_any_email(email)
    if not _is_mentor_profile(mentor_profile):
        return _response({"error": "Mentor profile required for this endpoint"}, 403)
    try:
        rows = mentorship_service.list_matches_for_mentor(sub)
        rows = _enrich_mentor_match_rows_with_mentee_profiles(rows)
        # Defensive cleanup: hide stale SUGGESTED/PENDING rows that are no longer actionable
        # because the mentee already reached active match cap with another mentor.
        max_mentee_matches = mentorship_service.mentee_max_active_matches()
        filtered_rows: list[dict] = []
        for r in rows:
            st = str((r or {}).get("status") or "").upper()
            if st in ("SUGGESTED", "PENDING_MENTOR"):
                eid = str((r or {}).get("menteeUserId") or "").strip()
                if eid and mentorship_service.count_channel_opened_for_mentee(eid) >= max_mentee_matches:
                    try:
                        mentorship_service.mark_skipped(sub, eid)
                    except Exception:
                        pass
                    continue
            filtered_rows.append(r)
        rows = filtered_rows
        btier, bmult, breason = mentorship_board.resolve_mentor_board_tier(mentor_profile)
        pause_until = _mentor_pause_until_str(mentor_profile)
        return _response(
            {
                "matches": rows,
                "count": len(rows),
                "mentorBoard": {"tier": btier, "multiplier": bmult, "reason": breason},
                "mentorPauseUntil": pause_until or None,
                "mentorPaused": _mentor_pause_is_active(mentor_profile),
            }
        )
    except Exception as e:
        return _response({"error": "Failed to list mentorship matches", "detail": str(e)}, 500)


def do_mentorship_mentor_pause_get(event: dict) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)
    mentor_profile = _get_student_profile(sub)
    if not mentor_profile and email:
        mentor_profile = _get_student_profile_by_any_email(email)
    if not _is_mentor_profile(mentor_profile):
        return _response({"error": "Mentor profile required for this endpoint"}, 403)
    pu = _mentor_pause_until_str(mentor_profile)
    return _response(
        {
            "mentorPauseUntil": pu or None,
            "mentorPaused": _mentor_pause_is_active(mentor_profile),
        }
    )


def do_mentorship_mentor_pause_put(event: dict, body: dict) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)
    mentor_profile = _get_student_profile(sub)
    if not mentor_profile and email:
        mentor_profile = _get_student_profile_by_any_email(email)
    if not _is_mentor_profile(mentor_profile):
        return _response({"error": "Mentor profile required for this endpoint"}, 403)
    if not student_profiles_table:
        return _response({"error": "Server misconfiguration"}, 500)

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if body.get("clear") is True:
        student_profiles_table.update_item(
            Key={"userId": sub},
            UpdateExpression="REMOVE mentorshipMentorPauseUntil SET updatedAt = :u",
            ExpressionAttributeValues={":u": now},
        )
        return _response({"mentorPauseUntil": None, "mentorPaused": False})

    until = (body.get("until") or "").strip()
    if not until:
        return _response({"error": "Provide until (YYYY-MM-DD) or clear: true"}, 400)
    try:
        datetime.strptime(until[:10], "%Y-%m-%d")
    except ValueError:
        return _response({"error": "until must be a calendar date YYYY-MM-DD"}, 400)
    day = until[:10]
    student_profiles_table.update_item(
        Key={"userId": sub},
        UpdateExpression="SET mentorshipMentorPauseUntil = :p, updatedAt = :u",
        ExpressionAttributeValues={":p": day, ":u": now},
    )
    cleared_suggestions = None
    if body.get("clearActiveSuggestions") is True:
        try:
            cleared_suggestions = mentorship_service.skip_all_active_suggestions_for_mentor(sub)
        except Exception as e:
            return _response({"error": "Pause saved but failed to clear pending mentees", "detail": str(e)}, 500)
    merged = dict(mentor_profile or {})
    merged["mentorshipMentorPauseUntil"] = day
    merged["updatedAt"] = now
    return _response(
        {
            "mentorPauseUntil": day,
            "mentorPaused": _mentor_pause_is_active(merged),
            **({"clearedSuggestions": cleared_suggestions} if cleared_suggestions is not None else {}),
        }
    )


def do_mentorship_profile_embeddings_me(event: dict) -> dict:
    """GET /mentorship/embeddings/me — store + return mentor- and mentee-canonical embeddings for caller."""
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    profile = _get_student_profile(sub)
    if not profile and email:
        profile = _get_student_profile_by_any_email(email)
    if not profile:
        return _response({"error": "Student profile not found"}, 404)

    qs = event.get("queryStringParameters") or {}
    refresh_raw = (qs.get("refresh") or "").strip().lower()
    refresh = refresh_raw in ("1", "true", "yes")
    include_raw = (qs.get("includeVector") or "true").strip().lower()
    include_vector = include_raw not in ("0", "false", "no")

    raw_token = auth.parse_token_from_header(event.get("headers") or {})
    target_user_id = str(profile.get("userId") or sub)

    try:
        payload = mentorship_service.get_or_refresh_profile_embeddings(
            target_user_id,
            profile,
            refresh=refresh,
            include_vector=include_vector,
            auth_token=raw_token,
        )
        return _response({"ok": True, **payload})
    except Exception as e:
        return _response({"ok": False, "error": "Failed to load or compute profile embeddings", "detail": str(e)}, 500)


def do_mentorship_embedding_config(event: dict) -> dict:
    """GET /mentorship/embedding-config — requires auth; probes Bedrock/OpenAI embedding provider."""
    try:
        _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)
    info = mentorship_embeddings.embedding_config_info()
    status_code = 200 if info.get("status") == "ok" else 503
    return _response(info, status_code)


def do_mentorship_accept(event: dict, mentee_user_id: str) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    mentor_profile = _get_student_profile(sub)
    if not mentor_profile and email:
        mentor_profile = _get_student_profile_by_any_email(email)
    if not _is_mentor_profile(mentor_profile):
        return _response({"error": "Mentor profile required for this endpoint"}, 403)

    mentee_profile = _get_student_profile(mentee_user_id)

    try:
        accepted = mentorship_service.accept_match(
            sub,
            mentee_user_id,
            mentor_profile=mentor_profile,
            mentee_profile=mentee_profile,
        )
        mentee_email = ""
        if mentee_profile:
            parts = _email_parts_from_csv(mentee_profile.get("email"))
            mentee_email = parts[0] if parts else ""
        email_result = {"sent": False, "mode": "missing_recipient"}
        portal_base = (os.environ.get("FRONTEND_BASE_URL") or "http://localhost:5173").rstrip("/")
        portal_url = f"{portal_base}/#mentorship"
        mentor_parts = _email_parts_from_csv(mentor_profile.get("email")) if mentor_profile else []
        mentor_contact_email = mentor_parts[0] if mentor_parts else ""
        channel_id = str(accepted.get("channelId") or "").strip()
        if mentee_email and channel_id:
            try:
                email_result = mentorship_service.send_accept_email(
                    mentee_email=mentee_email,
                    mentor_name=_name_from_profile(mentor_profile),
                    channel_id=channel_id,
                    mentor_company=(str(mentor_profile.get("mentorCompany") or "").strip() or None)
                    if mentor_profile
                    else None,
                    mentor_job_title=(str(mentor_profile.get("mentorJobTitle") or "").strip() or None)
                    if mentor_profile
                    else None,
                    mentor_email=mentor_contact_email or None,
                    portal_url=portal_url,
                )
            except Exception as e:
                email_result = {"sent": False, "mode": "error", "detail": str(e)}
        elif not channel_id:
            email_result = {"sent": False, "mode": "missing_channel_id"}
        return _response({"accepted": accepted, "email": email_result})
    except ValueError as e:
        if str(e) == "mentor_at_capacity":
            return _response({"error": "Mentor has reached their mentee capacity"}, 409)
        if str(e) == "mentee_at_match_cap":
            return _response(
                {
                    "error": "This student already has the maximum number of active mentor matches",
                    "detail": f"Limit is {mentorship_service.mentee_max_active_matches()} open matches per mentee.",
                },
                409,
            )
        if str(e) == "mentee_channel_unavailable":
            return _response(
                {
                    "error": "This mentee already has the maximum active matches, or the match row changed. "
                    "Refresh and try again.",
                },
                409,
            )
        if str(e) == "match_row_unavailable":
            return _response(
                {
                    "error": "This student pairing changed just now (for example, another accept action already completed). "
                    "The list is refreshed.",
                    "code": "match_row_unavailable",
                },
                409,
            )
        if str(e) == "suggestion_stale":
            return _response(
                {
                    "error": "This student is already matched with another mentor. The suggestion is closed so your list can refresh.",
                    "code": "suggestion_stale",
                },
                409,
            )
        return _response({"error": str(e)}, 400)
    except Exception as e:
        return _response({"error": "Failed to accept mentorship match", "detail": str(e)}, 500)


def do_mentorship_suggested_mentors(event: dict) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    mentee_profile = _get_student_profile(sub)
    if not mentee_profile and email:
        mentee_profile = _get_student_profile_by_any_email(email)
    if not _is_mentee_profile(mentee_profile):
        return _response({"error": "Mentee profile required for this endpoint"}, 403)

    try:
        mentors = _list_mentor_profiles(exclude_user_id=sub)
        raw_token = auth.parse_token_from_header(event.get("headers") or {})
        suggestions = mentorship_service.build_mentee_suggested_mentors(
            mentee_profile,
            mentors,
            mentee_auth_token=raw_token,
        )
        return _response({"suggestions": suggestions, "totalSuggestions": len(suggestions)})
    except Exception as e:
        return _response({"error": "Failed to build mentor suggestions", "detail": str(e)}, 500)


def do_mentorship_mentee_matches(event: dict) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    mentee_profile = _get_student_profile(sub)
    if not mentee_profile and email:
        mentee_profile = _get_student_profile_by_any_email(email)
    if not _is_mentee_profile(mentee_profile):
        return _response({"error": "Mentee profile required for this endpoint"}, 403)
    try:
        rows = mentorship_service.list_matches_for_mentee(sub)
        opened = [r for r in rows if str(r.get("status") or "").upper() == "CHANNEL_OPENED"]
        opened.sort(
            key=lambda r: str(r.get("updatedAt") or r.get("acceptedAt") or r.get("createdAt") or ""),
            reverse=True,
        )
        max_mentee_matches = mentorship_service.mentee_max_active_matches()
        mentee_limits = {
            "maxActiveMentorMatches": max_mentee_matches,
            "activeOpenedCount": len(opened),
        }

        if opened:
            row = dict(opened[0])
            row.pop("suggestedIcebreaker", None)
            mid = str(row.get("mentorUserId") or "").strip()
            if mid:
                mp = _get_student_profile(mid)
                if mp:
                    emails = _email_parts_from_csv(mp.get("email"))
                    if emails:
                        row["mentorEmail"] = emails[0]
                    row["mentorName"] = row.get("mentorName") or mp.get("name")
                    row["mentorCompany"] = mp.get("mentorCompany")
                    row["mentorJobTitle"] = mp.get("mentorJobTitle")
                    row["mentorIndustries"] = mp.get("mentorIndustries") or []
                    row["mentorMajor"] = mp.get("major")
                    row["mentorDegree"] = mp.get("degree")
                    if mp.get("linkedInUrl"):
                        row["mentorLinkedInUrl"] = mp.get("linkedInUrl")
                    btier, bmult, breason = mentorship_board.resolve_mentor_board_tier(mp)
                    row["mentorBoard"] = {"tier": btier, "multiplier": bmult, "reason": breason}
                else:
                    row["mentorBoard"] = {"tier": "none", "multiplier": 1.0, "reason": ""}
            else:
                row["mentorBoard"] = {"tier": "none", "multiplier": 1.0, "reason": ""}
            updated_at = row.get("updatedAt") or row.get("acceptedAt") or row.get("createdAt") or ""
            return _response(
                {
                    "state": "MATCHED",
                    "isMatching": False,
                    "matchedMentor": row,
                    "updatedAt": updated_at,
                    # Compatibility fields for existing clients.
                    "matches": [row],
                    "count": 1,
                    "menteeProgramLimits": mentee_limits,
                }
            )

        latest_updated = ""
        if rows:
            rows.sort(key=lambda r: str(r.get("updatedAt") or r.get("createdAt") or ""), reverse=True)
            latest = rows[0]
            latest_updated = latest.get("updatedAt") or latest.get("createdAt") or ""
        return _response(
            {
                "state": "MATCHING_IN_PROGRESS",
                "isMatching": True,
                "matchedMentor": None,
                "updatedAt": latest_updated,
                "matches": [],
                "count": 0,
                "menteeProgramLimits": mentee_limits,
            }
        )
    except Exception as e:
        return _response({"error": "Failed to list mentee matches", "detail": str(e)}, 500)


def do_mentorship_mentee_request(event: dict) -> dict:
    # Product policy: mentees cannot request mentors directly.
    return _response(
        {
            "error": "Mentee-initiated mentor requests are disabled.",
            "detail": "Mentor matching is admin-run; mentees see mentor details after mentor acceptance.",
        },
        410,
    )


def do_mentorship_skip(event: dict, mentee_user_id: str) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    mentor_profile = _get_student_profile(sub)
    if not mentor_profile and email:
        mentor_profile = _get_student_profile_by_any_email(email)
    if not _is_mentor_profile(mentor_profile):
        return _response({"error": "Mentor profile required for this endpoint"}, 403)
    try:
        result = mentorship_service.mark_skipped(sub, mentee_user_id)
        return _response({"skipped": result})
    except Exception as e:
        return _response({"error": "Failed to skip mentorship candidate", "detail": str(e)}, 500)


def do_mentorship_decline(event: dict, mentee_user_id: str) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    mentor_profile = _get_student_profile(sub)
    if not mentor_profile and email:
        mentor_profile = _get_student_profile_by_any_email(email)
    if not _is_mentor_profile(mentor_profile):
        return _response({"error": "Mentor profile required for this endpoint"}, 403)

    body = _parse_body(event)
    reason = body.get("reason")
    if reason is not None:
        reason = str(reason).strip() or None
    try:
        result = mentorship_service.mark_declined(sub, mentee_user_id, reason=reason)
        mentee_profile = _get_student_profile(mentee_user_id)
        email_result = {"sent": False, "mode": "missing_recipient"}
        if mentee_profile:
            parts = _email_parts_from_csv(mentee_profile.get("email"))
            mentee_email = parts[0] if parts else ""
            if mentee_email:
                try:
                    email_result = mentorship_service.send_decline_email(
                        mentee_email=mentee_email,
                        mentor_name=_name_from_profile(mentor_profile),
                    )
                except Exception as e:
                    email_result = {"sent": False, "mode": "error", "detail": str(e)}
        return _response({"declined": result, "email": email_result})
    except Exception as e:
        return _response({"error": "Failed to decline mentorship request", "detail": str(e)}, 500)


def do_mentorship_revive(event: dict, mentee_user_id: str) -> dict:
    try:
        sub, email = _get_user_from_bearer(event)
    except ValueError as e:
        code = str(e)
        if code == "missing_token":
            return _response({"error": "Authorization required"}, 401)
        return _response({"error": "Invalid or expired token"}, 401)

    mentor_profile = _get_student_profile(sub)
    if not mentor_profile and email:
        mentor_profile = _get_student_profile_by_any_email(email)
    if not _is_mentor_profile(mentor_profile):
        return _response({"error": "Mentor profile required for this endpoint"}, 403)
    try:
        result = mentorship_service.revive_declined_match(sub, mentee_user_id)
        return _response({"revived": result})
    except ValueError as e:
        if str(e) == "mentee_at_match_cap":
            return _response(
                {
                    "error": "This student already has the maximum number of active mentor matches",
                    "detail": f"Limit is {mentorship_service.mentee_max_active_matches()} open matches per mentee.",
                },
                409,
            )
        if str(e) == "not_declined_revivable":
            return _response(
                {"error": "Only previously declined matches can be revived, and the record must still exist."},
                400,
            )
        return _response({"error": str(e)}, 400)
    except Exception as e:
        return _response({"error": "Failed to revive mentorship match", "detail": str(e)}, 500)


def do_post_mentorship_matching_runs(event: dict, body: dict) -> dict:
    """
    POST /mentorship/admin/matching-runs
    Admin-only. Body: { "resetMatches"?: bool, "runBatchMatching"?: bool } (default runBatchMatching true).
    """
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    reset_matches = bool(body.get("resetMatches"))
    rb = body.get("runBatchMatching")
    run_batch_matching = True if rb is None else bool(rb)
    try:
        result = mentorship_service.run_mentorship_matching_run(
            reset_matches=reset_matches,
            run_batch_matching=run_batch_matching,
        )
        return _response(result, 200)
    except Exception as e:
        return _response({"error": "Mentorship matching run failed", "detail": str(e)}, 500)


def _enqueue_admin_matching_run(context: object, *, reset_matches: bool, run_batch_matching: bool, trigger_source: str) -> dict:
    request_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    target = (
        getattr(context, "invoked_function_arn", None)
        or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
        or ""
    )
    if not target:
        raise RuntimeError("Unable to resolve target lambda for async admin run")
    payload = {
        "source": "cmis.mentorship.admin-run",
        "triggerSource": trigger_source or "manual",
        "requestId": request_id,
        "runId": run_id,
        "resetMatches": bool(reset_matches),
        "runBatchMatching": bool(run_batch_matching),
    }
    _lambda_invoke_client().invoke(
        FunctionName=target,
        InvocationType="Event",
        Payload=json.dumps(payload).encode("utf-8"),
    )
    return {
        "accepted": True,
        "requestId": request_id,
        "runId": run_id,
        "triggerSource": trigger_source or "manual",
        "queuedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "QUEUED",
        "phase": "QUEUED",
    }


def do_enqueue_mentorship_admin_run(event: dict, body: dict, context: object, *, trigger_source: str = "manual") -> dict:
    """POST admin run endpoint (async enqueue + 202)."""
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    reset_matches = bool(body.get("resetMatches"))
    rb = body.get("runBatchMatching")
    run_batch_matching = True if rb is None else bool(rb)
    try:
        queued = _enqueue_admin_matching_run(
            context,
            reset_matches=reset_matches,
            run_batch_matching=run_batch_matching,
            trigger_source=trigger_source,
        )
        return _response(queued, 202)
    except Exception as e:
        return _response({"error": "Failed to queue mentorship admin run", "detail": str(e)}, 500)


def do_mentorship_admin_run(
    event: dict,
    body: dict,
    *,
    trigger_source: str = "manual",
    trusted_internal: bool = False,
) -> dict:
    """
    POST /mentorship/admin/run
    Admin-only alias for matching run trigger.
    """
    if (not trusted_internal) and trigger_source == "manual" and not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    reset_matches = bool(body.get("resetMatches"))
    rb = body.get("runBatchMatching")
    run_batch_matching = True if rb is None else bool(rb)
    run_id = str(body.get("runId") or "").strip() or None
    try:
        result = mentorship_service.run_admin_matching_job(
            reset_matches=reset_matches,
            run_batch_matching=run_batch_matching,
            trigger_source=trigger_source,
            run_id=run_id,
        )
        return _response(result, 200)
    except Exception as e:
        return _response({"error": "Mentorship admin run failed", "detail": str(e)}, 500)


def do_get_mentorship_admin_schedule(event: dict) -> dict:
    """GET /mentorship/admin/schedule"""
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    try:
        schedule = mentorship_service.get_matching_schedule_config()
        return _response(schedule, 200)
    except Exception as e:
        return _response({"error": "Failed to fetch mentorship schedule", "detail": str(e)}, 500)


def do_put_mentorship_admin_schedule(event: dict, body: dict) -> dict:
    """PUT /mentorship/admin/schedule"""
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    enabled = bool(body.get("enabled", True))
    cron_expression = body.get("cronExpression")
    timezone = body.get("timezone")
    try:
        sub, _email = _get_user_from_bearer(event)
    except Exception:
        sub = ""
    try:
        schedule = mentorship_service.put_matching_schedule_config(
            enabled=enabled,
            cron_expression=str(cron_expression).strip() if cron_expression is not None else None,
            timezone=str(timezone).strip() if timezone is not None else None,
            updated_by=sub or None,
        )
        return _response(schedule, 200)
    except Exception as e:
        return _response({"error": "Failed to update mentorship schedule", "detail": str(e)}, 500)


def do_get_mentorship_matching_runs_list(event: dict) -> dict:
    """GET /mentorship/admin/matching-runs?limit=25"""
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    if not mentorship_service.matching_runs_audit_configured():
        return _response({"runs": [], "persistenceEnabled": False}, 200)
    q = event.get("queryStringParameters") or {}
    try:
        limit = int((q.get("limit") or "25").strip() or "25")
    except ValueError:
        limit = 25
    rows = mentorship_service.list_stored_matching_runs(limit=limit)
    thin: list[dict] = []
    for r in rows:
        snap = r.get("snapshot") or {}
        thin.append(
            {
                "runId": r.get("runId"),
                "startedAt": r.get("startedAt"),
                "finishedAt": r.get("finishedAt"),
                "status": r.get("status"),
                "triggerSource": r.get("triggerSource"),
                "snapshotSummary": {
                    "pairCount": snap.get("pairCount"),
                    "mentorCount": len(snap.get("mentors") or []),
                }
                if snap
                else None,
            }
        )
    return _response({"runs": thin, "persistenceEnabled": True}, 200)


def do_get_mentorship_matching_run_latest(event: dict) -> dict:
    """GET /mentorship/admin/matching-runs/latest"""
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    if not mentorship_service.matching_runs_audit_configured():
        return _response({"error": "Run history not configured", "persistenceEnabled": False}, 404)
    row = mentorship_service.get_latest_stored_matching_run()
    if not row:
        return _response({"error": "No matching runs yet"}, 404)
    return _response({"run": row, "persistenceEnabled": True}, 200)


def do_get_mentorship_matching_run_by_id(event: dict, run_id: str) -> dict:
    """GET /mentorship/admin/matching-runs/{runId}"""
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    if not mentorship_service.matching_runs_audit_configured():
        return _response({"error": "Run history not configured", "persistenceEnabled": False}, 404)
    rid = (run_id or "").strip()
    if not rid or rid in ("latest", "list"):
        return _response({"error": "Invalid runId"}, 400)
    row = mentorship_service.get_stored_matching_run(rid)
    if not row:
        return _response({"error": "Run not found"}, 404)
    return _response({"run": row, "persistenceEnabled": True}, 200)


def do_get_mentorship_admin_mentee_cap_diagnostics(event: dict) -> dict:
    """GET /mentorship/admin/mentee-cap-diagnostics"""
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    q = event.get("queryStringParameters") or {}
    mentee_user_id = str((q.get("menteeUserId") or "")).strip() or None
    drift_only_raw = str((q.get("driftOnly") or "")).strip().lower()
    drift_only = drift_only_raw in ("1", "true", "yes", "y")
    try:
        limit = int(str((q.get("limit") or "200")).strip() or "200")
    except ValueError:
        limit = 200
    try:
        payload = mentorship_service.diagnose_mentee_channel_counters(
            mentee_user_id=mentee_user_id,
            limit=limit,
            drift_only=drift_only,
        )
        return _response(payload, 200)
    except Exception as e:
        return _response({"error": "Failed to load mentee cap diagnostics", "detail": str(e)}, 500)


def do_post_mentorship_admin_pair_suggest(event: dict, body: dict) -> dict:
    """
    POST /mentorship/admin/pair-suggest
    Admin-only. Body: { "mentorUserId": string, "menteeUserId": string }
    Deletes all match rows for the mentee, then creates one SUGGESTED row for the given mentor.
    """
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    mentor_uid = str((body.get("mentorUserId") or "")).strip()
    mentee_uid = str((body.get("menteeUserId") or "")).strip()
    if not mentor_uid or not mentee_uid:
        return _response({"error": "mentorUserId and menteeUserId are required"}, 400)
    try:
        result = mentorship_service.admin_reset_mentee_and_suggest_to_mentor(mentor_uid, mentee_uid)
        code = 200 if result.get("ok") else 400
        return _response(result, code)
    except ValueError as e:
        return _response({"error": str(e), "ok": False}, 400)
    except Exception as e:
        return _response({"error": "pair_suggest_failed", "detail": str(e), "ok": False}, 500)


def do_post_mentorship_admin_mentee_cap_repair(event: dict, body: dict) -> dict:
    """POST /mentorship/admin/mentee-cap-diagnostics/repair"""
    if not _is_requester_admin(event):
        return _response({"error": "Admin access required"}, 403)
    mentee_user_id = str((body.get("menteeUserId") or "")).strip() or None
    drift_only = True if body.get("driftOnly") is None else bool(body.get("driftOnly"))
    try:
        limit = int(str((body.get("limit") or "200")).strip() or "200")
    except ValueError:
        limit = 200
    try:
        payload = mentorship_service.repair_mentee_channel_counters(
            mentee_user_id=mentee_user_id,
            limit=limit,
            drift_only=drift_only,
        )
        return _response(payload, 200)
    except Exception as e:
        return _response({"error": "Failed to repair mentee cap counters", "detail": str(e)}, 500)


def _get_student_profile_by_any_email(login_email: str | None) -> dict | None:
    """Find StudentProfiles row by any email alias in CSV field."""
    if not student_profiles_table:
        raise RuntimeError("STUDENT_PROFILES_TABLE is not configured")
    target = (login_email or "").strip().lower()
    if not target:
        return None

    start_key = None
    while True:
        kwargs = {"ProjectionExpression": "userId, email"}
        if start_key:
            kwargs["ExclusiveStartKey"] = start_key
        r = student_profiles_table.scan(**kwargs)
        for item in r.get("Items") or []:
            if target in _email_parts_from_csv(item.get("email")):
                full = student_profiles_table.get_item(Key={"userId": item.get("userId")})
                return full.get("Item")
        start_key = r.get("LastEvaluatedKey")
        if not start_key:
            break
    return None


def _resolve_cognito_username(user_pool_id: str, sub: str, email: str | None = None) -> str | None:
    """Resolve Cognito Username for Admin* APIs.

    Never use `sub` as Username — Cognito Admin* calls expect the pool Username (often email,
    or a federated prefix). Passing sub causes UserNotFoundException.
    """
    cidp = _cognito_idp_client()
    try:
        out = cidp.list_users(UserPoolId=user_pool_id, Filter=f'sub = "{sub}"', Limit=2)
        users = out.get("Users") or []
        if users and users[0].get("Username"):
            return users[0]["Username"]
    except ClientError:
        pass

    if email:
        em = email.strip()
        try:
            out = cidp.list_users(UserPoolId=user_pool_id, Filter=f'email = "{em}"', Limit=2)
            users = out.get("Users") or []
            if users and users[0].get("Username"):
                return users[0]["Username"]
        except ClientError:
            pass
        # Email-as-username pools: Username is often the email string.
        try:
            resp = cidp.admin_get_user(UserPoolId=user_pool_id, Username=em)
            if resp.get("Username"):
                return resp["Username"]
        except ClientError:
            pass
    return None


def _resolve_cognito_username_by_email(user_pool_id: str, email: str) -> str | None:
    """
    Resolve Cognito Username given an email-like login identifier.

    Important: for some federated logins, the Cognito user's `email` attribute
    may not equal the login alias (personal email). In those cases, resolving
    via `list_users(Filter="email = ...")` can fail even though the user exists.
    So we:
    - try list_users by `email`
    - then fall back to AdminGetUser with Username=<email> (common when Username is email)
    """
    if not email:
        return None

    normalized = (email or "").strip()
    if not normalized:
        return None

    cidp = _cognito_idp_client()

    # 1) Try resolving by the Cognito `email` attribute.
    try:
        out = cidp.list_users(
            UserPoolId=user_pool_id,
            Filter=f'email = "{normalized}"',
            Limit=2,
        )
        users = out.get("Users") or []
        if users and users[0].get("Username"):
            return users[0]["Username"]
    except ClientError:
        pass

    # 2) Fall back to treating the email as the pool Username.
    # This covers common setups where Username==email even if `email` attribute differs.
    try:
        resp = cidp.admin_get_user(UserPoolId=user_pool_id, Username=normalized)
        if resp.get("Username"):
            return resp["Username"]
    except ClientError:
        return None

    return None


def _ensure_cmis_alumni_membership(sub: str, email: str | None = None, personal_email: str | None = None) -> None:
    """After handover, ensure relevant CMIS users are in both friends + alumni groups."""
    if not CMIS_USER_POOL_ID:
        return
    cidp = _cognito_idp_client()
    usernames: set[str] = set()
    primary = _resolve_cognito_username(CMIS_USER_POOL_ID, sub, email=email)
    if primary:
        usernames.add(primary)
    if personal_email:
        personal_username = _resolve_cognito_username_by_email(CMIS_USER_POOL_ID, personal_email)
        if personal_username:
            usernames.add(personal_username)

    for username in usernames:
        for group_name in [CMIS_GROUP_FRIENDS, CMIS_GROUP_ALUMNI]:
            try:
                cidp.admin_add_user_to_group(
                    UserPoolId=CMIS_USER_POOL_ID,
                    Username=username,
                    GroupName=group_name,
                )
            except ClientError as e:
                code = e.response.get("Error", {}).get("Code", "")
                # Already in group — ok
                if code == "ResourceConflictException":
                    continue
                raise


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


def do_mentorship_annual_batch() -> dict:
    """EventBridge: greedy annual mentorship suggestions (Sept 1 schedule)."""
    try:
        result = mentorship_service.run_annual_batch_matching()
        return _response(result, 200)
    except Exception as e:
        return _response({"error": "Mentorship annual batch failed", "detail": str(e)}, 500)


def do_mentorship_late_registration(event: dict) -> dict:
    """Async invoke from student-service when a mentee profile is created or switches to mentee."""
    mentee_uid = str((event or {}).get("menteeUserId") or "").strip()
    if not mentee_uid:
        return _response({"error": "menteeUserId required"}, 400)
    try:
        result = mentorship_service.run_single_mentee_matching(mentee_uid)
        return _response(result, 200)
    except Exception as e:
        return _response({"error": "Late registration matching failed", "detail": str(e)}, 500)


def do_mentorship_profile_saved_embeddings(event: dict) -> dict:
    """Async fire-and-forget trigger from student-service after profile save/edit."""
    uid = str((event or {}).get("userId") or "").strip()
    if not uid:
        return _response({"error": "missing_user_id"}, 400)
    profile = _get_student_profile(uid)
    if not profile:
        return _response({"error": "profile_not_found"}, 404)
    try:
        payload = mentorship_service.get_or_refresh_profile_embeddings(
            uid,
            profile,
            refresh=True,
            include_vector=False,
            auth_token=None,
        )
        return _response(
            {
                "ok": True,
                "userId": uid,
                "source": payload.get("source") or "computed",
                "updatedAt": (payload.get("mentor") or {}).get("updatedAt") or (payload.get("mentee") or {}).get("updatedAt"),
            },
            200,
        )
    except Exception as e:
        return _response({"error": "profile_embedding_precompute_failed", "detail": str(e)}, 500)


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
        _ensure_cmis_alumni_membership(sub, email=email, personal_email=personal_email)
        # Do NOT overwrite CMIS Cognito `email` to only the personal address: that breaks TAMU Google SSO
        # for the same user. Both addresses are stored on StudentProfiles.email (CSV); personal-email
        # login is matched via student-service getByAnyEmail against that CSV (may use a second Cognito user).
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
            sub, login_email = _get_user_from_bearer(event)
            prof = _get_student_profile(sub)
            if not prof and login_email:
                prof = _get_student_profile_by_any_email(login_email)
            role = (prof or {}).get("role")
            linked_uin = (prof or {}).get("uin")
            if role == "FORMER_STUDENT":
                return _response({"showPrompt": False, "reason": "already_alumni", "role": role, "linkedUin": linked_uin})

            # Only TAMU-email profiles can be prompted for alumni conversion.
            # If a user profile contains only personal-email aliases, we suppress the prompt.
            email_field = (prof or {}).get("email") or ""
            parts = [p.strip().lower() for p in str(email_field).split(",") if p and p.strip()]
            has_tamu = any(p.endswith("@tamu.edu") for p in parts)
            if not has_tamu:
                return _response({"showPrompt": False, "reason": "not_tamu_email", "role": role, "linkedUin": linked_uin})
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
    # Custom scheduled / async payloads (must run before generic aws.events graduation rule)
    if isinstance(event, dict) and event.get("source") == "scheduled-batch":
        return _response(mentorship_service.run_scheduled_matching_if_due(), 200)
    if isinstance(event, dict) and event.get("source") == "late-registration":
        return do_mentorship_late_registration(event)
    if isinstance(event, dict) and event.get("source") == "cmis.mentorship.batch":
        return _response(mentorship_service.run_scheduled_matching_if_due(), 200)
    if isinstance(event, dict) and event.get("source") == "cmis.mentorship.late-registration":
        return do_mentorship_late_registration(event)
    if isinstance(event, dict) and event.get("source") == "cmis.mentorship.profile-saved":
        return do_mentorship_profile_saved_embeddings(event)
    if isinstance(event, dict) and event.get("source") == "cmis.mentorship.admin-run":
        body = {
            "resetMatches": bool(event.get("resetMatches")),
            "runBatchMatching": True if event.get("runBatchMatching") is None else bool(event.get("runBatchMatching")),
        }
        trigger_source = str(event.get("triggerSource") or "manual")
        return do_mentorship_admin_run(
            event,
            body,
            trigger_source=trigger_source,
            trusted_internal=True,
        )

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

    if path_parts == ["mentorship", "embedding-config"] and method == "GET":
        return do_mentorship_embedding_config(event)

    if (
        len(path_parts) >= 3
        and path_parts[0] == "mentorship"
        and path_parts[1] == "admin"
        and path_parts[2] == "matching-runs"
    ):
        if method == "GET" and len(path_parts) == 3:
            return do_get_mentorship_matching_runs_list(event)
        if method == "GET" and len(path_parts) == 4:
            seg = path_parts[3]
            if seg == "latest":
                return do_get_mentorship_matching_run_latest(event)
            return do_get_mentorship_matching_run_by_id(event, seg)
        if method == "POST" and len(path_parts) == 3:
            return do_enqueue_mentorship_admin_run(event, body, context, trigger_source="manual")

    if path_parts == ["mentorship", "admin", "run"] and method == "POST":
        return do_enqueue_mentorship_admin_run(event, body, context, trigger_source="manual")

    if path_parts == ["mentorship", "admin", "schedule"] and method == "GET":
        return do_get_mentorship_admin_schedule(event)

    if path_parts == ["mentorship", "admin", "schedule"] and method == "PUT":
        return do_put_mentorship_admin_schedule(event, body)

    if path_parts == ["mentorship", "admin", "mentee-cap-diagnostics"] and method == "GET":
        return do_get_mentorship_admin_mentee_cap_diagnostics(event)
    if path_parts == ["mentorship", "admin", "mentee-cap-diagnostics", "repair"] and method == "POST":
        return do_post_mentorship_admin_mentee_cap_repair(event, body)

    if path_parts == ["mentorship", "admin", "pair-suggest"] and method == "POST":
        return do_post_mentorship_admin_pair_suggest(event, body)

    if path_parts == ["mentorship", "embeddings", "me"] and method == "GET":
        return do_mentorship_profile_embeddings_me(event)

    if path_parts == ["mentorship", "candidates"] and method == "GET":
        return do_mentorship_candidates(event)

    if path_parts == ["mentorship", "mentor", "pause"] and method == "GET":
        return do_mentorship_mentor_pause_get(event)

    if path_parts == ["mentorship", "mentor", "pause"] and method == "PUT":
        return do_mentorship_mentor_pause_put(event, body)

    if path_parts == ["mentorship", "matches"] and method == "GET":
        return do_mentorship_list_matches(event)

    if path_parts == ["mentorship", "suggested-mentors"] and method == "GET":
        return do_mentorship_suggested_mentors(event)

    if path_parts == ["mentorship", "mentee", "matches"] and method == "GET":
        return do_mentorship_mentee_matches(event)

    if path_parts == ["mentorship", "mentee", "request"] and method == "POST":
        return _response(
            {
                "error": "Mentee-initiated mentor requests are disabled.",
                "detail": "Use admin-run matching; mentor details appear after mentor acceptance.",
            },
            410,
        )

    if len(path_parts) == 4 and path_parts[0] == "mentorship" and path_parts[1] == "matches":
        mentee_user_id = path_parts[2]
        action = path_parts[3]
        if method == "POST" and action == "accept":
            return do_mentorship_accept(event, mentee_user_id)
        if method == "POST" and action == "skip":
            return do_mentorship_skip(event, mentee_user_id)
        if method == "POST" and action == "decline":
            return do_mentorship_decline(event, mentee_user_id)
        if method == "POST" and action == "revive":
            return do_mentorship_revive(event, mentee_user_id)

    return _response({"error": "Not Found", "path": "/" + "/".join(path_parts)}, 404)
