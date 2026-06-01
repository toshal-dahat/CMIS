"""Input validation helpers for external service."""

import re
from typing import Optional, Tuple


def normalize_email(value: Optional[str]) -> Optional[str]:
    """Return trimmed lower email or None if invalid."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip().lower()
    if "@" in s and "." in s:
        return s
    return None


def validate_uin(uin: Optional[str]) -> Tuple[bool, Optional[str]]:
    """Return (True, cleaned_uin) or (False, error_message)."""
    if not uin or not isinstance(uin, str):
        return False, "UIN is required"
    s = uin.strip()
    if not s:
        return False, "UIN is required"
    if not re.match(r"^[0-9]{7,15}$", s):
        return False, "UIN must be numeric (7–15 digits)"
    return True, s


def validate_password_length(password: Optional[str], min_len: int = 10) -> Tuple[bool, Optional[str]]:
    """Return (True, None) or (False, error_message)."""
    if not password:
        return False, "Password is required"
    if len(password) < min_len:
        return False, f"Password must be at least {min_len} characters"
    return True, None


def validate_class_year(value: Optional[str]) -> Optional[str]:
    """Return trimmed class year (e.g. 26) or None."""
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None
