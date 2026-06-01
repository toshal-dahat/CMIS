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
from typing import Any

import boto3

import mentorship_embeddings
import mentorship_matching


_dynamo = boto3.resource("dynamodb")
_table = None


def _matches_table():
    global _table
    if _table is None:
        table_name = (os.environ.get("MENTORSHIP_MATCHES_TABLE") or "").strip()
        if not table_name:
            raise RuntimeError("MENTORSHIP_MATCHES_TABLE is not configured")
        _table = _dynamo.Table(table_name)
    return _table


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _to_score(value: float) -> float:
    return round(float(value), 6)


def build_mentor_candidates(mentor_profile: dict, mentee_profiles: list[dict]) -> list[dict]:
    provider = mentorship_embeddings.get_embedding_provider()
    mentor_text = mentorship_matching.mentor_profile_to_text(mentor_profile)
    mentee_texts = [mentorship_matching.mentee_profile_to_text(p) for p in mentee_profiles]
    vectors = provider.embed_texts([mentor_text] + mentee_texts)
    if len(vectors) != len(mentee_profiles) + 1:
        raise RuntimeError("Embedding provider returned an unexpected vector count")
    mentor_vec = vectors[0]
    mentee_vecs = vectors[1:]

    rows = []
    for p, vec in zip(mentee_profiles, mentee_vecs):
        score = mentorship_matching.cosine_similarity(mentor_vec, vec)
        rows.append(
            {
                "menteeUserId": p.get("userId"),
                "menteeName": p.get("name"),
                "menteeEmail": p.get("email"),
                "menteeMajor": p.get("major"),
                "menteeGradDate": p.get("gradDate"),
                "menteeSkills": p.get("profileSkillKeys") or [],
                "similarityScore": _to_score(score),
                "reasonSummary": "Semantic profile similarity from mentor details and mentee profile/resume data.",
                "embeddingMeta": provider.metadata(),
            }
        )
    rows.sort(key=lambda r: r["similarityScore"], reverse=True)
    return rows


def upsert_suggestions(mentor_user_id: str, candidates: list[dict], limit: int = 20) -> list[dict]:
    table = _matches_table()
    now = _now_iso()
    persisted = []
    for c in candidates[:limit]:
        mentee_user_id = c.get("menteeUserId")
        if not mentee_user_id:
            continue
        item = {
            "mentorUserId": mentor_user_id,
            "menteeUserId": mentee_user_id,
            "status": "SUGGESTED",
            "similarityScore": c.get("similarityScore", 0.0),
            "reasonSummary": c.get("reasonSummary", ""),
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
    items.sort(key=lambda i: float(i.get("similarityScore") or 0), reverse=True)
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

