"""
Role Logic Engine: assign PARTNER, FORMER_STUDENT, or FRIEND on registration.
- Match email domain against Team Howdy's Company List -> PARTNER
- "Former Student" checked + Class Year -> FORMER_STUDENT
- Else -> FRIEND
"""

import os
import json
import urllib.request
from typing import Optional, Tuple

# Optional: Team Howdy Company List API URL (stub if not set)
COMPANY_LIST_API_URL = os.environ.get("COMPANY_LIST_API_URL", "").rstrip("/")


def _domain_from_email(email: str) -> str:
    """Extract lowercase domain from email."""
    if not email or "@" not in email:
        return ""
    return email.strip().split("@")[-1].lower()


def _fetch_company_domains() -> set:
    """
    Fetch partner domains from the Company List API (admin-service or compatible).
    GET {COMPANY_LIST_API_URL} is called. Supported response shapes:
    - List of strings: ["a.com", "b.com"] -> use as domains.
    - Object with "domains" key: {"domains": ["a.com", "b.com"]} -> use domains.
    - List of objects with "domain" key: [{ "domain": "a.com", ... }, ...] -> extract domain from each
      (matches admin-service cmis-company-api GET-all-companies response).
    If COMPANY_LIST_API_URL is not set, returns a stub set for development.
    """
    if not COMPANY_LIST_API_URL:
        return {"acme.com", "partner.org", "example.com"}
    try:
        req = urllib.request.Request(
            COMPANY_LIST_API_URL,
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read().decode()
            body = json.loads(data)
        if isinstance(body, list):
            if not body:
                return set()
            first = body[0]
            if isinstance(first, str):
                return set(d.lower() for d in body if isinstance(d, str))
            if isinstance(first, dict) and "domain" in first:
                return set(str(c.get("domain", "")).strip().lower() for c in body if c.get("domain"))
        if isinstance(body, dict) and "domains" in body:
            return set(d.lower() for d in body["domains"] if isinstance(d, str))
        return set()
    except Exception:
        return set()


def resolve_role(
    email: str,
    former_student_checked: bool,
    class_year: Optional[str] = None,
) -> Tuple[str, Optional[str]]:
    """
    Resolve role and validated class_year.
    Returns (role, class_year).
    - PARTNER if email domain in Company List
    - FORMER_STUDENT if former_student_checked (class_year required)
    - FRIEND otherwise
    """
    domain = _domain_from_email(email)
    company_domains = _fetch_company_domains()

    if domain and domain in company_domains:
        return "PARTNER", (class_year or None)

    if former_student_checked:
        if not (class_year and str(class_year).strip()):
            raise ValueError("Class Year is required when claiming Former Student")
        return "FORMER_STUDENT", str(class_year).strip()

    return "FRIEND", None
