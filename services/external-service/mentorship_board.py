"""
Board company tier resolution for mentorship boost multipliers.

Uses COMPANY_LIST_API_URL (same as role_engine) when set. Each company object may include:
- domain (string)
- name (string)
- boardTier | partnerBoardTier | sponsorTier | tier — values like "gold", "silver" (case-insensitive)

Fallback env (comma-separated domains, lowercase):
- MENTORSHIP_BOARD_GOLD_DOMAINS
- MENTORSHIP_BOARD_SILVER_DOMAINS

Multipliers (env overrides):
- MENTORSHIP_BOARD_GOLD_MULTIPLIER (default 1.15)
- MENTORSHIP_BOARD_SILVER_MULTIPLIER (default 1.08)
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from functools import lru_cache
from typing import Any


COMPANY_LIST_API_URL = (os.environ.get("COMPANY_LIST_API_URL") or "").strip().rstrip("/")


def _domain_from_email(email: str) -> str:
    if not email or "@" not in email:
        return ""
    return email.strip().split("@")[-1].lower()


def _normalize_tier_value(raw: Any) -> str:
    if raw is None:
        return "none"
    s = str(raw).strip().lower()
    if s in ("gold", "board_gold", "board-gold", "gold_board"):
        return "gold"
    if s in ("silver", "board_silver", "board-silver", "silver_board"):
        return "silver"
    return "none"


def _tier_from_company_obj(obj: dict) -> str:
    if not isinstance(obj, dict):
        return "none"
    for key in ("boardTier", "partnerBoardTier", "sponsorTier", "tier", "board"):
        t = _normalize_tier_value(obj.get(key))
        if t != "none":
            return t
    return "none"


def _parse_company_body(body: Any) -> list[dict]:
    if isinstance(body, list):
        return [x for x in body if isinstance(x, dict)]
    if isinstance(body, dict):
        for k in ("companies", "items", "data"):
            v = body.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    return []


@lru_cache(maxsize=1)
def _cached_company_fetch() -> tuple[list[dict], float]:
    """Returns (company dicts, 0). Cached for Lambda warm container."""
    if not COMPANY_LIST_API_URL:
        return [], 0.0
    try:
        req = urllib.request.Request(
            COMPANY_LIST_API_URL,
            headers={"Accept": "application/json"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            body = json.loads(resp.read().decode("utf-8") or "{}")
    except Exception:
        return [], 0.0
    rows = _parse_company_body(body)
    if not rows and isinstance(body, list) and body and isinstance(body[0], dict) and "domain" in body[0]:
        rows = [x for x in body if isinstance(x, dict)]
    return rows, 0.0


def _env_domain_tiers() -> dict[str, str]:
    out: dict[str, str] = {}
    gold_raw = (os.environ.get("MENTORSHIP_BOARD_GOLD_DOMAINS") or "").strip()
    silver_raw = (os.environ.get("MENTORSHIP_BOARD_SILVER_DOMAINS") or "").strip()
    for d in gold_raw.split(","):
        dom = d.strip().lower()
        if dom:
            out[dom] = "gold"
    for d in silver_raw.split(","):
        dom = d.strip().lower()
        if dom:
            if dom not in out:
                out[dom] = "silver"
    return out


def build_board_lookup() -> tuple[dict[str, str], dict[str, str]]:
    """
    domain -> tier, normalized_company_name -> tier (best effort).
    """
    domain_tier: dict[str, str] = dict(_env_domain_tiers())
    name_tier: dict[str, str] = {}
    companies, _ = _cached_company_fetch()
    for c in companies:
        tier = _tier_from_company_obj(c)
        if tier == "none":
            continue
        dom = str(c.get("domain") or "").strip().lower()
        if dom:
            prev = domain_tier.get(dom)
            if prev != "gold":
                domain_tier[dom] = tier
        name = str(c.get("name") or "").strip().lower()
        if name:
            if name not in name_tier or tier == "gold":
                name_tier[name] = tier
    return domain_tier, name_tier


def resolve_mentor_board_tier(mentor_profile: dict | None) -> tuple[str, float, str]:
    """
    Returns (tier_label, multiplier, human_reason).
    tier_label is 'gold' | 'silver' | 'none'.
    """
    gold_m = float((os.environ.get("MENTORSHIP_BOARD_GOLD_MULTIPLIER") or "1.15").strip() or "1.15")
    silver_m = float((os.environ.get("MENTORSHIP_BOARD_SILVER_MULTIPLIER") or "1.08").strip() or "1.08")
    try:
        gold_m = max(1.0, min(2.0, gold_m))
        silver_m = max(1.0, min(2.0, silver_m))
    except Exception:
        gold_m, silver_m = 1.15, 1.08

    if not mentor_profile:
        return "none", 1.0, ""

    domain_map, name_map = build_board_lookup()

    # 1) Email domain on profile
    emails_raw = str(mentor_profile.get("email") or "")
    for part in emails_raw.split(","):
        dom = _domain_from_email(part.strip())
        if dom and dom in domain_map:
            t = domain_map[dom]
            m = gold_m if t == "gold" else silver_m
            return t, m, f"Board partner ({t}) — email domain @{dom}"

    # 2) Mentor company free text vs company name map
    company = str(mentor_profile.get("mentorCompany") or "").strip().lower()
    if company:
        if company in name_map:
            t = name_map[company]
            m = gold_m if t == "gold" else silver_m
            return t, m, f"Board partner ({t}) — company match"
        for known_name, t in name_map.items():
            if len(known_name) >= 3 and (known_name in company or company in known_name):
                m = gold_m if t == "gold" else silver_m
                return t, m, f"Board partner ({t}) — company alignment"

    # 3) Heuristic: company string looks like domain
    token = re.sub(r"^https?://", "", company).split("/")[0].strip().lower()
    if "." in token and token in domain_map:
        t = domain_map[token]
        m = gold_m if t == "gold" else silver_m
        return t, m, f"Board partner ({t}) — company domain"

    return "none", 1.0, "Standard partner tier (no board boost)"


def clear_board_cache() -> None:
    """Test hook."""
    _cached_company_fetch.cache_clear()
