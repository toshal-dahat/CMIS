"""
Mentorship matching + match record operations.

Storage table (DynamoDB):
- env: MENTORSHIP_MATCHES_TABLE
- PK: mentorUserId (string)
- SK: menteeUserId (string)
"""

from __future__ import annotations

import os
import time
import uuid
import json
import urllib.request
import urllib.error
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

import mentorship_embeddings
import mentorship_matching


_dynamo = boto3.resource("dynamodb")
_table = None
_resumes_table = None


def _matches_table():
    global _table
    if _table is None:
        table_name = (os.environ.get("MENTORSHIP_MATCHES_TABLE") or "").strip()
        if not table_name:
            raise RuntimeError("MENTORSHIP_MATCHES_TABLE is not configured")
        _table = _dynamo.Table(table_name)
    return _table


def _resumes_table_ref():
    global _resumes_table
    if _resumes_table is None:
        table_name = (os.environ.get("RESUMES_TABLE") or "").strip()
        if not table_name:
            raise RuntimeError("RESUMES_TABLE is not configured")
        _resumes_table = _dynamo.Table(table_name)
    return _resumes_table


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _to_score(value: float) -> float:
    return round(float(value), 6)


def _semantic_weight() -> float:
    raw = (os.environ.get("MENTORSHIP_SCORING_SEMANTIC_WEIGHT") or "0.75").strip()
    try:
        return max(0.0, min(1.0, float(raw)))
    except Exception:
        return 0.75


def _rule_weight() -> float:
    raw = (os.environ.get("MENTORSHIP_SCORING_RULE_WEIGHT") or "0.25").strip()
    try:
        return max(0.0, min(1.0, float(raw)))
    except Exception:
        return 0.25


def _top_k() -> int:
    raw = (os.environ.get("MENTORSHIP_TOP_K") or "20").strip()
    try:
        return max(1, min(100, int(raw)))
    except Exception:
        return 20


def _student_resumes_me_url() -> str:
    return (
        os.environ.get("STUDENT_RESUMES_ME_URL")
        or "https://peux35p02a.execute-api.us-east-1.amazonaws.com/dev/student/api/resumes/me"
    ).strip()


def _fetch_latest_extracted_resume_via_api(auth_token: str | None) -> dict | None:
    if not auth_token:
        return None
    req = urllib.request.Request(
        _student_resumes_me_url(),
        method="GET",
        headers={
            "Authorization": f"Bearer {auth_token}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError):
        return None

    rows = payload.get("resumes") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return None
    extracted = [r for r in rows if r.get("status") == "EXTRACTED" and isinstance(r.get("extractedData"), dict)]
    if not extracted:
        return None
    extracted.sort(key=lambda r: str(r.get("updatedAt") or r.get("createdAt") or ""), reverse=True)
    return extracted[0]


def _choose_latest_extracted_resume(user_id: str) -> dict | None:
    table = _resumes_table_ref()
    result = table.query(
        KeyConditionExpression=Key("userSub").eq(user_id),
    )
    rows = result.get("Items") or []
    while "LastEvaluatedKey" in result:
        result = table.query(
            KeyConditionExpression=Key("userSub").eq(user_id),
            ExclusiveStartKey=result["LastEvaluatedKey"],
        )
        rows.extend(result.get("Items") or [])

    extracted = [r for r in rows if r.get("status") == "EXTRACTED" and isinstance(r.get("extractedData"), dict)]
    if not extracted:
        return None
    extracted.sort(key=lambda r: str(r.get("updatedAt") or r.get("createdAt") or ""), reverse=True)
    return extracted[0]


def _attach_resume_data(profile: dict, auth_token: str | None = None) -> dict:
    if not profile:
        return profile
    user_id = profile.get("userId")
    if not user_id:
        return profile
    latest = _fetch_latest_extracted_resume_via_api(auth_token) if auth_token else None
    if latest is None:
        try:
            latest = _choose_latest_extracted_resume(str(user_id))
        except Exception:
            latest = None
    if latest and isinstance(latest.get("extractedData"), dict):
        merged = dict(profile)
        merged["resumeExtractedData"] = latest["extractedData"]
        return merged
    return profile


def build_mentor_candidates(mentor_profile: dict, mentee_profiles: list[dict], mentor_auth_token: str | None = None) -> list[dict]:
    mentor_profile = _attach_resume_data(mentor_profile, auth_token=mentor_auth_token)
    enriched_mentees = [_attach_resume_data(p) for p in mentee_profiles]
    provider = mentorship_embeddings.get_embedding_provider()
    mentor_text = mentorship_matching.mentor_profile_to_text(mentor_profile)
    mentee_texts = [mentorship_matching.mentee_profile_to_text(p) for p in enriched_mentees]
    vectors = provider.embed_texts([mentor_text] + mentee_texts)
    if len(vectors) != len(enriched_mentees) + 1:
        raise RuntimeError("Embedding provider returned an unexpected vector count")
    mentor_vec = vectors[0]
    mentee_vecs = vectors[1:]
    semantic_w = _semantic_weight()
    rule_w = _rule_weight()

    rows = []
    for p, vec in zip(enriched_mentees, mentee_vecs):
        semantic_score = mentorship_matching.cosine_similarity(mentor_vec, vec)
        rule_score, reasons = mentorship_matching.rule_scoring(mentor_profile, p)
        final_score = (semantic_w * semantic_score) + (rule_w * rule_score)
        reason_summary = (
            "; ".join(reasons)
            if reasons
            else "Semantic profile similarity from mentor details and mentee profile/resume data."
        )
        rows.append(
            {
                "menteeUserId": p.get("userId"),
                "menteeName": p.get("name"),
                "menteeEmail": p.get("email"),
                "menteeMajor": p.get("major"),
                "menteeGradDate": p.get("gradDate"),
                "menteeSkills": p.get("profileSkillKeys") or [],
                "similarityScore": _to_score(semantic_score),
                "semanticScore": _to_score(semantic_score),
                "ruleScore": _to_score(rule_score),
                "finalScore": _to_score(final_score),
                "matchedSignals": reasons,
                "reasonSummary": reason_summary,
                "embeddingMeta": provider.metadata(),
            }
        )
    rows.sort(key=lambda r: r["finalScore"], reverse=True)
    return rows


def upsert_suggestions(mentor_user_id: str, candidates: list[dict], limit: int | None = None) -> list[dict]:
    table = _matches_table()
    now = _now_iso()
    persisted = []
    limit_value = limit if isinstance(limit, int) and limit > 0 else _top_k()
    for c in candidates[:limit_value]:
        mentee_user_id = c.get("menteeUserId")
        if not mentee_user_id:
            continue
        item = {
            "mentorUserId": mentor_user_id,
            "menteeUserId": mentee_user_id,
            "status": "SUGGESTED",
            "similarityScore": c.get("similarityScore", 0.0),
            "semanticScore": c.get("semanticScore", 0.0),
            "ruleScore": c.get("ruleScore", 0.0),
            "finalScore": c.get("finalScore", c.get("similarityScore", 0.0)),
            "reasonSummary": c.get("reasonSummary", ""),
            "matchedSignals": c.get("matchedSignals") or [],
            "embeddingMeta": c.get("embeddingMeta") or {},
            "menteeName": c.get("menteeName"),
            "menteeEmail": c.get("menteeEmail"),
            "menteeMajor": c.get("menteeMajor"),
            "menteeGradDate": c.get("menteeGradDate"),
            "menteeSkills": c.get("menteeSkills") or [],
            "updatedAt": now,
        }
        # Preserve createdAt for existing records.
        existing = table.get_item(Key={"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id}).get("Item")
        item["createdAt"] = (existing or {}).get("createdAt", now)
        if existing and existing.get("status") in ("ACCEPTED_BY_MENTOR", "CHANNEL_OPENED"):
            item["status"] = existing.get("status")
            item["channelId"] = existing.get("channelId")
            item["acceptedAt"] = existing.get("acceptedAt")
        table.put_item(Item=item)
        persisted.append(item)
    return persisted


def list_matches_for_mentor(mentor_user_id: str) -> list[dict]:
    table = _matches_table()
    result = table.query(
        KeyConditionExpression="mentorUserId = :m",
        ExpressionAttributeValues={":m": mentor_user_id},
    )
    items = result.get("Items") or []
    while "LastEvaluatedKey" in result:
        result = table.query(
            KeyConditionExpression="mentorUserId = :m",
            ExpressionAttributeValues={":m": mentor_user_id},
            ExclusiveStartKey=result["LastEvaluatedKey"],
        )
        items.extend(result.get("Items") or [])
    items.sort(key=lambda i: float(i.get("finalScore") or i.get("similarityScore") or 0), reverse=True)
    return items


def mark_skipped(mentor_user_id: str, mentee_user_id: str) -> dict:
    table = _matches_table()
    now = _now_iso()
    table.update_item(
        Key={"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id},
        UpdateExpression="SET #s = :s, updatedAt = :u, skippedAt = :u",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "SKIPPED_BY_MENTOR", ":u": now},
    )
    return {"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id, "status": "SKIPPED_BY_MENTOR", "updatedAt": now}


def accept_match(mentor_user_id: str, mentee_user_id: str) -> dict:
    table = _matches_table()
    now = _now_iso()
    channel_id = f"mentor-{mentor_user_id[:8]}-mentee-{mentee_user_id[:8]}-{uuid.uuid4().hex[:8]}"
    table.update_item(
        Key={"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id},
        UpdateExpression="SET #s = :s, channelId = :c, acceptedAt = :a, updatedAt = :u",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":s": "CHANNEL_OPENED",
            ":c": channel_id,
            ":a": now,
            ":u": now,
        },
    )
    return {
        "mentorUserId": mentor_user_id,
        "menteeUserId": mentee_user_id,
        "status": "CHANNEL_OPENED",
        "channelId": channel_id,
        "acceptedAt": now,
    }


def send_accept_email(mentee_email: str, mentor_name: str, channel_id: str) -> dict[str, Any]:
    ses_sender = os.environ.get("SES_VERIFIED_SENDER")
    if not ses_sender:
        return {"sent": False, "mode": "log_only"}
    ses = boto3.client("ses")
    ses.send_email(
        Source=ses_sender,
        Destination={"ToAddresses": [mentee_email]},
        Message={
            "Subject": {"Data": "You have been matched with a mentor"},
            "Body": {
                "Text": {
                    "Data": (
                        f"Good news! {mentor_name} accepted your mentorship match.\n\n"
                        f"Channel ID: {channel_id}\n"
                        "Please sign in to the Mentorship section to continue."
                    )
                }
            },
        },
    )
    return {"sent": True, "mode": "ses"}

