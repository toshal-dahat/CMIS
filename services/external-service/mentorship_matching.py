"""
Mentorship matching helpers:
- canonical text serialization for embeddings
- cosine similarity scoring

This module does not perform storage/query orchestration yet.
"""

from __future__ import annotations

import math


def _line(label: str, value: str) -> str:
    v = (value or "").strip()
    return f"{label}: {v}" if v else ""


def _csv(values: list[str] | None) -> str:
    vals = [str(v).strip() for v in (values or []) if str(v).strip()]
    return ", ".join(vals)


def mentor_profile_to_text(profile: dict) -> str:
    lines = [
        _line("Role", "mentor"),
        _line("Skills", _csv(profile.get("mentorSkills"))),
        _line("Industries", _csv(profile.get("mentorIndustries"))),
        _line("Company", str(profile.get("mentorCompany") or "")),
        _line("Job title", str(profile.get("mentorJobTitle") or "")),
        _line("Years experience", str(profile.get("mentorYearsExperience") or "")),
        _line("Degree", str(profile.get("degree") or "")),
        _line("Major", str(profile.get("major") or "")),
        _line("Profile skills", _csv(profile.get("profileSkillKeys"))),
        _line("LinkedIn URL", str(profile.get("linkedInUrl") or "")),
    ]
    return "\n".join([l for l in lines if l])


def mentee_profile_to_text(profile: dict) -> str:
    lines = [
        _line("Role", "mentee"),
        _line("Degree", str(profile.get("degree") or "")),
        _line("Major", str(profile.get("major") or "")),
        _line("Grad date", str(profile.get("gradDate") or "")),
        _line("GPA", str(profile.get("profileGpa") or "")),
        _line("Skills", _csv(profile.get("profileSkillKeys"))),
        _line("Education", _csv([str(e) for e in (profile.get("profileEducation") or [])])),
    ]
    return "\n".join([l for l in lines if l])


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    n1 = math.sqrt(sum(a * a for a in v1))
    n2 = math.sqrt(sum(b * b for b in v2))
    if n1 == 0 or n2 == 0:
        return 0.0
    return dot / (n1 * n2)

