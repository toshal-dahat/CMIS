"""
Mentorship matching + match record operations.

Storage table (DynamoDB):
- env: MENTORSHIP_MATCHES_TABLE
- PK: mentorUserId (string)
- SK: menteeUserId (string)
"""

from __future__ import annotations

import copy
import os
import time
import uuid
import json
import urllib.request
import urllib.error
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

import mentorship_board
import mentorship_embeddings
import mentorship_matching
import mentorship_narrator


_dynamo = boto3.resource("dynamodb")
_table = None
_resumes_table = None
_embeddings_table = None


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


def _embeddings_table_ref():
    global _embeddings_table
    if _embeddings_table is None:
        table_name = (os.environ.get("MENTORSHIP_EMBEDDINGS_TABLE") or "").strip()
        if not table_name:
            raise RuntimeError("MENTORSHIP_EMBEDDINGS_TABLE is not configured")
        _embeddings_table = _dynamo.Table(table_name)
    return _embeddings_table


def _dynamo_convert(obj: Any) -> Any:
    """Recursively convert Python floats to Decimal for DynamoDB put/update Items."""
    if obj is None:
        return None
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, int):
        return obj
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, Decimal):
        return obj
    if isinstance(obj, str):
        return obj
    if isinstance(obj, (list, tuple)):
        return [_dynamo_convert(x) for x in obj]
    if isinstance(obj, dict):
        return {str(k): _dynamo_convert(v) for k, v in obj.items()}
    return str(obj)


def _float_vector_from_item(vec: Any) -> list[float]:
    if not vec or not isinstance(vec, list):
        return []
    out: list[float] = []
    for x in vec:
        try:
            out.append(float(x))
        except (TypeError, ValueError):
            continue
    return out


def _serialize_stored_embedding(item: dict | None, include_vector: bool) -> dict[str, Any]:
    if not item:
        return {}
    row: dict[str, Any] = {
        "profileKind": item.get("profileKind"),
        "dimensions": item.get("dimensions"),
        "canonicalTextPreview": item.get("canonicalTextPreview") or "",
        "embeddingMeta": item.get("embeddingMeta") or {},
        "updatedAt": item.get("updatedAt"),
    }
    if include_vector:
        row["vector"] = _float_vector_from_item(item.get("vector"))
    return row


def _put_profile_embedding_row(
    user_id: str,
    profile_kind: str,
    vector: list[float],
    canonical_text: str,
    meta: dict[str, Any],
) -> None:
    table = _embeddings_table_ref()
    safe_meta: dict[str, Any] = {}
    for k, v in (meta or {}).items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            safe_meta[str(k)] = v
        else:
            safe_meta[str(k)] = str(v)
    preview = (canonical_text or "")[:3500]
    item = {
        "userId": user_id,
        "profileKind": profile_kind,
        "dimensions": len(vector),
        "vector": [float(x) for x in vector],
        "canonicalTextPreview": preview,
        "embeddingMeta": safe_meta,
        "updatedAt": _now_iso(),
    }
    table.put_item(Item=_dynamo_convert(copy.deepcopy(item)))


def _get_profile_embedding_row(user_id: str, profile_kind: str) -> dict | None:
    table = _embeddings_table_ref()
    r = table.get_item(Key={"userId": user_id, "profileKind": profile_kind})
    return r.get("Item")


def refresh_and_store_both_profile_embeddings(
    user_id: str,
    profile: dict,
    auth_token: str | None = None,
) -> dict[str, Any]:
    provider = mentorship_embeddings.get_embedding_provider()
    enriched = _attach_resume_data(dict(profile), auth_token=auth_token)
    mentor_text = mentorship_matching.mentor_profile_to_text(enriched)
    mentee_text = mentorship_matching.mentee_profile_to_text(enriched)
    vectors = provider.embed_texts([mentor_text, mentee_text])
    if len(vectors) != 2:
        raise RuntimeError("Embedding provider returned an unexpected vector count for profile pair")
    meta = provider.metadata()
    _put_profile_embedding_row(user_id, "mentor", vectors[0], mentor_text, meta)
    _put_profile_embedding_row(user_id, "mentee", vectors[1], mentee_text, meta)
    now = _now_iso()
    return {
        "userId": user_id,
        "source": "computed",
        "embeddingMeta": meta,
        "mentor": {
            "profileKind": "mentor",
            "dimensions": len(vectors[0]),
            "canonicalTextPreview": mentor_text[:3500],
            "embeddingMeta": meta,
            "updatedAt": now,
            "vector": [float(x) for x in vectors[0]],
        },
        "mentee": {
            "profileKind": "mentee",
            "dimensions": len(vectors[1]),
            "canonicalTextPreview": mentee_text[:3500],
            "embeddingMeta": meta,
            "updatedAt": now,
            "vector": [float(x) for x in vectors[1]],
        },
    }


def get_or_refresh_profile_embeddings(
    user_id: str,
    profile: dict,
    *,
    refresh: bool,
    include_vector: bool,
    auth_token: str | None = None,
) -> dict[str, Any]:
    if not refresh:
        m_item = _get_profile_embedding_row(user_id, "mentor")
        e_item = _get_profile_embedding_row(user_id, "mentee")
        if m_item and e_item:
            return {
                "userId": user_id,
                "source": "dynamodb",
                "mentor": _serialize_stored_embedding(m_item, include_vector),
                "mentee": _serialize_stored_embedding(e_item, include_vector),
            }
    payload = refresh_and_store_both_profile_embeddings(user_id, profile, auth_token=auth_token)
    if not include_vector:
        for key in ("mentor", "mentee"):
            block = payload.get(key)
            if isinstance(block, dict) and "vector" in block:
                del block["vector"]
    return payload


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _to_score(value: float) -> float:
    return round(float(value), 6)


def _cap_unit_score(value: float) -> float:
    """Final / boosted scores are kept in [0, 1] after board multiplier."""
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


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


def _narrator_top_k() -> int:
    """Cap Bedrock Nova calls per request (each top row runs multiple LLM invocations)."""
    raw = (os.environ.get("MENTORSHIP_NARRATOR_TOP_K") or "5").strip()
    try:
        return max(1, min(_top_k(), int(raw)))
    except Exception:
        return min(5, _top_k())


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


def _query_resumes_for_user(user_id: str) -> list[dict]:
    table = _resumes_table_ref()
    result = table.query(KeyConditionExpression=Key("userSub").eq(user_id))
    rows = list(result.get("Items") or [])
    while "LastEvaluatedKey" in result:
        result = table.query(
            KeyConditionExpression=Key("userSub").eq(user_id),
            ExclusiveStartKey=result["LastEvaluatedKey"],
        )
        rows.extend(result.get("Items") or [])
    return rows


def _choose_latest_extracted_resume(user_id: str) -> dict | None:
    rows = _query_resumes_for_user(user_id)
    extracted = [r for r in rows if r.get("status") == "EXTRACTED" and isinstance(r.get("extractedData"), dict)]
    if not extracted:
        return None
    extracted.sort(key=lambda r: str(r.get("updatedAt") or r.get("createdAt") or ""), reverse=True)
    return extracted[0]


def _resume_status_rank(status: Any) -> int:
    s = str(status or "").upper()
    if s == "EXTRACTED":
        return 3
    if s == "UPLOADED":
        return 2
    if s == "UPLOADING":
        return 1
    return 0


def _latest_resume_s3_for_user(user_id: str) -> tuple[str | None, str | None]:
    """Best s3Key + optional fileName from Resumes table for a student."""
    rows = [r for r in _query_resumes_for_user(user_id) if r.get("s3Key")]
    if not rows:
        return None, None
    rows.sort(
        key=lambda r: (
            _resume_status_rank(r.get("status")),
            str(r.get("updatedAt") or r.get("createdAt") or ""),
        ),
        reverse=True,
    )
    top = rows[0]
    key = str(top.get("s3Key") or "").strip()
    fn = top.get("fileName")
    name = str(fn).strip() if fn else None
    return (key or None), (name or None)


def resolve_mentee_resume_s3(mentee_profile: dict) -> tuple[str | None, str | None]:
    """Prefer profile resumeS3Key; else latest row in RESUMES_TABLE."""
    uid = str(mentee_profile.get("userId") or "").strip()
    pk = str(mentee_profile.get("resumeS3Key") or "").strip()
    if pk:
        return pk, pk.split("/")[-1] or None
    if uid:
        return _latest_resume_s3_for_user(uid)
    return None, None


def _resume_download_presign_seconds() -> int:
    raw = (os.environ.get("MENTORSHIP_RESUME_DOWNLOAD_URL_TTL") or "900").strip()
    try:
        return max(60, min(3600, int(raw)))
    except (TypeError, ValueError):
        return 900


def presigned_resume_download_url(s3_key: str | None) -> str | None:
    if not s3_key or not str(s3_key).strip():
        return None
    bucket = (os.environ.get("RESUMES_BUCKET") or "").strip()
    if not bucket:
        return None
    key = str(s3_key).strip().lstrip("/")
    try:
        s3 = boto3.client("s3")
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=_resume_download_presign_seconds(),
        )
    except Exception:
        return None


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


def _count_channel_opened_for_mentor(mentor_user_id: str) -> int:
    table = _matches_table()
    result = table.query(
        KeyConditionExpression="mentorUserId = :m",
        ExpressionAttributeValues={":m": mentor_user_id},
    )
    n = sum(1 for it in (result.get("Items") or []) if it.get("status") == "CHANNEL_OPENED")
    while "LastEvaluatedKey" in result:
        result = table.query(
            KeyConditionExpression="mentorUserId = :m",
            ExpressionAttributeValues={":m": mentor_user_id},
            ExclusiveStartKey=result["LastEvaluatedKey"],
        )
        n += sum(1 for it in (result.get("Items") or []) if it.get("status") == "CHANNEL_OPENED")
    return n


def _query_all_matches_for_mentee(mentee_user_id: str) -> list[dict]:
    """Match rows where this user is the mentee (GSI or scan fallback)."""
    table = _matches_table()
    gsi = (os.environ.get("MENTORSHIP_MENTEE_GSI_NAME") or "menteeUserId-mentorUserId-index").strip()
    items: list[dict] = []
    try:
        result = table.query(
            IndexName=gsi,
            KeyConditionExpression=Key("menteeUserId").eq(mentee_user_id),
        )
        items = list(result.get("Items") or [])
        while "LastEvaluatedKey" in result:
            result = table.query(
                IndexName=gsi,
                KeyConditionExpression=Key("menteeUserId").eq(mentee_user_id),
                ExclusiveStartKey=result["LastEvaluatedKey"],
            )
            items.extend(result.get("Items") or [])
    except Exception:
        result = table.scan(FilterExpression=Attr("menteeUserId").eq(mentee_user_id))
        items = list(result.get("Items") or [])
        while "LastEvaluatedKey" in result:
            result = table.scan(
                FilterExpression=Attr("menteeUserId").eq(mentee_user_id),
                ExclusiveStartKey=result["LastEvaluatedKey"],
            )
            items.extend(result.get("Items") or [])
    return items


def count_channel_opened_for_mentee(mentee_user_id: str) -> int:
    uid = (mentee_user_id or "").strip()
    if not uid:
        return 0
    return sum(
        1
        for it in _query_all_matches_for_mentee(uid)
        if it.get("status") == "CHANNEL_OPENED"
    )


def mentee_max_active_matches() -> int:
    raw = (os.environ.get("MENTORSHIP_MENTEE_MAX_ACTIVE_MATCHES") or "3").strip()
    try:
        return max(1, min(20, int(raw)))
    except (TypeError, ValueError):
        return 3


def _mentee_education_summary(profile_edu: Any) -> str | None:
    if not isinstance(profile_edu, list) or not profile_edu:
        return None
    lines: list[str] = []
    for e in profile_edu[:8]:
        if isinstance(e, dict):
            bits = [
                str(e.get(k) or "").strip()
                for k in ("institution", "degree", "field", "startYear", "endYear")
                if e.get(k)
            ]
            line = " · ".join(bits)
            if line:
                lines.append(line)
        elif isinstance(e, str) and e.strip():
            lines.append(e.strip())
    if not lines:
        return None
    text = "\n".join(lines)
    return text[:2000] if len(text) > 2000 else text


def _mentee_display_fields_from_profile(p: dict) -> dict[str, Any]:
    """Profile fields for mentor review (resume file via presigned URL, not parsed text)."""
    linked = str(p.get("linkedInUrl") or "").strip()
    goals_s = str(p.get("studentGoals") or "").strip()
    goals_m = str(p.get("mentorshipGoals") or "").strip()
    out: dict[str, Any] = {
        "menteeLinkedInUrl": linked or None,
        "menteeDegree": p.get("degree"),
        "menteeUniversity": p.get("university"),
        "menteeStudentGoals": goals_s[:2000] if goals_s else None,
        "menteeMentorshipGoals": goals_m[:2000] if goals_m else None,
        "menteeProfileGpa": p.get("profileGpa"),
        "menteeEducationSummary": _mentee_education_summary(p.get("profileEducation")),
    }
    return out


def mentee_mentor_view_from_profile(mentee_profile: dict) -> dict[str, Any]:
    """Live mentee row fields for mentor APIs: StudentProfiles + presigned S3 resume GET when configured."""
    enriched = _attach_resume_data(dict(mentee_profile))
    display = _mentee_display_fields_from_profile(enriched)
    out: dict[str, Any] = {
        "menteeName": enriched.get("name"),
        "menteeEmail": enriched.get("email"),
        "menteeMajor": enriched.get("major"),
        "menteeGradDate": enriched.get("gradDate"),
        "menteeSkills": enriched.get("profileSkillKeys") or [],
        **display,
    }
    s3_key, table_file_name = resolve_mentee_resume_s3(mentee_profile)
    url = presigned_resume_download_url(s3_key)
    if url and s3_key:
        out["menteeResumeDownloadUrl"] = url
        base_name = (table_file_name or s3_key.split("/")[-1] or "").strip() or "resume.pdf"
        out["menteeResumeFileName"] = base_name
    return out


def _mentor_slots_remaining(mentor_profile: dict | None, mentor_user_id: str) -> int | None:
    """Slots left for new CHANNEL_OPENED matches, or None if unknown."""
    uid = (mentor_user_id or "").strip()
    if not uid or not mentor_profile:
        return None
    cap_raw = mentor_profile.get("mentorCapacity")
    try:
        cap = int(cap_raw) if cap_raw is not None and str(cap_raw).strip() != "" else 10
    except (TypeError, ValueError):
        cap = 10
    cap = max(1, min(10, cap))
    used = _count_channel_opened_for_mentor(uid)
    return max(0, cap - used)


def build_mentor_candidates(mentor_profile: dict, mentee_profiles: list[dict], mentor_auth_token: str | None = None) -> list[dict]:
    mentor_profile = _attach_resume_data(mentor_profile, auth_token=mentor_auth_token)
    enriched_mentees = [_attach_resume_data(p) for p in mentee_profiles]
    provider = mentorship_embeddings.get_embedding_provider()
    mentor_text = mentorship_matching.mentor_profile_to_text(mentor_profile)
    mentee_texts = [mentorship_matching.mentee_profile_to_text(p) for p in enriched_mentees]
    mentor_vec = mentorship_embeddings.embed_texts_in_chunks(provider, [mentor_text])[0]
    mentee_vecs = mentorship_embeddings.embed_texts_in_chunks(provider, mentee_texts)
    if len(mentee_vecs) != len(enriched_mentees):
        raise RuntimeError("Embedding provider returned an unexpected vector count for mentees")
    semantic_w = _semantic_weight()
    rule_w = _rule_weight()

    board_tier, board_mult, board_reason = mentorship_board.resolve_mentor_board_tier(mentor_profile)

    mentor_uid = str(mentor_profile.get("userId") or "").strip()
    cap_remaining = _mentor_slots_remaining(mentor_profile, mentor_uid)

    rows = []
    for p, vec in zip(enriched_mentees, mentee_vecs):
        semantic_score = mentorship_matching.cosine_similarity(mentor_vec, vec)
        rule_result = mentorship_matching.compute_rule_score(
            mentor_profile,
            p,
            mentor_capacity_remaining=cap_remaining,
        )
        rule_score = rule_result.score
        reasons = rule_result.matched_signals
        base_final = (semantic_w * semantic_score) + (rule_w * rule_score)
        boosted = _cap_unit_score(base_final * board_mult)
        reason_summary = (
            "; ".join(reasons)
            if reasons
            else "Semantic profile similarity from mentor details and mentee profile/resume data."
        )
        row_base: dict[str, Any] = {
            "menteeUserId": p.get("userId"),
            "menteeName": p.get("name"),
            "menteeEmail": p.get("email"),
            "menteeMajor": p.get("major"),
            "menteeGradDate": p.get("gradDate"),
            "menteeSkills": p.get("profileSkillKeys") or [],
            "similarityScore": _to_score(semantic_score),
            "semanticScore": _to_score(semantic_score),
            "ruleScore": _to_score(rule_score),
            "baseFinalScore": _to_score(base_final),
            "boostedScore": _to_score(boosted),
            "finalScore": _to_score(boosted),
            "mentorBoardTier": board_tier,
            "mentorBoardMultiplier": _to_score(board_mult),
            "mentorBoardReason": board_reason,
            "matchedSignals": reasons,
            "reasonSummary": reason_summary,
            "embeddingMeta": provider.metadata(),
            "skillGapOpportunities": [],
        }
        rows.append(row_base)
    rows = mentorship_matching.rank_candidates(rows)
    _apply_narrator_to_top_mentor_rows(mentor_text, enriched_mentees, rows, _narrator_top_k())
    return rows


def _apply_narrator_to_top_mentor_rows(
    mentor_canonical: str,
    mentee_profiles: list[dict],
    rows: list[dict],
    top_k: int,
) -> None:
    """Bedrock Nova insights for top-K mentee rows only (cost control)."""
    by_id = {str(p.get("userId") or ""): p for p in mentee_profiles if p.get("userId")}
    for row in rows[top_k:]:
        row.setdefault("skillGapOpportunities", [])
    for row in rows[:top_k]:
        pid = str(row.get("menteeUserId") or "")
        mp = by_id.get(pid)
        if not mp:
            row.setdefault("skillGapOpportunities", [])
            continue
        mentee_canonical = mentorship_matching.mentee_profile_to_text(mp)
        try:
            bundle = mentorship_narrator.generate_match_insights_bundle(
                mentor_canonical,
                mentee_canonical,
                list(row.get("matchedSignals") or []),
                float(row.get("semanticScore") or 0.0),
                float(row.get("ruleScore") or 0.0),
            )
            row["reasonSummary"] = bundle.get("reasonSummary") or row.get("reasonSummary", "")
            row["skillGapOpportunities"] = bundle.get("skillGapOpportunities") or []
            # Icebreaker is generated and stored when the match opens (CHANNEL_OPENED), not here.
        except Exception:
            row.setdefault("skillGapOpportunities", [])


def upsert_suggestions(
    mentor_user_id: str,
    candidates: list[dict],
    limit: int | None = None,
    mentor_display_name: str | None = None,
) -> list[dict]:
    table = _matches_table()
    now = _now_iso()
    persisted = []
    limit_value = limit if isinstance(limit, int) and limit > 0 else _top_k()
    for c in candidates[:limit_value]:
        mentee_user_id = c.get("menteeUserId")
        if not mentee_user_id:
            continue
        existing = table.get_item(Key={"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id}).get("Item")
        if existing and existing.get("status") == "DECLINED_BY_MENTOR":
            continue
        item = {
            "mentorUserId": mentor_user_id,
            "menteeUserId": mentee_user_id,
            "status": "SUGGESTED",
            "similarityScore": c.get("similarityScore", 0.0),
            "semanticScore": c.get("semanticScore", 0.0),
            "ruleScore": c.get("ruleScore", 0.0),
            "baseFinalScore": c.get("baseFinalScore", c.get("finalScore", 0.0)),
            "boostedScore": c.get("boostedScore", c.get("finalScore", 0.0)),
            "finalScore": c.get("finalScore", c.get("boostedScore", c.get("similarityScore", 0.0))),
            "mentorBoardTier": c.get("mentorBoardTier"),
            "mentorBoardMultiplier": c.get("mentorBoardMultiplier"),
            "mentorBoardReason": c.get("mentorBoardReason"),
            "reasonSummary": c.get("reasonSummary", ""),
            "matchedSignals": c.get("matchedSignals") or [],
            "skillGapOpportunities": c.get("skillGapOpportunities") or [],
            "embeddingMeta": c.get("embeddingMeta") or {},
            "menteeName": c.get("menteeName"),
            "menteeEmail": c.get("menteeEmail"),
            "menteeMajor": c.get("menteeMajor"),
            "menteeGradDate": c.get("menteeGradDate"),
            "menteeSkills": c.get("menteeSkills") or [],
            "mentorName": mentor_display_name or (existing or {}).get("mentorName"),
            "updatedAt": now,
        }
        item["createdAt"] = (existing or {}).get("createdAt", now)
        if existing and existing.get("status") in ("ACCEPTED_BY_MENTOR", "CHANNEL_OPENED"):
            item["status"] = existing.get("status")
            item["channelId"] = existing.get("channelId")
            item["acceptedAt"] = existing.get("acceptedAt")
            item["requestedBy"] = existing.get("requestedBy")
            if existing.get("suggestedIcebreaker"):
                item["suggestedIcebreaker"] = existing.get("suggestedIcebreaker")
        table.put_item(Item=_dynamo_convert(copy.deepcopy(item)))
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
    def _mentor_sort_key(i: dict) -> tuple:
        status = str(i.get("status") or "")
        priority = {
            "SUGGESTED": 0,
            "SKIPPED_BY_MENTOR": 1,
            "DECLINED_BY_MENTOR": 2,
            "CHANNEL_OPENED": 3,
            "PENDING_MENTOR": 4,
        }.get(status, 9)
        score = float(i.get("finalScore") or i.get("similarityScore") or 0)
        return (priority, -score)

    items.sort(key=_mentor_sort_key)
    return items


def list_matches_for_mentee(mentee_user_id: str) -> list[dict]:
    """All match rows where this user is the mentee (requires GSI or scan fallback)."""
    items = _query_all_matches_for_mentee(mentee_user_id)
    items.sort(key=lambda i: str(i.get("updatedAt") or i.get("createdAt") or ""), reverse=True)
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


def mark_declined(mentor_user_id: str, mentee_user_id: str, reason: str | None = None) -> dict:
    table = _matches_table()
    now = _now_iso()
    names: dict[str, str] = {"#s": "status"}
    values: dict[str, Any] = {":s": "DECLINED_BY_MENTOR", ":u": now}
    update = "SET #s = :s, updatedAt = :u, declinedAt = :u"
    if reason and str(reason).strip():
        names["#r"] = "declineReason"
        values[":r"] = str(reason).strip()[:500]
        update += ", #r = :r"
    update += " REMOVE requestedBy"
    table.update_item(
        Key={"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id},
        UpdateExpression=update,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    return {
        "mentorUserId": mentor_user_id,
        "menteeUserId": mentee_user_id,
        "status": "DECLINED_BY_MENTOR",
        "updatedAt": now,
    }


def revive_declined_match(mentor_user_id: str, mentee_user_id: str) -> dict[str, Any]:
    """Move DECLINED_BY_MENTOR back to SUGGESTED if mentee is under active match cap."""
    if count_channel_opened_for_mentee(mentee_user_id) >= mentee_max_active_matches():
        raise ValueError("mentee_at_match_cap")
    table = _matches_table()
    key = {"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id}
    now = _now_iso()
    try:
        table.update_item(
            Key=key,
            UpdateExpression="SET #s = :s, updatedAt = :u REMOVE declineReason, declinedAt",
            ConditionExpression="#s = :was",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":s": "SUGGESTED",
                ":was": "DECLINED_BY_MENTOR",
                ":u": now,
            },
        )
    except ClientError as e:
        code = (e.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            raise ValueError("not_declined_revivable") from e
        raise
    refreshed = table.get_item(Key=key).get("Item") or {}
    return {
        "mentorUserId": mentor_user_id,
        "menteeUserId": mentee_user_id,
        "status": refreshed.get("status") or "SUGGESTED",
        "updatedAt": refreshed.get("updatedAt") or now,
    }


def accept_match(
    mentor_user_id: str,
    mentee_user_id: str,
    mentor_profile: dict | None = None,
    mentee_profile: dict | None = None,
) -> dict:
    table = _matches_table()
    key = {"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id}
    existing = table.get_item(Key=key).get("Item") or {}

    if str(existing.get("status") or "") == "CHANNEL_OPENED":
        return {
            "mentorUserId": mentor_user_id,
            "menteeUserId": mentee_user_id,
            "status": "CHANNEL_OPENED",
            "channelId": existing.get("channelId"),
            "acceptedAt": existing.get("acceptedAt"),
            "suggestedIcebreaker": existing.get("suggestedIcebreaker"),
            "skipNotification": True,
        }

    if mentor_profile:
        cap_raw = mentor_profile.get("mentorCapacity")
        try:
            cap = int(cap_raw) if cap_raw is not None and str(cap_raw).strip() != "" else 10
        except (TypeError, ValueError):
            cap = 10
        cap = max(1, min(10, cap))
        if _count_channel_opened_for_mentor(mentor_user_id) >= cap:
            raise ValueError("mentor_at_capacity")

    max_mentee = mentee_max_active_matches()
    if count_channel_opened_for_mentee(mentee_user_id) >= max_mentee:
        raise ValueError("mentee_at_match_cap")

    now = _now_iso()
    channel_id = f"mentor-{mentor_user_id[:8]}-mentee-{mentee_user_id[:8]}-{uuid.uuid4().hex[:8]}"
    table.update_item(
        Key=key,
        UpdateExpression="SET #s = :s, channelId = :c, acceptedAt = :a, updatedAt = :u",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":s": "CHANNEL_OPENED",
            ":c": channel_id,
            ":a": now,
            ":u": now,
        },
    )
    out: dict[str, Any] = {
        "mentorUserId": mentor_user_id,
        "menteeUserId": mentee_user_id,
        "status": "CHANNEL_OPENED",
        "channelId": channel_id,
        "acceptedAt": now,
    }
    if mentor_profile and mentee_profile:
        try:
            signals = list(existing.get("matchedSignals") or [])
            mt = mentorship_matching.mentor_profile_to_text(mentor_profile)
            me = mentorship_matching.mentee_profile_to_text(mentee_profile)
            ice = mentorship_narrator.generate_icebreaker(mt, me, signals)[:2000]
            table.update_item(
                Key=key,
                UpdateExpression="SET suggestedIcebreaker = :i, updatedAt = :u2",
                ExpressionAttributeValues={":i": ice, ":u2": now},
            )
            out["suggestedIcebreaker"] = ice
        except Exception:
            pass
    return out


def send_accept_email(
    mentee_email: str,
    mentor_name: str,
    channel_id: str,
    *,
    mentor_company: str | None = None,
    mentor_job_title: str | None = None,
    mentor_email: str | None = None,
    portal_url: str | None = None,
) -> dict[str, Any]:
    ses_sender = os.environ.get("SES_VERIFIED_SENDER")
    if not ses_sender:
        return {"sent": False, "mode": "log_only"}
    base = (portal_url or "").strip() or (
        (os.environ.get("FRONTEND_BASE_URL") or "http://localhost:5173").rstrip("/") + "/#mentorship"
    )
    lines = [
        "Hello from CMIS,",
        "",
        f"You have been matched with a mentor: {mentor_name or 'A CMIS mentor'}.",
    ]
    if mentor_job_title or mentor_company:
        role_bits = " · ".join(
            [x for x in [str(mentor_job_title or "").strip(), str(mentor_company or "").strip()] if x]
        )
        if role_bits:
            lines.append(f"Role / organization: {role_bits}")
    if mentor_email and str(mentor_email).strip():
        lines.append(f"Mentor email: {str(mentor_email).strip()}")
    lines.extend(
        [
            "",
            f"Connection reference: {channel_id}",
            "",
            "For full mentor contact details and next steps, sign in to the CMIS portal:",
            base,
            "",
            "— CMIS Mentorship",
        ]
    )
    body = "\n".join(lines)
    ses = boto3.client("ses")
    ses.send_email(
        Source=ses_sender,
        Destination={"ToAddresses": [mentee_email]},
        Message={
            "Subject": {"Data": "You have been matched with a mentor — CMIS"},
            "Body": {
                "Text": {"Data": body},
            },
        },
    )
    return {"sent": True, "mode": "ses"}

