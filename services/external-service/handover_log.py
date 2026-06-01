"""Audit log for graduation handover: INITIATED, SUCCESS, FAILED. TTL 90 days."""

import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import boto3

TABLE_NAME = (os.environ.get("HANDOVER_LOG_TABLE") or "").strip()
dynamo = boto3.resource("dynamodb")
table = dynamo.Table(TABLE_NAME) if TABLE_NAME else None

TTL_DAYS = 90


def _ttl_ts() -> int:
    """Unix timestamp for TTL (90 days from now)."""
    return int((datetime.now(timezone.utc) + timedelta(days=TTL_DAYS)).timestamp())


def log_initiated(user_id: str, uin: str, personal_email: str) -> str:
    """Log handover initiated. Returns handover_id for success/fail correlation."""
    if not table:
        return ""
    handover_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).isoformat()
    try:
        table.put_item(Item={
            "handover_id": handover_id,
            "timestamp": ts,
            "status": "INITIATED",
            "user_id": user_id,
            "uin": uin,
            "personal_email": personal_email,
            "ttl_expiry": _ttl_ts(),
        })
    except Exception:
        pass
    return handover_id


def log_success(handover_id: str, user_id: str, uin: str) -> None:
    if not table or not handover_id:
        return
    ts = datetime.now(timezone.utc).isoformat()
    try:
        table.put_item(Item={
            "handover_id": handover_id,
            "timestamp": ts,
            "status": "SUCCESS",
            "user_id": user_id,
            "uin": uin,
            "ttl_expiry": _ttl_ts(),
        })
    except Exception:
        pass


def log_failed(handover_id: str, user_id: str, uin: str, reason: Optional[str] = None) -> None:
    if not table or not handover_id:
        return
    ts = datetime.now(timezone.utc).isoformat()
    item = {
        "handover_id": handover_id,
        "timestamp": ts,
        "status": "FAILED",
        "user_id": user_id,
        "uin": uin,
        "ttl_expiry": _ttl_ts(),
    }
    if reason:
        item["reason"] = reason[:500]
    try:
        table.put_item(Item=item)
    except Exception:
        pass


def list_recent(limit: int = 100) -> list:
    """Return recent handover log entries (all statuses), newest first. Admin only."""
    if not table:
        return []
    try:
        r = table.scan(Limit=limit * 3)
        items = r.get("Items", [])
        while r.get("LastEvaluatedKey") and len(items) < limit * 2:
            r = table.scan(Limit=limit * 3, ExclusiveStartKey=r["LastEvaluatedKey"])
            items.extend(r.get("Items", []))
        items.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
        return items[:limit]
    except Exception:
        return []
