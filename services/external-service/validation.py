"""Input validation helpers for external-service request payloads.

These helpers are intentionally lightweight and side-effect free. They are used
for quick boundary checks (format/shape), while route handlers still enforce
business rules and authorization.
"""

import re
from typing import Optional, Tuple


def normalize_email(value: Optional[str]) -> Optional[str]:
    """Return normalized lowercase email or ``None`` when invalid.

    Validation here is intentionally permissive (basic ``@`` and ``.`` checks)
    because Cognito and downstream systems apply stricter constraints.
    """
    if not value or not isinstance(value, str):
        return None
    s = value.strip().lower()
    if "@" in s and "." in s:
        return s
    return None


def validate_uin(uin: Optional[str]) -> Tuple[bool, Optional[str]]:
    """Validate UIN as numeric text, returning ``(ok, cleaned_or_error)``."""
    if not uin or not isinstance(uin, str):
        return False, "UIN is required"
    s = uin.strip()
    if not s:
        return False, "UIN is required"
    if not re.match(r"^[0-9]{7,15}$", s):
        return False, "UIN must be numeric (7–15 digits)"
    return True, s


def validate_password_length(password: Optional[str], min_len: int = 10) -> Tuple[bool, Optional[str]]:
    """Check password minimum length policy, returning ``(ok, error)``."""
    if not password:
        return False, "Password is required"
    if len(password) < min_len:
        return False, f"Password must be at least {min_len} characters"
    return True, None


def validate_class_year(value: Optional[str]) -> Optional[str]:
    """Normalize class-year text; return ``None`` for empty/absent values."""
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None
