"""
Mentorship matching + match record operations.

Storage table (DynamoDB):
- env: MENTORSHIP_MATCHES_TABLE
- PK: mentorUserId (string)
- SK: menteeUserId (string)
"""

from __future__ import annotations

import copy
import json
import logging
import os
import random
import re
import time
import uuid
from datetime import date, datetime, timezone
import urllib.request
import urllib.error
from collections import defaultdict
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

import mentorship_board
import mentorship_embeddings
import mentorship_matching
import mentorship_narrator


logger = logging.getLogger(__name__)

# Synthetic match row (same table) to count CHANNEL_OPENED across mentors atomically on accept.
MENTEE_CHANNEL_STATE_MENTOR_ID = "__MENTEE_CHANNEL_STATE__"

_dynamo = boto3.resource("dynamodb")
_attr_serializer = TypeSerializer()


def _ddb_serialize(val: Any) -> dict:
    return _attr_serializer.serialize(val)
_table = None
_resumes_table = None
_embeddings_table = None
_student_profiles_table = None
_runs_audit_table = None

# Fixed partition key in MENTORSHIP_MATCHING_RUNS_TABLE pointing at the last completed/failed run.
LATEST_POINTER_RUN_ID = "__LATEST_POINTER__"
SCHEDULE_CONFIG_RUN_ID = "__SCHEDULE_CONFIG__"


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


def _student_profiles_table_ref():
    global _student_profiles_table
    if _student_profiles_table is None:
        table_name = (os.environ.get("STUDENT_PROFILES_TABLE") or "").strip()
        if not table_name:
            raise RuntimeError("STUDENT_PROFILES_TABLE is not configured")
        _student_profiles_table = _dynamo.Table(table_name)
    return _student_profiles_table


def _runs_audit_table_ref():
    """Optional table for admin matching-run history; returns None if env unset."""
    global _runs_audit_table
    if _runs_audit_table is None:
        table_name = (os.environ.get("MENTORSHIP_MATCHING_RUNS_TABLE") or "").strip()
        if not table_name:
            return None
        _runs_audit_table = _dynamo.Table(table_name)
    return _runs_audit_table


def matching_runs_audit_configured() -> bool:
    """True when MENTORSHIP_MATCHING_RUNS_TABLE is set (run history persisted)."""
    return _runs_audit_table_ref() is not None


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


def _canonical_preview_text(text: str) -> str:
    return (text or "")[:3500]


def _embed_vectors_for_ranking_triples(
    triples: list[tuple[str, str, str]],
    provider: mentorship_embeddings.EmbeddingProvider,
) -> list[list[float]]:
    """
    triples: (userId, profileKind mentor|mentee, canonical_text)
    Uses MENTORSHIP_EMBEDDINGS_TABLE cache when canonical preview matches; otherwise Bedrock/OpenAI then writes cache.
    """
    if not triples:
        return []
    out: list[list[float] | None] = [None] * len(triples)
    cold: list[tuple[int, str, str, str]] = []
    for i, (uid, kind, canon) in enumerate(triples):
        uid = (uid or "").strip()
        kind = (kind or "").strip()
        if not uid or kind not in ("mentor", "mentee"):
            cold.append((i, uid, kind, canon))
            continue
        preview = _canonical_preview_text(canon)
        row = _get_profile_embedding_row(uid, kind)
        if row and str(row.get("canonicalTextPreview") or "") == preview:
            vec = _float_vector_from_item(row.get("vector"))
            if vec:
                out[i] = vec
                continue
        cold.append((i, uid, kind, canon))
    if cold:
        texts = [t[3] for t in cold]
        new_vs = mentorship_embeddings.embed_texts_in_chunks(provider, texts)
        if len(new_vs) != len(cold):
            raise RuntimeError("Embedding provider returned an unexpected vector count for ranking batch")
        for (idx, uid, kind, canon), nv in zip(cold, new_vs):
            if uid and kind in ("mentor", "mentee"):
                _put_profile_embedding_row(uid, kind, nv, canon, provider.metadata())
            out[idx] = nv
    resolved: list[list[float]] = []
    for i, v in enumerate(out):
        if not v:
            raise RuntimeError(f"Missing embedding vector at ranking index {i}")
        resolved.append(v)
    return resolved


def _mentee_opened_channel_count_from_state(mentee_user_id: str) -> int | None:
    """If synthetic counter row exists, return its value; else None (use row scan fallback)."""
    uid = (mentee_user_id or "").strip()
    if not uid:
        return None
    table = _matches_table()
    r = table.get_item(
        Key={"mentorUserId": MENTEE_CHANNEL_STATE_MENTOR_ID, "menteeUserId": uid}
    ).get("Item")
    if not r:
        return None
    raw = r.get("openedChannelCount")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _ensure_numeric_mentee_counter_row(mentee_user_id: str, now: str) -> None:
    """
    Repair malformed synthetic counter rows before transactional ADD.
    If openedChannelCount exists but is not numeric, reset it to 0.
    """
    uid = (mentee_user_id or "").strip()
    if not uid:
        return
    table = _matches_table()
    row = table.get_item(
        Key={"mentorUserId": MENTEE_CHANNEL_STATE_MENTOR_ID, "menteeUserId": uid}
    ).get("Item")
    if not row or "openedChannelCount" not in row:
        return
    raw = row.get("openedChannelCount")
    try:
        int(raw)
        return
    except (TypeError, ValueError):
        pass
    logger.warning(
        "Repairing malformed openedChannelCount on synthetic mentee state row",
        extra={"menteeUserId": uid, "rawType": type(raw).__name__},
    )
    table.update_item(
        Key={"mentorUserId": MENTEE_CHANNEL_STATE_MENTOR_ID, "menteeUserId": uid},
        UpdateExpression="SET openedChannelCount = :z, updatedAt = :u",
        ExpressionAttributeValues={":z": Decimal(0), ":u": now},
    )


def _transact_accept_channel_opened(
    mentor_user_id: str,
    mentee_user_id: str,
    *,
    channel_id: str,
    now: str,
) -> None:
    """Atomically open channel on (mentor, mentee) and increment mentee-wide open count (prevents double-accept races)."""
    tbl = _matches_table()
    name = tbl.name
    client = _dynamo.meta.client
    mx = mentee_max_active_matches()
    ser = _ddb_serialize
    _ensure_numeric_mentee_counter_row(mentee_user_id, now)
    try:
        client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": name,
                        "Key": {"mentorUserId": ser(mentor_user_id), "menteeUserId": ser(mentee_user_id)},
                        "UpdateExpression": "SET #st = :opened, channelId = :c, acceptedAt = :a, updatedAt = :u",
                        "ExpressionAttributeNames": {"#st": "status"},
                        "ExpressionAttributeValues": {
                            ":opened": ser("CHANNEL_OPENED"),
                            ":c": ser(channel_id),
                            ":a": ser(now),
                            ":u": ser(now),
                            ":sug": ser("SUGGESTED"),
                            ":pen": ser("PENDING_MENTOR"),
                            ":sk": ser("SKIPPED_BY_MENTOR"),
                        },
                        "ConditionExpression": "attribute_exists(#st) AND (#st IN (:sug, :pen, :sk))",
                    }
                },
                {
                    "Update": {
                        "TableName": name,
                        "Key": {
                            "mentorUserId": ser(MENTEE_CHANNEL_STATE_MENTOR_ID),
                            "menteeUserId": ser(mentee_user_id),
                        },
                        "UpdateExpression": "ADD openedChannelCount :one SET updatedAt = :u",
                        "ExpressionAttributeValues": {
                            ":one": ser(Decimal(1)),
                            ":u": ser(now),
                            ":mx": ser(Decimal(mx)),
                        },
                        "ConditionExpression": "(attribute_not_exists(openedChannelCount)) OR (openedChannelCount < :mx)",
                    }
                },
            ]
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        if code == "TransactionCanceledException":
            raise ValueError("mentee_channel_unavailable") from e
        if code == "ValidationException":
            # Defensive fallback if a malformed counter row slips in between repair and transact.
            raise ValueError("mentee_channel_unavailable") from e
        raise


def redact_mentor_candidate_rows_for_api(rows: list[dict]) -> list[dict]:
    """Strip PII from mentor-facing candidate payloads (Dynamo rows may still store email for workflows)."""
    out: list[dict] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        d = dict(r)
        d.pop("menteeEmail", None)
        out.append(d)
    return out


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


def _count_channel_opened_for_mentee(mentee_user_id: str) -> int:
    """Count active opened channels for this mentee across all mentors."""
    uid = (mentee_user_id or "").strip()
    if not uid:
        return 0
    from_state = _mentee_opened_channel_count_from_state(uid)
    if from_state is not None:
        return from_state
    n = 0
    for row in _query_all_matches_for_mentee(uid):
        if str(row.get("mentorUserId") or "") == MENTEE_CHANNEL_STATE_MENTOR_ID:
            continue
        if row.get("status") == "CHANNEL_OPENED":
            n += 1
    return n


def count_channel_opened_for_mentee(mentee_user_id: str) -> int:
    return _count_channel_opened_for_mentee(mentee_user_id)


def mentee_max_active_matches() -> int:
    """Max concurrent CHANNEL_OPENED rows allowed for a mentee (across mentors)."""
    try:
        v = int((os.environ.get("MENTEE_MAX_MATCHES") or "1").strip() or "1")
    except (TypeError, ValueError):
        v = 1
    return max(1, min(10, v))


_EXCLUSIVE_SUGGESTION_STATUSES = frozenset({"SUGGESTED", "PENDING_MENTOR"})


def load_allocator_snapshot() -> dict[str, Any]:
    """
    Scan mentorship match rows (projection only) for:
    - exclusive_lock: menteeUserId -> mentorUserId while status is SUGGESTED/PENDING_MENTOR
      (a mentee is offered to at most one mentor at a time; decline/skip frees them).
    - suggested_count_by_mentor: pipeline depth per mentor (same statuses).
    - mentees_in_suggested: mentee ids that currently have a SUGGESTED row (any mentor), for fair ordering.
    """
    table = _matches_table()
    items: list[dict] = []
    scan_kwargs: dict[str, Any] = {
        "ProjectionExpression": "mentorUserId, menteeUserId, #st, updatedAt, createdAt",
        "ExpressionAttributeNames": {"#st": "status"},
    }
    try:
        result = table.scan(**scan_kwargs)
        items.extend(result.get("Items") or [])
        while "LastEvaluatedKey" in result:
            result = table.scan(**scan_kwargs, ExclusiveStartKey=result["LastEvaluatedKey"])
            items.extend(result.get("Items") or [])
    except Exception:
        return {
            "exclusive_lock": {},
            "suggested_count_by_mentor": {},
            "mentees_in_suggested": frozenset(),
        }

    pending_by_mentee: dict[str, list[tuple[str, str]]] = defaultdict(list)
    suggested_count_by_mentor: dict[str, int] = defaultdict(int)
    mentees_in_suggested: set[str] = set()

    for it in items:
        st = str(it.get("status") or "").upper()
        m = str(it.get("mentorUserId") or "").strip()
        e = str(it.get("menteeUserId") or "").strip()
        if not m or not e:
            continue
        if st == "SUGGESTED":
            mentees_in_suggested.add(e)
        if st in _EXCLUSIVE_SUGGESTION_STATUSES:
            ts = str(it.get("updatedAt") or it.get("createdAt") or "")
            pending_by_mentee[e].append((m, ts))
            suggested_count_by_mentor[m] += 1

    exclusive_lock: dict[str, str] = {}
    for e, pairs in pending_by_mentee.items():
        pairs.sort(key=lambda x: x[1], reverse=True)
        exclusive_lock[e] = pairs[0][0]

    return {
        "exclusive_lock": exclusive_lock,
        "suggested_count_by_mentor": dict(suggested_count_by_mentor),
        "mentees_in_suggested": frozenset(mentees_in_suggested),
    }


def filter_mentees_exclusive_for_mentor(mentor_user_id: str, mentee_profiles: list[dict], snapshot: dict[str, Any]) -> list[dict]:
    """Drop mentees who are in an exclusive suggestion pipeline with a different mentor."""
    lock = snapshot.get("exclusive_lock") or {}
    mid = str(mentor_user_id or "").strip()
    out: list[dict] = []
    for p in mentee_profiles:
        eid = str(p.get("userId") or "").strip()
        if not eid:
            continue
        other = lock.get(eid)
        if other and other != mid:
            continue
        out.append(p)
    return out


def sort_mentee_profiles_for_allocator(mentor_user_id: str, mentee_profiles: list[dict], snapshot: dict[str, Any]) -> list[dict]:
    """
    Fair ordering before embeddings:
    1) Mentee already reserved for this mentor (exclusive lock points to me).
    2) Mentee not currently in anyone's SUGGESTED row (first-pass pool — spreads mentees before "tier fill").
    3) Stable tie-break by userId.
    """
    mid = str(mentor_user_id or "").strip()
    lock = snapshot.get("exclusive_lock") or {}
    suggested_pool = snapshot.get("mentees_in_suggested") or frozenset()

    def sort_key(p: dict) -> tuple:
        eid = str(p.get("userId") or "")
        locked_me = lock.get(eid) == mid
        not_in_suggested = eid not in suggested_pool
        return (
            0 if locked_me else 1,
            0 if (locked_me or not_in_suggested) else 1,
            eid,
        )

    return sorted(mentee_profiles, key=sort_key)


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


def _mentee_has_active_queue_elsewhere(mentee_user_id: str, current_mentor_user_id: str) -> bool:
    """True if another mentor already holds this mentee in SUGGESTED or PENDING_MENTOR."""
    uid = (mentee_user_id or "").strip()
    cur = (current_mentor_user_id or "").strip()
    if not uid:
        return False
    for row in _query_all_matches_for_mentee(uid):
        mid = str(row.get("mentorUserId") or "")
        if not mid or mid == cur or mid == MENTEE_CHANNEL_STATE_MENTOR_ID:
            continue
        if row.get("status") in ("SUGGESTED", "PENDING_MENTOR"):
            return True
    return False


def _profile_completeness_score(profile: dict) -> int:
    """Higher = more complete (used for annual batch ordering)."""
    if not profile:
        return 0
    score = 0
    if str(profile.get("mentorshipGoals") or "").strip():
        score += 3
    if profile.get("profileSkillKeys"):
        score += 2
    if profile.get("resumeS3Key") or profile.get("resumeExtractedData"):
        score += 2
    if str(profile.get("major") or "").strip():
        score += 1
    if str(profile.get("gradDate") or "").strip():
        score += 1
    if str(profile.get("linkedInUrl") or "").strip():
        score += 1
    return score


def scan_student_profiles_for_mentorship() -> tuple[list[dict], list[dict]]:
    """Full table scan; returns (mentor_profiles, mentee_profiles)."""
    table = _student_profiles_table_ref()
    items: list[dict] = []
    result = table.scan()
    items.extend(result.get("Items") or [])
    while "LastEvaluatedKey" in result:
        result = table.scan(ExclusiveStartKey=result["LastEvaluatedKey"])
        items.extend(result.get("Items") or [])
    mentors: list[dict] = []
    mentees: list[dict] = []
    for p in items:
        if not isinstance(p, dict):
            continue
        if p.get("mentorshipInterested") is not True:
            continue
        role = str(p.get("mentorship") or "").strip().lower()
        if role == "mentor":
            if _mentor_pause_active_on_profile(p):
                continue
            mentors.append(p)
        elif role == "mentee":
            mentees.append(p)
    return mentors, mentees


def _mentor_pause_active_on_profile(p: dict | None) -> bool:
    """True when mentorshipMentorPauseUntil is set and still in effect (same rules as HTTP handler)."""
    if not p:
        return False
    raw = str(p.get("mentorshipMentorPauseUntil") or "").strip()
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


def _count_suggested_or_pending_for_mentor(mentor_user_id: str) -> int:
    """Rows awaiting mentor decision (not yet CHANNEL_OPENED)."""
    mid = (mentor_user_id or "").strip()
    if not mid:
        return 0
    table = _matches_table()
    result = table.query(
        KeyConditionExpression="mentorUserId = :m",
        ExpressionAttributeValues={":m": mid},
    )
    n = sum(
        1
        for it in (result.get("Items") or [])
        if str(it.get("status") or "").upper() in ("SUGGESTED", "PENDING_MENTOR")
    )
    while "LastEvaluatedKey" in result:
        result = table.query(
            KeyConditionExpression="mentorUserId = :m",
            ExpressionAttributeValues={":m": mid},
            ExclusiveStartKey=result["LastEvaluatedKey"],
        )
        n += sum(
            1
            for it in (result.get("Items") or [])
            if str(it.get("status") or "").upper() in ("SUGGESTED", "PENDING_MENTOR")
        )
    return n


def mentor_proposal_slots_remaining(mentor_profile: dict | None, mentor_user_id: str) -> int:
    """How many more suggested/pending mentees this mentor may receive (capacity − opened − pending)."""
    uid = (mentor_user_id or "").strip()
    if not uid or not mentor_profile:
        return 0
    cap_raw = mentor_profile.get("mentorCapacity")
    try:
        cap = int(cap_raw) if cap_raw is not None and str(cap_raw).strip() != "" else 10
    except (TypeError, ValueError):
        cap = 10
    cap = max(1, min(10, cap))
    opened = _count_channel_opened_for_mentor(uid)
    pending = _count_suggested_or_pending_for_mentor(uid)
    return max(0, cap - opened - pending)


def skip_all_active_suggestions_for_mentor(mentor_user_id: str) -> dict[str, Any]:
    """Skip every SUGGESTED / PENDING_MENTOR row for this mentor (releases mentees for future matching)."""
    mid = (mentor_user_id or "").strip()
    if not mid:
        return {"skippedRows": 0}
    skipped = 0
    for r in list_matches_for_mentor(mid):
        st = str(r.get("status") or "").upper()
        if st not in ("SUGGESTED", "PENDING_MENTOR"):
            continue
        eid = str(r.get("menteeUserId") or "").strip()
        if not eid:
            continue
        mark_skipped(mid, eid)
        skipped += 1
    return {"skippedRows": skipped, "mentorUserId": mid}


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


def _mentor_tier_priority(mentor_profile: dict | None) -> tuple[int, float]:
    """
    Lower tuple sorts first.
    Partner tiers are prioritized: gold, silver, bronze, other admin tier, then none.
    """
    tier_label, mult, _reason = mentorship_board.resolve_mentor_board_tier(mentor_profile)
    slug = str(tier_label or "").strip().lower()
    if slug == "gold":
        rank = 0
    elif slug == "silver":
        rank = 1
    elif slug == "bronze":
        rank = 2
    elif slug and slug != "none":
        rank = 3
    else:
        rank = 4
    try:
        m = float(mult or 1.0)
    except (TypeError, ValueError):
        m = 1.0
    return rank, -m


def _to_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _build_mentor_priority_meta(
    mentors: list[dict],
    snapshot: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    suggested_counts = snapshot.get("suggested_count_by_mentor") or {}
    out: dict[str, dict[str, Any]] = {}
    for mentor in mentors:
        mid = str(mentor.get("userId") or "").strip()
        if not mid:
            continue
        slots = _mentor_slots_remaining(mentor, mid)
        if (slots or 0) <= 0:
            continue
        suggested_n = int(suggested_counts.get(mid) or 0)
        opened_n = _count_channel_opened_for_mentor(mid)
        tier_rank, neg_mult = _mentor_tier_priority(mentor)
        out[mid] = {
            "profile": mentor,
            "slots": int(slots or 0),
            "suggestedCount": suggested_n,
            "openedCount": opened_n,
            "activeLoad": suggested_n + opened_n,
            "tierRank": tier_rank,
            "negMultiplier": neg_mult,
        }
    return out


def _pick_best_mid_from_suggestions(
    suggestions: list[dict],
    mentor_meta: dict[str, dict[str, Any]],
) -> str:
    best_mid = ""
    best_key: tuple[Any, ...] | None = None
    for row in suggestions:
        mid = str(row.get("mentorUserId") or "").strip()
        if not mid:
            continue
        meta = mentor_meta.get(mid)
        if not meta:
            continue
        # Partner-first and low-load-first, then score.
        key = (
            int(meta.get("tierRank") or 9),
            0 if int(meta.get("activeLoad") or 0) == 0 else 1,
            int(meta.get("activeLoad") or 0),
            int(meta.get("suggestedCount") or 0),
            -_to_float(row.get("finalScore"), 0.0),
            -_to_float(row.get("boostedScore"), 0.0),
            mid,
        )
        if best_key is None or key < best_key:
            best_key = key
            best_mid = mid
    return best_mid


def build_mentor_candidates(
    mentor_profile: dict,
    mentee_profiles: list[dict],
    mentor_auth_token: str | None = None,
    *,
    include_unavailable: bool = False,
) -> list[dict]:
    mentor_profile = _attach_resume_data(mentor_profile, auth_token=mentor_auth_token)
    enriched_mentees = [_attach_resume_data(p) for p in mentee_profiles]
    provider = mentorship_embeddings.get_embedding_provider()
    mentor_text = mentorship_matching.mentor_profile_to_text(mentor_profile)
    semantic_w = _semantic_weight()
    rule_w = _rule_weight()

    board_tier, board_mult, board_reason = mentorship_board.resolve_mentor_board_tier(mentor_profile)

    mentor_uid = str(mentor_profile.get("userId") or "").strip()
    cap_remaining = _mentor_slots_remaining(mentor_profile, mentor_uid)

    available_flags: dict[str, tuple[bool, str]] = {}
    score_mentees: list[dict] = []
    max_for_mentee = mentee_max_active_matches()
    for p in enriched_mentees:
        pid = str(p.get("userId") or "").strip()
        if not pid:
            continue
        at_cap = _count_channel_opened_for_mentee(pid) >= max_for_mentee
        locked_elsewhere = _mentee_has_active_queue_elsewhere(pid, mentor_uid)
        is_available = (not at_cap) and (not locked_elsewhere)
        reason = "Available now"
        if at_cap:
            reason = f"Mentee is at active match limit ({max_for_mentee})."
        elif locked_elsewhere:
            reason = "Currently reserved in another mentor's active suggestion queue."
        available_flags[pid] = (is_available, reason)
        if is_available or include_unavailable:
            score_mentees.append(p)
    if not score_mentees:
        return []
    mentee_texts = [mentorship_matching.mentee_profile_to_text(p) for p in score_mentees]
    triples = [(mentor_uid, "mentor", mentor_text)] + [
        (str(p.get("userId") or "").strip(), "mentee", t) for p, t in zip(score_mentees, mentee_texts)
    ]
    vecs = _embed_vectors_for_ranking_triples(triples, provider)
    mentor_vec = vecs[0]
    mentee_vecs = vecs[1:]
    enriched_mentees = score_mentees

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
        is_available, availability_reason = available_flags.get(
            str(p.get("userId") or "").strip(),
            (True, "Available now"),
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
            "isAvailableToMatch": is_available,
            "availabilityReason": availability_reason,
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
                "Mentor",
                str(mp.get("name") or "Mentee"),
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


def build_mentee_suggested_mentors(
    mentee_profile: dict,
    mentor_profiles: list[dict],
    mentee_auth_token: str | None = None,
) -> list[dict]:
    """Rank mentors for a mentee using semantic + rules × per-mentor board boost."""
    if not mentor_profiles:
        return []
    mentee_profile = _attach_resume_data(dict(mentee_profile), auth_token=mentee_auth_token)
    enriched_mentors = [_attach_resume_data(dict(p)) for p in mentor_profiles]
    provider = mentorship_embeddings.get_embedding_provider()
    mentee_text = mentorship_matching.mentee_profile_to_text(mentee_profile)
    mentor_texts = [mentorship_matching.mentor_profile_to_text(p) for p in enriched_mentors]
    mentee_uid = str(mentee_profile.get("userId") or "").strip()
    triples = [(mentee_uid, "mentee", mentee_text)] + [
        (str(p.get("userId") or "").strip(), "mentor", t) for p, t in zip(enriched_mentors, mentor_texts)
    ]
    vecs = _embed_vectors_for_ranking_triples(triples, provider)
    mentee_vec = vecs[0]
    mentor_vecs = vecs[1:]
    if len(mentor_vecs) != len(enriched_mentors):
        raise RuntimeError("Embedding provider returned an unexpected vector count for mentors")
    semantic_w = _semantic_weight()
    rule_w = _rule_weight()

    rows: list[dict] = []
    for p, vec in zip(enriched_mentors, mentor_vecs):
        semantic_score = mentorship_matching.cosine_similarity(mentee_vec, vec)
        mid = str(p.get("userId") or "").strip()
        cap_rem = _mentor_slots_remaining(p, mid)
        rule_result = mentorship_matching.compute_rule_score(
            p,
            mentee_profile,
            mentor_capacity_remaining=cap_rem,
        )
        rule_score = rule_result.score
        reasons = rule_result.matched_signals
        base_final = (semantic_w * semantic_score) + (rule_w * rule_score)
        tier, mult, br = mentorship_board.resolve_mentor_board_tier(p)
        boosted = _cap_unit_score(base_final * mult)
        reason_summary = (
            "; ".join(reasons)
            if reasons
            else "Fit from your goals, resume, and this mentor's background."
        )
        rows.append(
            {
                "mentorUserId": p.get("userId"),
                "mentorName": p.get("name"),
                "mentorEmail": p.get("email"),
                "mentorCompany": p.get("mentorCompany"),
                "mentorJobTitle": p.get("mentorJobTitle"),
                "mentorIndustries": p.get("mentorIndustries") or [],
                "semanticScore": _to_score(semantic_score),
                "ruleScore": _to_score(rule_score),
                "baseFinalScore": _to_score(base_final),
                "boostedScore": _to_score(boosted),
                "boardTier": tier,
                "boardMultiplier": _to_score(mult),
                "boardReason": br,
                "matchedSignals": reasons,
                "reasonSummary": reason_summary,
                "embeddingMeta": provider.metadata(),
                "skillGapOpportunities": [],
            }
        )
    rows = mentorship_matching.rank_candidates(rows)
    _apply_narrator_to_top_mentee_rows(mentee_text, enriched_mentors, rows, _narrator_top_k())
    return rows


def _apply_narrator_to_top_mentee_rows(
    mentee_canonical: str,
    mentor_profiles: list[dict],
    rows: list[dict],
    top_k: int,
) -> None:
    by_id = {str(p.get("userId") or ""): p for p in mentor_profiles if p.get("userId")}
    for row in rows[top_k:]:
        row.setdefault("skillGapOpportunities", [])
    for row in rows[:top_k]:
        mid = str(row.get("mentorUserId") or "")
        prof = by_id.get(mid)
        if not prof:
            row.setdefault("skillGapOpportunities", [])
            continue
        mentor_canonical = mentorship_matching.mentor_profile_to_text(prof)
        try:
            bundle = mentorship_narrator.generate_match_insights_bundle(
                str(prof.get("name") or "Mentor"),
                "Mentee",
                mentor_canonical,
                mentee_canonical,
                list(row.get("matchedSignals") or []),
                float(row.get("semanticScore") or 0.0),
                float(row.get("ruleScore") or 0.0),
            )
            row["reasonSummary"] = bundle.get("reasonSummary") or row.get("reasonSummary", "")
            row["skillGapOpportunities"] = bundle.get("skillGapOpportunities") or []
        except Exception:
            row.setdefault("skillGapOpportunities", [])


def upsert_suggestions(
    mentor_user_id: str,
    candidates: list[dict],
    limit: int | None = None,
    mentor_display_name: str | None = None,
    allocator_snapshot: dict[str, Any] | None = None,
) -> list[dict]:
    table = _matches_table()
    now = _now_iso()
    persisted = []
    limit_value = limit if isinstance(limit, int) and limit > 0 else _top_k()
    lock = (allocator_snapshot or {}).get("exclusive_lock") or {}
    mid = str(mentor_user_id or "").strip()
    for c in candidates:
        if len(persisted) >= limit_value:
            break
        mentee_user_id = c.get("menteeUserId")
        if not mentee_user_id:
            continue
        ekey = str(mentee_user_id).strip()
        other = lock.get(ekey)
        if other and other != mid:
            continue
        existing = table.get_item(Key={"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id}).get("Item")
        if existing and existing.get("status") == "DECLINED_BY_MENTOR":
            continue
        pid = str(mentee_user_id or "").strip()
        # Never persist a new suggestion for mentees already at active match cap.
        if pid and _count_channel_opened_for_mentee(pid) >= mentee_max_active_matches():
            continue
        if pid and _mentee_has_active_queue_elsewhere(pid, mentor_user_id):
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
        elif existing and existing.get("status") == "PENDING_MENTOR":
            item["status"] = "PENDING_MENTOR"
            item["requestedBy"] = existing.get("requestedBy", "mentee")
            if existing.get("declineReason"):
                item["declineReason"] = existing.get("declineReason")
        write_st = str(item.get("status") or "")
        try:
            if not existing:
                table.put_item(
                    Item=_dynamo_convert(copy.deepcopy(item)),
                    ConditionExpression="attribute_not_exists(mentorUserId) AND attribute_not_exists(menteeUserId)",
                )
            else:
                table.put_item(
                    Item=_dynamo_convert(copy.deepcopy(item)),
                    ConditionExpression="attribute_not_exists(#st) OR #st <> :ch OR :ws = :ch",
                    ExpressionAttributeNames={"#st": "status"},
                    ExpressionAttributeValues={":ch": "CHANNEL_OPENED", ":ws": write_st},
                )
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                logger.info("Suggestion already exists — skipping duplicate")
                continue
            raise
        persisted.append(item)
    return persisted


def clear_pending_suggestion_rows() -> dict[str, int]:
    """
    Remove non-final queue rows before a fresh admin rerun.
    Keeps final outcomes (`CHANNEL_OPENED`, `DECLINED_BY_MENTOR`) intact.
    """
    table = _matches_table()
    rows: list[dict] = []
    scan_kw: dict[str, Any] = {
        "ProjectionExpression": "mentorUserId, menteeUserId, #st",
        "ExpressionAttributeNames": {"#st": "status"},
    }
    while True:
        r = table.scan(**scan_kw)
        rows.extend(r.get("Items") or [])
        if not r.get("LastEvaluatedKey"):
            break
        scan_kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]

    deleted = 0
    for row in rows:
        mid = str(row.get("mentorUserId") or "").strip()
        eid = str(row.get("menteeUserId") or "").strip()
        if not mid or not eid:
            continue
        if mid == MENTEE_CHANNEL_STATE_MENTOR_ID:
            continue
        st = str(row.get("status") or "").upper()
        if st in ("SUGGESTED", "PENDING_MENTOR", "SKIPPED_BY_MENTOR"):
            table.delete_item(Key={"mentorUserId": mid, "menteeUserId": eid})
            deleted += 1
    return {"deletedPendingRows": deleted}


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
            "PENDING_MENTOR": 0,
            "SUGGESTED": 1,
            "SKIPPED_BY_MENTOR": 2,
            "DECLINED_BY_MENTOR": 3,
            "CHANNEL_OPENED": 4,
        }.get(status, 9)
        score = float(i.get("finalScore") or i.get("similarityScore") or 0)
        return (priority, -score)

    items.sort(key=_mentor_sort_key)
    return items


def list_matches_for_mentee(mentee_user_id: str) -> list[dict]:
    """All match rows where this user is the mentee (requires GSI or scan fallback)."""
    items = _query_all_matches_for_mentee(mentee_user_id)
    items = [
        i
        for i in items
        if str(i.get("mentorUserId") or "") != MENTEE_CHANNEL_STATE_MENTOR_ID
    ]
    items.sort(key=lambda i: str(i.get("updatedAt") or i.get("createdAt") or ""), reverse=True)
    return items


def create_mentee_request(
    mentee_user_id: str,
    mentor_user_id: str,
    *,
    mentee_name: str | None = None,
    mentor_name: str | None = None,
    mentee_email: str | None = None,
) -> dict:
    table = _matches_table()
    now = _now_iso()
    key = {"mentorUserId": mentor_user_id, "menteeUserId": mentee_user_id}
    existing = table.get_item(Key=key).get("Item")
    if existing and existing.get("status") == "CHANNEL_OPENED":
        raise ValueError("already_matched")
    if existing and existing.get("status") == "PENDING_MENTOR":
        return dict(existing)
    preserve_created = (
        (existing or {}).get("createdAt", now)
        if existing and existing.get("status") not in ("DECLINED_BY_MENTOR", "SKIPPED_BY_MENTOR")
        else now
    )
    item = {
        **key,
        "status": "PENDING_MENTOR",
        "requestedBy": "mentee",
        "menteeName": mentee_name or (existing or {}).get("menteeName"),
        "mentorName": mentor_name or (existing or {}).get("mentorName"),
        "menteeEmail": mentee_email or (existing or {}).get("menteeEmail"),
        "createdAt": preserve_created,
        "updatedAt": now,
    }
    if existing and existing.get("status") not in ("DECLINED_BY_MENTOR", "SKIPPED_BY_MENTOR"):
        for k in (
            "semanticScore",
            "ruleScore",
            "finalScore",
            "baseFinalScore",
            "boostedScore",
            "reasonSummary",
            "matchedSignals",
            "skillGapOpportunities",
            "embeddingMeta",
            "mentorBoardTier",
            "mentorBoardMultiplier",
        ):
            if existing.get(k) is not None:
                item[k] = existing[k]
    table.put_item(Item=_dynamo_convert(copy.deepcopy(item)))
    return item


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
    try:
        mentee_profile = _fetch_profile(mentee_user_id)
        _send_decline_email(mentee_profile)
    except Exception as e:
        logger.warning("Decline email failed: %s", e)
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

    if _count_channel_opened_for_mentee(mentee_user_id) >= mentee_max_active_matches():
        raise ValueError("mentee_at_match_cap")

    now = _now_iso()
    channel_id = f"mentor-{mentor_user_id[:8]}-mentee-{mentee_user_id[:8]}-{uuid.uuid4().hex[:8]}"
    _transact_accept_channel_opened(
        mentor_user_id,
        mentee_user_id,
        channel_id=channel_id,
        now=now,
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
            semantic_score = float(existing.get("semanticScore") or existing.get("similarityScore") or 0.0)
            rule_score = float(existing.get("ruleScore") or 0.0)
            bundle = mentorship_narrator.generate_match_insights_bundle(
                str(mentor_profile.get("name") or "Mentor"),
                str(mentee_profile.get("name") or "Mentee"),
                mt,
                me,
                signals,
                semantic_score,
                rule_score,
            )
            ice = str(bundle.get("suggestedIcebreaker") or "")[:2000]
            reason_summary = str(bundle.get("reasonSummary") or "")
            skill_gaps = list(bundle.get("skillGapOpportunities") or [])
            table.update_item(
                Key=key,
                UpdateExpression=(
                    "SET suggestedIcebreaker = :i, reasonSummary = :r, "
                    "skillGapOpportunities = :g, updatedAt = :u2"
                ),
                ExpressionAttributeValues={":i": ice, ":r": reason_summary, ":g": skill_gaps, ":u2": now},
            )
            out["suggestedIcebreaker"] = ice
            out["reasonSummary"] = reason_summary
            out["skillGapOpportunities"] = skill_gaps
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


def send_decline_email(mentee_email: str, mentor_name: str) -> dict[str, Any]:
    """Soft notice when a mentor declines — mentee stays in the matching pool."""
    ses_sender = os.environ.get("SES_VERIFIED_SENDER")
    if not ses_sender:
        return {"sent": False, "mode": "log_only"}
    ses = boto3.client("ses")
    ses.send_email(
        Source=ses_sender,
        Destination={"ToAddresses": [mentee_email]},
        Message={
            "Subject": {"Data": "Mentorship program — update on your match request"},
            "Body": {
                "Text": {
                    "Data": (
                        f"Hi,\n\n{mentor_name} was unable to take on a new mentee match right now. "
                        "You are still in the mentorship pool and we are continuing to find a strong fit for you.\n\n"
                        "Please sign in to the Mentorship section to see updated suggestions.\n"
                    )
                }
            },
        },
    )
    return {"sent": True, "mode": "ses"}


def _fetch_profile(user_id: str) -> dict:
    table = _student_profiles_table_ref()
    item = table.get_item(Key={"userId": user_id}).get("Item") or {}
    return item


def _send_decline_email(mentee: dict) -> None:
    ses_sender = (os.environ.get("SES_VERIFIED_SENDER") or "").strip()
    if not ses_sender:
        logger.info("Decline email skipped: SES_VERIFIED_SENDER not configured")
        return
    if not isinstance(mentee, dict):
        return
    parts = [p.strip().lower() for p in str(mentee.get("email") or "").split(",") if p and p.strip()]
    if not parts:
        return
    to_email = parts[0]
    ses = boto3.client("ses")
    body = (
        "Hi,\n\n"
        "Your CMIS mentorship journey is still active and we are continuing to find a strong mentor fit for you.\n\n"
        "Please check the mentorship section in the CMIS portal for updates.\n"
    )
    try:
        ses.send_email(
            Source=ses_sender,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": "Your CMIS mentor match is still in progress"},
                "Body": {"Text": {"Data": body}},
            },
        )
    except Exception as e:
        logger.warning("Decline email SES send failed: %s", e)


def _mark_mentee_queued(mentee_user_id: str) -> None:
    logger.info("mentee_queued_for_matching", extra={"menteeUserId": mentee_user_id})


def _send_match_email(mentor_profile: dict, mentee_profile: dict, channel_id: str) -> None:
    if not mentee_profile:
        return
    mentee_parts = [p.strip().lower() for p in re.split(r"[,;\s]+", str(mentee_profile.get("email") or "")) if p and p.strip()]
    if not mentee_parts:
        return
    mentor_parts = [p.strip().lower() for p in re.split(r"[,;\s]+", str(mentor_profile.get("email") or "")) if p and p.strip()]
    try:
        send_accept_email(
            mentee_email=mentee_parts[0],
            mentor_name=str(mentor_profile.get("name") or "Your mentor"),
            channel_id=channel_id,
            mentor_company=(str(mentor_profile.get("mentorCompany") or "").strip() or None),
            mentor_job_title=(str(mentor_profile.get("mentorJobTitle") or "").strip() or None),
            mentor_email=(mentor_parts[0] if mentor_parts else None),
        )
    except Exception as e:
        logger.warning("match email send failed for channel %s: %s", channel_id, e)


def _channel_id_for_pair(mentor_user_id: str, mentee_user_id: str) -> str:
    return f"mentor-{mentor_user_id[:8]}-mentee-{mentee_user_id[:8]}-{uuid.uuid4().hex[:8]}"


def _write_channel_opened(
    mentor: dict,
    mentee: dict,
    candidate: dict,
    *,
    matched_by: str,
    generate_insights: bool = True,
    preset_insights: dict[str, Any] | None = None,
) -> str | None:
    table = _matches_table()
    mentor_user_id = str(mentor.get("userId") or "").strip()
    mentee_user_id = str(mentee.get("userId") or "").strip()
    if not mentor_user_id or not mentee_user_id:
        return None
    now = _now_iso()
    channel_id = _channel_id_for_pair(mentor_user_id, mentee_user_id)
    semantic_score = float(candidate.get("semanticScore") or candidate.get("similarityScore") or 0.0)
    rule_score = float(candidate.get("ruleScore") or 0.0)
    matched_signals = list(candidate.get("matchedSignals") or [])
    mentor_canonical = mentorship_matching.mentor_profile_to_text(mentor)
    mentee_canonical = mentorship_matching.mentee_profile_to_text(mentee)
    insights = {
        "reasonSummary": "",
        "suggestedIcebreaker": "",
        "skillGapOpportunities": [],
        **(preset_insights or {}),
    }
    if generate_insights:
        try:
            insights = mentorship_narrator.generate_match_insights_bundle(
                str(mentor.get("name") or "Mentor"),
                str(mentee.get("name") or "Mentee"),
                mentor_canonical,
                mentee_canonical,
                matched_signals,
                semantic_score,
                rule_score,
            )
        except Exception:
            insights = {"reasonSummary": "", "suggestedIcebreaker": "", "skillGapOpportunities": []}
    item = {
        "mentorUserId": mentor_user_id,
        "menteeUserId": mentee_user_id,
        "status": "CHANNEL_OPENED",
        "matchedBy": matched_by,
        "channelId": channel_id,
        "acceptedAt": now,
        "createdAt": now,
        "updatedAt": now,
        "mentorName": mentor.get("name"),
        "mentorEmail": mentor.get("email"),
        "menteeName": mentee.get("name"),
        "menteeEmail": mentee.get("email"),
        "semanticScore": _to_score(semantic_score),
        "ruleScore": _to_score(rule_score),
        "boostedScore": _to_score(float(candidate.get("boostedScore") or candidate.get("finalScore") or 0.0)),
        "matchedSignals": matched_signals,
        **insights,
    }
    try:
        table.put_item(
            Item=_dynamo_convert(copy.deepcopy(item)),
            ConditionExpression="attribute_not_exists(mentorUserId) AND attribute_not_exists(menteeUserId)",
        )
        _send_match_email(mentor, mentee, channel_id)
        return channel_id
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            logger.info("CHANNEL_OPENED row already exists for mentor/mentee; skipping duplicate")
            return None
        raise


def _suggest_fallback_assignments(unmatched_mentees: list[dict], mentors: list[dict]) -> tuple[int, list[str]]:
    """Last resort: assign remaining mentees as SUGGESTED to mentors with proposal slots (minimal scoring)."""
    mentor_by_id = {str(m.get("userId") or "").strip(): m for m in mentors if str(m.get("userId") or "").strip()}
    matched = 0
    errors: list[str] = []
    for mentee in unmatched_mentees:
        mentee_id = str(mentee.get("userId") or "").strip()
        if not mentee_id:
            continue
        if _count_channel_opened_for_mentee(mentee_id) >= mentee_max_active_matches():
            continue
        best_mid = ""
        best_slots = -1
        for mid, mentor in mentor_by_id.items():
            if mid == mentee_id:
                continue
            slots = mentor_proposal_slots_remaining(mentor, mid)
            if slots > best_slots:
                best_slots = slots
                best_mid = mid
        if not best_mid or best_slots <= 0:
            _mark_mentee_queued(mentee_id)
            continue
        mentor = mentor_by_id.get(best_mid)
        if not mentor:
            _mark_mentee_queued(mentee_id)
            continue
        cand: dict[str, Any] = {
            "menteeUserId": mentee_id,
            "menteeName": mentee.get("name"),
            "menteeEmail": mentee.get("email"),
            "menteeMajor": mentee.get("major"),
            "menteeGradDate": mentee.get("gradDate"),
            "menteeSkills": mentee.get("profileSkillKeys") or [],
            "similarityScore": _to_score(0.0),
            "semanticScore": _to_score(0.0),
            "ruleScore": _to_score(0.0),
            "baseFinalScore": _to_score(0.0),
            "boostedScore": _to_score(0.0),
            "finalScore": _to_score(0.0),
            "matchedSignals": [],
            "reasonSummary": "Assigned by capacity fallback after semantic matching; please review and accept or pass.",
            "isAvailableToMatch": True,
            "availabilityReason": "fallback",
        }
        try:
            persisted = upsert_suggestions(
                best_mid,
                [cand],
                limit=1,
                mentor_display_name=str(mentor.get("name") or ""),
                allocator_snapshot=None,
            )
            if persisted:
                matched += 1
            else:
                _mark_mentee_queued(mentee_id)
        except Exception as e:
            errors.append(f"fallback {mentee_id}->{best_mid}: {e!s}")
            _mark_mentee_queued(mentee_id)
    return matched, errors


def _try_assign_one_suggested(
    mentor: dict,
    mentee_pool: list[dict],
    errors: list[str],
    *,
    round_label: str,
) -> bool:
    """Pick best available mentee for this mentor and persist SUGGESTED. Returns True if a row was written."""
    mid = str(mentor.get("userId") or "").strip()
    if not mid or mentor_proposal_slots_remaining(mentor, mid) <= 0:
        return False
    if not mentee_pool:
        return False
    try:
        candidates = build_mentor_candidates(mentor, mentee_pool, mentor_auth_token=None, include_unavailable=False)
    except Exception as e:
        errors.append(f"{round_label} build_mentor_candidates {mid}: {e!s}")
        return False
    avail = [c for c in candidates if c.get("isAvailableToMatch") is True]
    if not avail:
        return False
    best = avail[0]
    eid = str(best.get("menteeUserId") or "").strip()
    if not eid:
        return False
    # Hard guard: once a mentor declines a mentee, future runs must not rematch this pair
    # unless explicitly revived via admin/mentor action.
    existing = _matches_table().get_item(Key={"mentorUserId": mid, "menteeUserId": eid}).get("Item") or {}
    if str(existing.get("status") or "").upper() == "DECLINED_BY_MENTOR":
        return False
    try:
        persisted = upsert_suggestions(
            mid,
            [best],
            limit=1,
            mentor_display_name=str(mentor.get("name") or ""),
            allocator_snapshot=None,
        )
        return len(persisted) > 0
    except Exception as e:
        errors.append(f"{round_label} upsert {mid}->{eid}: {e!s}")
        return False


def run_annual_batch_matching() -> dict[str, Any]:
    """
    Admin batch: assign semantic-ranked mentees to mentors as SUGGESTED (not CHANNEL_OPENED).
    Round 1 tries to give each mentor with capacity at least one mentee; round 2 fills remaining proposal slots.
    Mentees see mentor details only after the mentor accepts (separate accept flow).
    """
    try:
        cleanup = clear_pending_suggestion_rows()
        mentors, mentees = scan_student_profiles_for_mentorship()
        mentor_by_id = {str(m.get("userId") or "").strip(): m for m in mentors if str(m.get("userId") or "").strip()}
        eligible_mentees = [
            m
            for m in mentees
            if _count_channel_opened_for_mentee(str(m.get("userId") or "").strip()) < mentee_max_active_matches()
        ]
        eligible_mentees.sort(key=_profile_completeness_score, reverse=True)
        errors: list[str] = []
        suggested = 0

        mentors_for_rounds = [
            m
            for m in mentors
            if str(m.get("userId") or "").strip()
            and mentor_proposal_slots_remaining(m, str(m.get("userId") or "").strip()) > 0
        ]

        rnd = random.Random((int(time.time()) % 100000) + len(mentors_for_rounds))
        mlist = list(mentors_for_rounds)
        rnd.shuffle(mlist)

        # Round 1: at most one new suggestion per mentor (coverage pass).
        for mentor in mlist:
            if _try_assign_one_suggested(mentor, eligible_mentees, errors, round_label="round1"):
                suggested += 1

        # Round 2+: greedily fill remaining mentor proposal slots until no progress.
        max_outer = max(50, len(eligible_mentees) * 3)
        outer = 0
        while outer < max_outer:
            outer += 1
            progressed = False
            rnd.shuffle(mlist)
            for mentor in mlist:
                if mentor_proposal_slots_remaining(mentor, str(mentor.get("userId") or "").strip()) <= 0:
                    continue
                if _try_assign_one_suggested(mentor, eligible_mentees, errors, round_label="round2"):
                    suggested += 1
                    progressed = True
            if not progressed:
                break

        def _mentee_has_any_assignment(mentee_id: str) -> bool:
            for row in _query_all_matches_for_mentee(mentee_id):
                mid = str(row.get("mentorUserId") or "")
                if mid == MENTEE_CHANNEL_STATE_MENTOR_ID:
                    continue
                st = str(row.get("status") or "").upper()
                if st in ("SUGGESTED", "PENDING_MENTOR", "CHANNEL_OPENED"):
                    return True
            return False

        unmatched_mentees = [
            m
            for m in eligible_mentees
            if str(m.get("userId") or "").strip() and not _mentee_has_any_assignment(str(m.get("userId") or "").strip())
        ]
        fb, fb_errs = _suggest_fallback_assignments(unmatched_mentees, list(mentor_by_id.values()))
        suggested += fb
        errors.extend(fb_errs[:100])

        mentors_no_proposal: list[str] = []
        for mid, mp in mentor_by_id.items():
            opened = _count_channel_opened_for_mentor(mid)
            pend = _count_suggested_or_pending_for_mentor(mid)
            if opened == 0 and pend == 0 and mentor_proposal_slots_remaining(mp, mid) > 0:
                mentors_no_proposal.append(mid)

        still_unmatched = sum(
            1
            for m in eligible_mentees
            if str(m.get("userId") or "").strip() and not _mentee_has_any_assignment(str(m.get("userId") or "").strip())
        )

        return {
            "totalMentors": len(mentors),
            "totalMentees": len(eligible_mentees),
            "matched": suggested,
            "suggestionsCreated": suggested,
            "unmatched": still_unmatched,
            "errors": errors[:100],
            "fallbackMatched": fb,
            "mentorsWithNoAssignment": mentors_no_proposal,
            "cleanup": cleanup,
        }
    except Exception as e:
        return {
            "totalMentors": 0,
            "totalMentees": 0,
            "matched": 0,
            "suggestionsCreated": 0,
            "unmatched": 0,
            "errors": [str(e)],
            "fallbackMatched": 0,
            "mentorsWithNoAssignment": [],
        }


def run_single_mentee_matching(mentee_user_id: str) -> dict[str, Any]:
    uid = (mentee_user_id or "").strip()
    if not uid:
        return {"error": "missing_mentee_user_id"}
    mentee = _fetch_profile(uid)
    if not mentee:
        return {"error": "profile_not_found"}
    opened = [r for r in _query_all_matches_for_mentee(uid) if str(r.get("status") or "").upper() == "CHANNEL_OPENED"]
    if opened:
        return {"success": True, "alreadyMatched": True}
    mentors, _ = scan_student_profiles_for_mentorship()
    mentors = [
        m
        for m in mentors
        if str(m.get("userId") or "").strip()
        and str(m.get("userId") or "").strip() != uid
        and mentor_proposal_slots_remaining(m, str(m.get("userId") or "").strip()) > 0
    ]
    if not mentors:
        _mark_mentee_queued(uid)
        return {"success": False, "reason": "no_mentors_available"}
    try:
        ranked = build_mentee_suggested_mentors(mentee, mentors, mentee_auth_token=None)
    except Exception as e:
        return {"error": "build_suggestions_failed", "detail": str(e)}
    if not ranked:
        _mark_mentee_queued(uid)
        return {"success": False, "reason": "no_scores"}
    best = ranked[0]
    best_mid = str(best.get("mentorUserId") or "").strip()
    mentor = next((m for m in mentors if str(m.get("userId") or "").strip() == best_mid), None)
    if not mentor:
        _mark_mentee_queued(uid)
        return {"success": False, "reason": "mentor_profile_missing"}
    try:
        cands = build_mentor_candidates(mentor, [mentee], mentor_auth_token=None, include_unavailable=True)
    except Exception as e:
        return {"error": "build_mentor_candidates_failed", "detail": str(e)}
    row = next((c for c in cands if str(c.get("menteeUserId") or "").strip() == uid), None)
    if not row:
        _mark_mentee_queued(uid)
        return {"success": False, "reason": "no_candidate_row"}
    try:
        persisted = upsert_suggestions(
            best_mid,
            [row],
            limit=1,
            mentor_display_name=str(mentor.get("name") or ""),
            allocator_snapshot=None,
        )
    except Exception as e:
        return {"error": "upsert_suggestion_failed", "detail": str(e)}
    if not persisted:
        return {"success": False, "reason": "duplicate_or_conflict"}
    return {
        "success": True,
        "mentorUserId": best_mid,
        "status": "SUGGESTED",
        "score": float(best.get("boostedScore") or best.get("finalScore") or 0.0),
    }


def clear_all_match_records() -> dict[str, Any]:
    """
    Delete every row in MENTORSHIP_MATCHES_TABLE (including synthetic mentee channel state rows).
    Used before a fresh batch re-match; destructive.
    """
    table = _matches_table()
    deleted = 0
    scan_kwargs: dict[str, Any] = {"ProjectionExpression": "mentorUserId, menteeUserId"}
    while True:
        resp = table.scan(**scan_kwargs)
        items = resp.get("Items") or []
        if items:
            with table.batch_writer() as batch:
                for item in items:
                    mu = item.get("mentorUserId")
                    me = item.get("menteeUserId")
                    if mu is None or me is None:
                        continue
                    batch.delete_item(Key={"mentorUserId": mu, "menteeUserId": me})
                    deleted += 1
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        scan_kwargs = {
            "ProjectionExpression": "mentorUserId, menteeUserId",
            "ExclusiveStartKey": lek,
        }
    return {"deletedMatchRows": deleted, "ok": True}


def _batch_get_profiles_by_user_ids(user_ids: list[str]) -> dict[str, dict]:
    """Load StudentProfiles rows for up to hundreds of user ids (batched)."""
    uids = list({str(x).strip() for x in user_ids if str(x).strip()})
    if not uids:
        return {}
    table = _student_profiles_table_ref()
    name = table.name
    client = _dynamo.meta.client
    out: dict[str, dict] = {}
    for i in range(0, len(uids), 100):
        chunk = uids[i : i + 100]
        req: dict[str, Any] = {name: {"Keys": [{"userId": u} for u in chunk]}}
        while req:
            resp = client.batch_get_item(RequestItems=req)
            for item in resp.get("Responses", {}).get(name, []) or []:
                uid = str(item.get("userId") or "").strip()
                if uid:
                    out[uid] = item
            unproc = resp.get("UnprocessedKeys") or {}
            req = unproc if unproc else {}
    return out


def build_admin_run_snapshot() -> dict[str, Any]:
    """
    Current-state view of mentorship matches + per-mentor capacity for admin dashboards.
    Reads MENTORSHIP_MATCHES_TABLE and StudentProfiles (names, mentorCapacity).
    """
    table = _matches_table()
    rows: list[dict] = []
    scan_kw: dict[str, Any] = {}
    while True:
        r = table.scan(**scan_kw)
        rows.extend(r.get("Items") or [])
        if not r.get("LastEvaluatedKey"):
            break
        scan_kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]

    pair_rows: list[dict[str, Any]] = []
    mentor_ids: set[str] = set()
    mentee_ids: set[str] = set()
    for it in rows:
        mid = str(it.get("mentorUserId") or "").strip()
        eid = str(it.get("menteeUserId") or "").strip()
        if not mid or not eid:
            continue
        if mid == MENTEE_CHANNEL_STATE_MENTOR_ID:
            continue
        mentor_ids.add(mid)
        mentee_ids.add(eid)
        pair_rows.append(
            {
                "mentorUserId": mid,
                "menteeUserId": eid,
                "status": str(it.get("status") or ""),
                "channelId": it.get("channelId"),
                "finalScore": it.get("finalScore"),
                "boostedScore": it.get("boostedScore"),
                "updatedAt": it.get("updatedAt"),
            }
        )

    all_ids = list(mentor_ids | mentee_ids)
    prof_by_id = _batch_get_profiles_by_user_ids(all_ids)
    for pr in pair_rows:
        mp = prof_by_id.get(pr["mentorUserId"]) or {}
        ep = prof_by_id.get(pr["menteeUserId"]) or {}
        pr["mentorName"] = mp.get("name")
        pr["menteeName"] = ep.get("name")

    mentors_out: list[dict[str, Any]] = []
    for mid in sorted(mentor_ids):
        prof = prof_by_id.get(mid) or {}
        cap_raw = prof.get("mentorCapacity")
        try:
            cap = int(cap_raw) if cap_raw is not None and str(cap_raw).strip() != "" else 10
        except (TypeError, ValueError):
            cap = 10
        cap = max(1, min(10, cap))
        opened = _count_channel_opened_for_mentor(mid)
        mentors_out.append(
            {
                "mentorUserId": mid,
                "mentorName": prof.get("name"),
                "mentorCapacity": cap,
                "channelOpenedCount": opened,
                "remainingSlots": max(0, cap - opened),
            }
        )

    return {
        "pairs": pair_rows,
        "mentors": mentors_out,
        "pairCount": len(pair_rows),
    }


def _persist_matching_run_record(
    run_id: str,
    started_at: str,
    finished_at: str,
    status: str,
    payload: dict[str, Any],
    snapshot: dict[str, Any] | None,
    error: str | None,
) -> None:
    tbl = _runs_audit_table_ref()
    if not tbl:
        return
    item = {
        "runId": run_id,
        "kind": "MentorshipMatchingRun",
        "startedAt": started_at,
        "finishedAt": finished_at,
        "status": status,
        "reset": payload.get("reset"),
        "batch": payload.get("batch"),
        "error": error,
        "snapshot": snapshot,
    }
    tbl.put_item(Item=_dynamo_convert(copy.deepcopy(item)))
    tbl.put_item(
        Item=_dynamo_convert(
            copy.deepcopy(
                {
                    "runId": LATEST_POINTER_RUN_ID,
                    "lastRunId": run_id,
                    "updatedAt": finished_at,
                    "lastStatus": status,
                }
            )
        )
    )


def get_stored_matching_run(run_id: str) -> dict[str, Any] | None:
    tbl = _runs_audit_table_ref()
    if not tbl:
        return None
    rid = (run_id or "").strip()
    if not rid or rid == LATEST_POINTER_RUN_ID:
        return None
    return (tbl.get_item(Key={"runId": rid}).get("Item") or None)


def get_latest_stored_matching_run() -> dict[str, Any] | None:
    tbl = _runs_audit_table_ref()
    if not tbl:
        return None
    ptr = tbl.get_item(Key={"runId": LATEST_POINTER_RUN_ID}).get("Item")
    if not ptr:
        return None
    last = str(ptr.get("lastRunId") or "").strip()
    if not last:
        return None
    return get_stored_matching_run(last)


def list_stored_matching_runs(limit: int = 25) -> list[dict[str, Any]]:
    tbl = _runs_audit_table_ref()
    if not tbl:
        return []
    lim = max(1, min(100, limit))
    items: list[dict] = []
    scan_kw: dict[str, Any] = {}
    while True:
        r = tbl.scan(**scan_kw)
        for it in r.get("Items") or []:
            rid = str(it.get("runId") or "")
            if rid in (LATEST_POINTER_RUN_ID, SCHEDULE_CONFIG_RUN_ID):
                continue
            items.append(it)
        if not r.get("LastEvaluatedKey"):
            break
        scan_kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]

    def _sk(x: dict) -> str:
        return str(x.get("startedAt") or "")

    items.sort(key=_sk, reverse=True)
    return items[:lim]


def get_matching_schedule_config() -> dict[str, Any]:
    """
    Read admin matching schedule config.
    Persists in MENTORSHIP_MATCHING_RUNS_TABLE when configured; otherwise returns defaults.
    """
    default_cron = (os.environ.get("MENTORSHIP_DEFAULT_CRON") or "cron(0 6 1 9 ? *)").strip()
    default_timezone = (os.environ.get("MENTORSHIP_DEFAULT_TIMEZONE") or "UTC").strip() or "UTC"
    tbl = _runs_audit_table_ref()
    if not tbl:
        return {
            "enabled": True,
            "cronExpression": default_cron,
            "timezone": default_timezone,
            "persistenceEnabled": False,
            "source": "defaults",
        }
    item = tbl.get_item(Key={"runId": SCHEDULE_CONFIG_RUN_ID}).get("Item") or {}
    if not item:
        return {
            "enabled": True,
            "cronExpression": default_cron,
            "timezone": default_timezone,
            "persistenceEnabled": True,
            "source": "defaults",
        }
    return {
        "enabled": bool(item.get("enabled", True)),
        "cronExpression": str(item.get("cronExpression") or default_cron),
        "timezone": str(item.get("timezone") or default_timezone),
        "updatedAt": item.get("updatedAt"),
        "updatedBy": item.get("updatedBy"),
        "lastTriggeredAt": item.get("lastTriggeredAt"),
        "lastTriggeredSlot": item.get("lastTriggeredSlot"),
        "persistenceEnabled": True,
        "source": "stored",
    }


def put_matching_schedule_config(
    *,
    enabled: bool,
    cron_expression: str | None = None,
    timezone: str | None = None,
    updated_by: str | None = None,
) -> dict[str, Any]:
    """
    Persist admin matching schedule config. Requires runs audit table.
    """
    tbl = _runs_audit_table_ref()
    if not tbl:
        raise RuntimeError("Run history not configured")
    default_cron = (os.environ.get("MENTORSHIP_DEFAULT_CRON") or "cron(0 6 1 9 ? *)").strip()
    default_timezone = (os.environ.get("MENTORSHIP_DEFAULT_TIMEZONE") or "UTC").strip() or "UTC"
    cron = (cron_expression or "").strip() or default_cron
    tz = (timezone or "").strip() or default_timezone
    now = _now_iso()
    item = {
        "runId": SCHEDULE_CONFIG_RUN_ID,
        "enabled": bool(enabled),
        "cronExpression": cron,
        "timezone": tz,
        "updatedAt": now,
        "updatedBy": (updated_by or "").strip() or None,
    }
    tbl.put_item(Item=_dynamo_convert(copy.deepcopy(item)))
    return {
        "enabled": bool(enabled),
        "cronExpression": cron,
        "timezone": tz,
        "updatedAt": now,
        "updatedBy": item.get("updatedBy"),
        "persistenceEnabled": True,
    }


def _parse_simple_schedule_cron(cron_expression: str | None) -> tuple[int, int, int, int] | None:
    """
    Parse the limited cron format used by the admin UI:
    cron(min hour day month ? *)
    """
    raw = str(cron_expression or "").strip()
    m = re.match(r"^cron\((\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+\?\s+\*\)$", raw)
    if not m:
        return None
    minute = int(m.group(1))
    hour = int(m.group(2))
    day = int(m.group(3))
    month = int(m.group(4))
    if minute < 0 or minute > 59:
        return None
    if hour < 0 or hour > 23:
        return None
    if day < 1 or day > 31:
        return None
    if month < 1 or month > 12:
        return None
    return (minute, hour, day, month)


def _safe_zoneinfo(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo((tz_name or "UTC").strip() or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def run_scheduled_matching_if_due() -> dict[str, Any]:
    """
    Called by scheduled EventBridge tick.
    Executes admin matching only when the stored schedule is due in its timezone.
    Guards against duplicate execution within the same minute slot.
    """
    schedule = get_matching_schedule_config()
    if not bool(schedule.get("enabled", True)):
        return {"triggered": False, "reason": "schedule_disabled", "schedule": schedule}

    parts = _parse_simple_schedule_cron(schedule.get("cronExpression"))
    if not parts:
        return {"triggered": False, "reason": "invalid_cron_expression", "schedule": schedule}
    sched_minute, sched_hour, sched_day, sched_month = parts

    tz_name = str(schedule.get("timezone") or "UTC").strip() or "UTC"
    tz = _safe_zoneinfo(tz_name)
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(tz)
    due_now = (
        now_local.minute == sched_minute
        and now_local.hour == sched_hour
        and now_local.day == sched_day
        and now_local.month == sched_month
    )
    if not due_now:
        return {
            "triggered": False,
            "reason": "not_due",
            "nowLocal": now_local.strftime("%Y-%m-%d %H:%M %Z"),
            "schedule": schedule,
        }

    slot_key = now_local.strftime("%Y-%m-%dT%H:%M")
    tbl = _runs_audit_table_ref()
    if tbl:
        try:
            tbl.update_item(
                Key={"runId": SCHEDULE_CONFIG_RUN_ID},
                UpdateExpression="SET lastTriggeredSlot = :slot, lastTriggeredAt = :at",
                ConditionExpression="attribute_not_exists(lastTriggeredSlot) OR lastTriggeredSlot <> :slot",
                ExpressionAttributeValues={":slot": slot_key, ":at": _now_iso()},
            )
        except ClientError as e:
            if (e.response.get("Error") or {}).get("Code") == "ConditionalCheckFailedException":
                return {
                    "triggered": False,
                    "reason": "already_triggered_this_minute",
                    "slot": slot_key,
                    "schedule": schedule,
                }
            raise

    result = run_admin_matching_job(trigger_source="schedule")
    return {"triggered": True, "slot": slot_key, "result": result}


def run_mentorship_matching_run(
    *,
    reset_matches: bool = False,
    run_batch_matching: bool = True,
    trigger_source: str = "manual",
) -> dict[str, Any]:
    """
    Orchestrates an admin-triggered MentorshipMatchingRun: optional full table reset, then batch matching.
    Persists audit row + snapshot when MENTORSHIP_MATCHING_RUNS_TABLE is configured.
    """
    run_id = str(uuid.uuid4())
    started_at = _now_iso()
    out: dict[str, Any] = {
        "runId": run_id,
        "kind": "MentorshipMatchingRun",
        "startedAt": started_at,
        "triggerSource": (trigger_source or "manual"),
    }
    err: str | None = None
    snapshot: dict[str, Any] | None = None
    status = "COMPLETED"

    try:
        if reset_matches:
            out["reset"] = clear_all_match_records()
        if run_batch_matching:
            out["batch"] = run_annual_batch_matching()
        else:
            out["batch"] = None
        snapshot = build_admin_run_snapshot()
    except Exception as e:
        status = "FAILED"
        err = str(e)
        out["status"] = status
        out["error"] = err
        logger.exception("run_mentorship_matching_run failed: %s", e)
    else:
        out["status"] = status

    finished_at = _now_iso()
    out["finishedAt"] = finished_at

    try:
        _persist_matching_run_record(run_id, started_at, finished_at, status, out, snapshot, err)
    except Exception as pe:
        logger.warning("persist matching run record failed: %s", pe)

    response = {k: v for k, v in out.items() if k != "snapshot"}
    if snapshot and status == "COMPLETED":
        response["snapshotSummary"] = {
            "pairCount": snapshot.get("pairCount", 0),
            "mentorCount": len(snapshot.get("mentors") or []),
        }

    if status == "FAILED":
        raise RuntimeError(err or "Mentorship matching run failed")

    return response


def run_admin_matching_job(
    *,
    reset_matches: bool = False,
    run_batch_matching: bool = True,
    trigger_source: str = "manual",
) -> dict[str, Any]:
    """
    Admin-oriented orchestrator alias used by /mentorship/admin/run and schedule triggers.
    """
    result = run_mentorship_matching_run(
        reset_matches=reset_matches,
        run_batch_matching=run_batch_matching,
        trigger_source=trigger_source,
    )
    return result

