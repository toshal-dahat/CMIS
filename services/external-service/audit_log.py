"""Generic audit logging placeholder. Handover-specific audit is in handover_log.py."""

from typing import Any, Optional


def log_event(
    event_type: str,
    user_id: Optional[str] = None,
    detail: Optional[dict] = None,
) -> None:
    """
    Placeholder for generic audit events (e.g. login, profile update).
    Can be extended to write to DynamoDB or CloudWatch.
    """
    # Optional: import logging and log to CloudWatch
    # import logging
    # logging.info("audit", extra={"type": event_type, "user_id": user_id, "detail": detail or {}})
    pass
