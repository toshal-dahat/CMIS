"""Generic audit logging extension point.

Current state:
- Intentionally a no-op (safe default in all environments).
- Exists so endpoint code can emit audit intents without being coupled to a
  specific sink implementation.

Recommended future implementations:
- CloudWatch structured log events.
- DynamoDB-backed immutable audit trail.
- EventBridge fan-out for centralized SIEM ingestion.

Note: graduation handover currently uses `handover_log.py` for a focused
workflow-specific audit stream.
"""

from typing import Any, Optional


def log_event(
    event_type: str,
    user_id: Optional[str] = None,
    detail: Optional[dict] = None,
) -> None:
    """
    Record an application audit event.

    Args:
        event_type: Stable event name (e.g., ``auth.signin.success``).
        user_id: Optional actor identifier (usually Cognito ``sub``).
        detail: Optional structured payload with event context.

    This function intentionally returns ``None`` and should never raise in the
    no-op implementation, so it is safe to call from critical request paths.
    """
    # Optional: import logging and log to CloudWatch
    # import logging
    # logging.info("audit", extra={"type": event_type, "user_id": user_id, "detail": detail or {}})
    pass
