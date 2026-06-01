"""
Board company tier resolution for mentorship boost multipliers.

**Companies:** `GET COMPANY_LIST_API_URL` (admin `/companies`) — `domain`, `name`, `tierId`, and/or
`boardTier` / `partnerBoardTier` / `sponsorTier` / `tier` (classic **gold** / **silver** / **bronze**).

**Admin tier API (optional):** `GET` admin `/tiers` (`MENTORSHIP_TIERS_API_URL` or derived from
`/companies` → `/tiers`). Each tier has `tierId` and `rank` (lower rank = more exclusive).
Multipliers interpolate linearly: `MENTORSHIP_BOARD_TOP_TIER_MULTIPLIER` … `MENTORSHIP_BOARD_BOTTOM_TIER_MULTIPLIER`.

**Classic Gold/Silver/Bronze (env):** comma-separated domains `MENTORSHIP_BOARD_*_DOMAINS` and
per-tier multipliers `MENTORSHIP_BOARD_GOLD_MULTIPLIER` (default 1.15), `SILVER` (1.08), `BRONZE` (1.05).
When a tier slug is exactly `gold`, `silver`, or `bronze`, these env multipliers override the admin curve.

**Cache:** Company list and tiers list HTTP responses are cached in-process for
`MENTORSHIP_BOARD_COMPANY_CACHE_SEC` (default 300).
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from typing import Any

COMPANY_LIST_API_URL = (os.environ.get("COMPANY_LIST_API_URL") or "").strip().rstrip("/")
MENTORSHIP_TIERS_API_URL = (os.environ.get("MENTORSHIP_TIERS_API_URL") or "").strip().rstrip("/")

# (display tier slug, admin rank for merge — lower rank = better)
BoardEntry = tuple[str, int]

_company_fetch_cache: tuple[list[dict], float] | None = None
_tier_fetch_cache: tuple[tuple[dict[str, Any], ...], float] | None = None
_tier_cache_expiry: float = 0.0


def _company_cache_ttl_sec() -> float:
    try:
        return float((os.environ.get("MENTORSHIP_BOARD_COMPANY_CACHE_SEC") or "300").strip() or "300")
    except (TypeError, ValueError):
        return 300.0


def _tiers_list_url() -> str:
    if MENTORSHIP_TIERS_API_URL:
        return MENTORSHIP_TIERS_API_URL
    if not COMPANY_LIST_API_URL:
        return ""
    if re.search(r"/companies/?$", COMPANY_LIST_API_URL, flags=re.IGNORECASE):
        return re.sub(r"/companies/?$", "/tiers", COMPANY_LIST_API_URL, flags=re.IGNORECASE).rstrip("/")
    return ""


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
    if s in ("bronze", "board_bronze", "board-bronze", "bronze_board"):
        return "bronze"
    return "none"


def _tier_from_company_obj(obj: dict) -> str:
    """Classic gold/silver/bronze from company object fields."""
    if not isinstance(obj, dict):
        return "none"
    for key in ("boardTier", "partnerBoardTier", "sponsorTier", "tier", "board"):
        t = _normalize_tier_value(obj.get(key))
        if t != "none":
            return t
    return "none"


def _raw_tier_string(obj: dict) -> str:
    tid = obj.get("tierId")
    if isinstance(tid, str) and tid.strip():
        return tid.strip()
    for key in ("boardTier", "partnerBoardTier", "sponsorTier", "tier", "board"):
        v = obj.get(key)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def _display_slug(raw: str) -> str:
    return raw.strip().lower().replace(" ", "-")


def _tier_slug_from_item(item: dict) -> str:
    tid = str(item.get("tierId") or "").strip().lower()
    if tid:
        return tid
    pk = str(item.get("PK") or "")
    if pk.upper().startswith("TIER#"):
        return pk[5:].strip().lower()
    return ""


def _classic_slug_rank(slug: str) -> int:
    """Lower = better (aligned with admin rank convention)."""
    return {"gold": 1, "silver": 2, "bronze": 3}.get(slug, 99)


def _prefer_better_tier(prev: BoardEntry | None, new: BoardEntry) -> BoardEntry:
    if prev is None:
        return new
    pr, ps = prev[1], prev[0]
    nr, ns = new[1], new[0]
    if nr < pr:
        return new
    if nr == pr and ns < ps:
        return new
    return prev


def _parse_company_body(body: Any) -> list[dict]:
    if isinstance(body, list):
        return [x for x in body if isinstance(x, dict)]
    if isinstance(body, dict):
        for k in ("companies", "items", "data"):
            v = body.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    return []


def _cached_company_fetch() -> tuple[list[dict], float]:
    """Returns (company dicts, monotonic timestamp of fetch)."""
    global _company_fetch_cache
    now = time.monotonic()
    ttl = _company_cache_ttl_sec()
    if _company_fetch_cache is not None:
        rows, ts = _company_fetch_cache
        if now - ts < ttl:
            return rows, ts
    if not COMPANY_LIST_API_URL:
        _company_fetch_cache = ([], now)
        return [], now
    try:
        req = urllib.request.Request(
            COMPANY_LIST_API_URL,
            headers={"Accept": "application/json"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            body = json.loads(resp.read().decode("utf-8") or "{}")
    except Exception:
        _company_fetch_cache = ([], now)
        return [], now
    rows = _parse_company_body(body)
    if not rows and isinstance(body, list) and body and isinstance(body[0], dict) and "domain" in body[0]:
        rows = [x for x in body if isinstance(x, dict)]
    _company_fetch_cache = (rows, now)
    return rows, now


def _cached_tier_items() -> tuple[dict[str, Any], ...]:
    """Tier rows from admin; TTL-cached with same window as company list."""
    global _tier_fetch_cache, _tier_cache_expiry
    now = time.monotonic()
    ttl = _company_cache_ttl_sec()
    if _tier_fetch_cache is not None and time.time() <= _tier_cache_expiry:
        tup, ts = _tier_fetch_cache
        if now - ts < ttl:
            return tup
    url = _tiers_list_url()
    if not url:
        _tier_fetch_cache = (tuple(), now)
        _tier_cache_expiry = time.time() + 300
        return tuple()
    try:
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/json"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            body = json.loads(resp.read().decode("utf-8") or "[]")
    except Exception:
        _tier_fetch_cache = (tuple(), now)
        _tier_cache_expiry = time.time() + 300
        return tuple()
    if not isinstance(body, list):
        _tier_fetch_cache = (tuple(), now)
        _tier_cache_expiry = time.time() + 300
        return tuple()
    out: list[dict[str, Any]] = []
    for item in body:
        if isinstance(item, dict):
            out.append(item)
    tup = tuple(out)
    _tier_fetch_cache = (tup, now)
    _tier_cache_expiry = time.time() + 300
    return tup


def _tier_rank_map() -> dict[str, int]:
    m: dict[str, int] = {}
    for item in _cached_tier_items():
        slug = _tier_slug_from_item(item)
        if not slug:
            continue
        try:
            r = int(item.get("rank"))
        except (TypeError, ValueError):
            r = 999
        prev = m.get(slug)
        if prev is None or r < prev:
            m[slug] = r
    return m


def _tier_slug_multipliers() -> dict[str, float]:
    rows: list[tuple[str, int]] = []
    for item in _cached_tier_items():
        slug = _tier_slug_from_item(item)
        if not slug:
            continue
        try:
            r = int(item.get("rank"))
        except (TypeError, ValueError):
            r = 999
        rows.append((slug, r))
    best: dict[str, int] = {}
    for slug, r in rows:
        if slug not in best or r < best[slug]:
            best[slug] = r
    ordered = sorted(best.items(), key=lambda x: (x[1], x[0]))
    n = len(ordered)
    try:
        top = float((os.environ.get("MENTORSHIP_BOARD_TOP_TIER_MULTIPLIER") or "1.5").strip() or "1.5")
        bot = float((os.environ.get("MENTORSHIP_BOARD_BOTTOM_TIER_MULTIPLIER") or "1.0").strip() or "1.0")
    except Exception:
        top, bot = 1.5, 1.0
    top = max(1.0, min(2.0, top))
    bot = max(1.0, min(top, bot))
    if n == 0:
        return {}
    if n == 1:
        return {ordered[0][0]: round(top, 4)}
    out: dict[str, float] = {}
    for i, (slug, _) in enumerate(ordered):
        frac = (n - 1 - i) / (n - 1)
        out[slug] = round(bot + (top - bot) * frac, 4)
    return out


def _classic_tier_multipliers() -> dict[str, float]:
    try:
        gold_m = float((os.environ.get("MENTORSHIP_BOARD_GOLD_MULTIPLIER") or "1.15").strip() or "1.15")
        silver_m = float((os.environ.get("MENTORSHIP_BOARD_SILVER_MULTIPLIER") or "1.08").strip() or "1.08")
        bronze_m = float((os.environ.get("MENTORSHIP_BOARD_BRONZE_MULTIPLIER") or "1.05").strip() or "1.05")
        gold_m = max(1.0, min(2.0, gold_m))
        silver_m = max(1.0, min(2.0, silver_m))
        bronze_m = max(1.0, min(2.0, bronze_m))
    except Exception:
        gold_m, silver_m, bronze_m = 1.15, 1.08, 1.05
    return {"gold": gold_m, "silver": silver_m, "bronze": bronze_m}


def _env_domain_tiers() -> dict[str, str]:
    out: dict[str, str] = {}
    gold_raw = (os.environ.get("MENTORSHIP_BOARD_GOLD_DOMAINS") or "").strip()
    silver_raw = (os.environ.get("MENTORSHIP_BOARD_SILVER_DOMAINS") or "").strip()
    bronze_raw = (os.environ.get("MENTORSHIP_BOARD_BRONZE_DOMAINS") or "").strip()
    for d in gold_raw.split(","):
        dom = d.strip().lower()
        if dom:
            out[dom] = "gold"
    for d in silver_raw.split(","):
        dom = d.strip().lower()
        if dom:
            if dom not in out:
                out[dom] = "silver"
    for d in bronze_raw.split(","):
        dom = d.strip().lower()
        if dom:
            if dom not in out:
                out[dom] = "bronze"
    return out


def _board_entry_from_company(obj: dict, ranks_map: dict[str, int]) -> BoardEntry | None:
    classic = _tier_from_company_obj(obj)
    if classic != "none":
        return (classic, _classic_slug_rank(classic))
    raw = _raw_tier_string(obj)
    if not raw:
        return None
    slug = _display_slug(raw)
    # Map classic words in tierId to env multipliers
    if slug in ("gold", "silver", "bronze"):
        return (slug, _classic_slug_rank(slug))
    rank = int(ranks_map.get(slug, 999))
    return (slug, rank)


def build_board_lookup() -> tuple[dict[str, BoardEntry], dict[str, BoardEntry]]:
    ranks_map = _tier_rank_map()
    domain_tier: dict[str, BoardEntry] = {}
    name_tier: dict[str, BoardEntry] = {}

    for dom, tslug in _env_domain_tiers().items():
        entry: BoardEntry = (tslug, _classic_slug_rank(tslug))
        domain_tier[dom] = _prefer_better_tier(domain_tier.get(dom), entry)

    companies, _ = _cached_company_fetch()
    for c in companies:
        entry = _board_entry_from_company(c, ranks_map)
        if entry is None:
            continue
        dom = str(c.get("domain") or "").strip().lower()
        if dom:
            domain_tier[dom] = _prefer_better_tier(domain_tier.get(dom), entry)
        name = str(c.get("name") or "").strip().lower()
        if name:
            name_tier[name] = _prefer_better_tier(name_tier.get(name), entry)
    return domain_tier, name_tier


def _fallback_match_mult() -> float:
    try:
        v = float((os.environ.get("MENTORSHIP_BOARD_NO_TIERS_API_MULTIPLIER") or "1.08").strip() or "1.08")
        return max(1.0, min(2.0, v))
    except Exception:
        return 1.08


def _mult_for_slug(slug: str, mult_map: dict[str, float]) -> tuple[float, str]:
    classic = _classic_tier_multipliers()
    if slug in classic:
        m = classic[slug]
        return m, f"classic tier ×{m:.3f}"
    m = mult_map.get(slug)
    if m is not None:
        return m, f"ranked tier ×{m:.3f}"
    if mult_map:
        floor = min(mult_map.values())
        return floor, f"tier not in rank list; floor ×{floor:.3f}"
    fb = _fallback_match_mult()
    return fb, f"tiers list unavailable; flat ×{fb:.3f}"


def resolve_mentor_board_tier(mentor_profile: dict | None) -> tuple[str, float, str]:
    """
    Returns (tier_label, multiplier, human_reason).
    tier_label is an admin slug or gold|silver|bronze|none.
    """
    if not mentor_profile:
        return "none", 1.0, ""

    mult_map = _tier_slug_multipliers()
    domain_map, name_map = build_board_lookup()

    def _tier_tag(slug: str, r: int) -> str:
        if slug in ("gold", "silver", "bronze"):
            return f"classic {slug}"
        return f"admin rank {r}" if r < 900 else "admin rank n/a"

    # 1) Email domain
    emails_raw = str(mentor_profile.get("email") or "")
    for part in emails_raw.split(","):
        dom = _domain_from_email(part.strip())
        if dom and dom in domain_map:
            slug, rank = domain_map[dom]
            m, detail = _mult_for_slug(slug, mult_map)
            return (
                slug,
                m,
                f"Board partner ({slug}, {_tier_tag(slug, rank)}) — email @{dom}; {detail}",
            )

    # 2) Company exact name
    company = str(mentor_profile.get("mentorCompany") or "").strip().lower()
    if company:
        if company in name_map:
            slug, rank = name_map[company]
            m, detail = _mult_for_slug(slug, mult_map)
            return (
                slug,
                m,
                f"Board partner ({slug}, {_tier_tag(slug, rank)}) — company name; {detail}",
            )
        for known_name, pair in name_map.items():
            slug, rank = pair
            if len(known_name) >= 3 and (known_name in company or company in known_name):
                m, detail = _mult_for_slug(slug, mult_map)
                return (
                    slug,
                    m,
                    f"Board partner ({slug}, {_tier_tag(slug, rank)}) — company alignment; {detail}",
                )
        token = re.sub(r"^https?://", "", company).split("/")[0].strip().lower()
        if "." in token and token in domain_map:
            slug, rank = domain_map[token]
            m, detail = _mult_for_slug(slug, mult_map)
            return (
                slug,
                m,
                f"Board partner ({slug}, {_tier_tag(slug, rank)}) — company domain; {detail}",
            )

    return "none", 1.0, "Standard partner tier (no board boost from company directory)"


def clear_board_cache() -> None:
    """Clear cached company + tier HTTP caches."""
    global _company_fetch_cache, _tier_fetch_cache
    _company_fetch_cache = None
    _tier_fetch_cache = None


def get_boost_multiplier(mentor_profile: dict | None = None) -> float:
    """Compatibility helper for quick multiplier checks in scripts/tests."""
    _tier, mult, _reason = resolve_mentor_board_tier(mentor_profile or {})
    return float(mult)
