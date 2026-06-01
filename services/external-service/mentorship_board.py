"""
Board company tier resolution for mentorship boost multipliers.

**Companies:** `GET COMPANY_LIST_API_URL` (admin `/companies`) — `domain`, `name`, `tierId`.

**Tier ordering:** `GET` the admin tiers list (same API host as companies: URL ending in
`/companies` is rewritten to `/tiers`, or set `MENTORSHIP_TIERS_API_URL` explicitly).
Each tier has `tierId` and `rank` (lower rank = more exclusive). Multipliers interpolate
linearly from rank 1 (best) down to the worst rank: top gets `MENTORSHIP_BOARD_TOP_TIER_MULTIPLIER`
(default **1.5**), bottom rank gets `MENTORSHIP_BOARD_BOTTOM_TIER_MULTIPLIER` (default **1.0**).

Mentor ↔ company matching uses **only** that company list (email domain, exact company name,
or company field as hostname matching `domain`).

**Dynamics:** Tier definitions and company rows are refetched when the Lambda container is
cold or the in-process cache is cleared; warm containers reuse cached HTTP responses until
then (typical for Lambda). Admin changes take effect on the next cache refresh cycle.

Env:
- `MENTORSHIP_TIERS_API_URL` — optional full URL to `GET /tiers`; if unset, derived from
  `COMPANY_LIST_API_URL` by replacing a trailing `/companies` with `/tiers`.
- `MENTORSHIP_BOARD_TOP_TIER_MULTIPLIER` (default 1.5, clamped 1–2)
- `MENTORSHIP_BOARD_BOTTOM_TIER_MULTIPLIER` (default 1.0, clamped 1–top)
- `MENTORSHIP_BOARD_NO_TIERS_API_MULTIPLIER` — when tiers `GET` fails or returns empty but a
  company match exists, use this single boost (default 1.08).
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from functools import lru_cache
from typing import Any

COMPANY_LIST_API_URL = (os.environ.get("COMPANY_LIST_API_URL") or "").strip().rstrip("/")
MENTORSHIP_TIERS_API_URL = (os.environ.get("MENTORSHIP_TIERS_API_URL") or "").strip().rstrip("/")

# (display tier slug, admin rank for merge — lower rank = better)
BoardEntry = tuple[str, int]


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


def _board_entry_from_company(obj: dict, ranks_map: dict[str, int]) -> BoardEntry | None:
    raw = _raw_tier_string(obj)
    if not raw:
        return None
    slug = _display_slug(raw)
    rank = int(ranks_map.get(slug, 999))
    return (slug, rank)


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


@lru_cache(maxsize=1)
def _cached_tier_items() -> tuple[dict[str, Any], ...]:
    """Immutable snapshot of tier rows from admin (for rank + multiplier curve)."""
    url = _tiers_list_url()
    if not url:
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
        return tuple()
    if not isinstance(body, list):
        return tuple()
    out: list[dict[str, Any]] = []
    for item in body:
        if isinstance(item, dict):
            out.append(item)
    return tuple(out)


def _tier_rank_map() -> dict[str, int]:
    """tierId slug -> admin rank (lower = better)."""
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
    """
    tierId (lowercase) -> multiplier, from admin rank order (rank 1 = top mult).
    """
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
    rows.sort(key=lambda x: (x[1], x[0]))
    # de-dupe slug keeping best (lowest) rank
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


def build_board_lookup() -> tuple[dict[str, BoardEntry], dict[str, BoardEntry]]:
    """
    domain -> (tier slug, rank), normalized company name -> (tier slug, rank).
    """
    ranks_map = _tier_rank_map()
    domain_tier: dict[str, BoardEntry] = {}
    name_tier: dict[str, BoardEntry] = {}
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
    """Boost when we matched a company but could not load tier ordering."""
    try:
        v = float((os.environ.get("MENTORSHIP_BOARD_NO_TIERS_API_MULTIPLIER") or "1.08").strip() or "1.08")
        return max(1.0, min(2.0, v))
    except Exception:
        return 1.08


def resolve_mentor_board_tier(mentor_profile: dict | None) -> tuple[str, float, str]:
    """
    Returns (tier_label, multiplier, human_reason).
    tier_label is the admin tier slug or 'none'.
    """
    if not mentor_profile:
        return "none", 1.0, ""

    mult_map = _tier_slug_multipliers()
    domain_map, name_map = build_board_lookup()

    def _rank_note(r: int) -> str:
        return f"admin rank {r}" if r < 900 else "admin rank n/a"

    def _mult_for_slug(slug: str) -> tuple[float, str]:
        m = mult_map.get(slug)
        if m is not None:
            return m, f"ranked tier ×{m:.3f}"
        if mult_map:
            floor = min(mult_map.values())
            return floor, f"tier not in rank list; floor ×{floor:.3f}"
        fb = _fallback_match_mult()
        return fb, f"tiers list unavailable; flat ×{fb:.3f}"

    # 1) Email domain on profile — must match a company row's domain
    emails_raw = str(mentor_profile.get("email") or "")
    for part in emails_raw.split(","):
        dom = _domain_from_email(part.strip())
        if dom and dom in domain_map:
            slug, rank = domain_map[dom]
            m, detail = _mult_for_slug(slug)
            return (
                slug,
                m,
                f"Board partner ({slug}, {_rank_note(rank)}) — email @{dom}; {detail}",
            )

    # 2) Mentor company text — exact name match only (admin list)
    company = str(mentor_profile.get("mentorCompany") or "").strip().lower()
    if company:
        if company in name_map:
            slug, rank = name_map[company]
            m, detail = _mult_for_slug(slug)
            return (
                slug,
                m,
                f"Board partner ({slug}, {_rank_note(rank)}) — company name; {detail}",
            )
        token = re.sub(r"^https?://", "", company).split("/")[0].strip().lower()
        if "." in token and token in domain_map:
            slug, rank = domain_map[token]
            m, detail = _mult_for_slug(slug)
            return (
                slug,
                m,
                f"Board partner ({slug}, {_rank_note(rank)}) — company domain; {detail}",
            )

    return "none", 1.0, "Standard partner tier (no board boost from company directory)"


def clear_board_cache() -> None:
    """Test hook — clears company + tier HTTP caches."""
    _cached_company_fetch.cache_clear()
    _cached_tier_items.cache_clear()
