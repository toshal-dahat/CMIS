"""
Mentorship matching helpers:
- canonical text serialization for embeddings
- cosine similarity scoring
- rule-based compatibility scoring and explainability signals
"""

# Overview:
# This file turns profile data into two things:
# 1) machine-friendly scores
# 2) human-friendly reasons explaining those scores.

from __future__ import annotations

import math
from dataclasses import dataclass


def _line(label: str, value: str) -> str:
    v = (value or "").strip()
    return f"{label}: {v}" if v else ""


def _csv(values: list[str] | None) -> str:
    vals = [str(v).strip() for v in (values or []) if str(v).strip()]
    return ", ".join(vals)


def _norm_set(values: list[str] | None) -> set[str]:
    return {str(v).strip().lower() for v in (values or []) if str(v).strip()}


def _merge_string_lists(*lists: list[str] | None) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for values in lists:
        for v in values or []:
            s = str(v).strip()
            k = s.lower()
            if s and k not in seen:
                seen.add(k)
                merged.append(s)
    return merged


def extracted_data_to_text(extracted: dict | None) -> str:
    """Flatten resume OCR/parse JSON into labeled lines for embeddings and LLM prompts."""
    data = extracted or {}
    skills = _csv([str(s) for s in (data.get("skills") or [])])
    education = _csv([str(e) for e in (data.get("education") or [])])
    experience = _csv([str(e) for e in (data.get("experience") or [])])
    projects = _csv([str(p) for p in (data.get("projects") or [])])
    achievements = _csv([str(a) for a in (data.get("achievements") or [])])
    summary = str(data.get("summary") or data.get("objective") or data.get("professionalSummary") or "").strip()
    lines = [
        _line("Resume summary", summary),
        _line("Resume skills", skills),
        _line("Resume GPA", str(data.get("gpa") or "")),
        _line("Resume location", str(data.get("location") or "")),
        _line("Resume education", education),
        _line("Resume experience", experience),
        _line("Resume projects", projects),
        _line("Resume achievements", achievements),
    ]
    return "\n".join([l for l in lines if l])


def mentor_profile_to_text(profile: dict) -> str:
    """Stable text block for a mentor: demographics, skills, resume-derived lines (embedding + narration input)."""
    extracted = profile.get("resumeExtractedData") if isinstance(profile, dict) else None
    profile_skills = [str(s) for s in (profile.get("profileSkillKeys") or [])]
    mentor_skills = [str(s) for s in (profile.get("mentorSkills") or [])]
    resume_skills = [str(s) for s in ((extracted or {}).get("skills") or [])] if isinstance(extracted, dict) else []
    merged_skills = _merge_string_lists(mentor_skills, profile_skills, resume_skills)
    lines = [
        _line("Name", str(profile.get("name") or "")),
        _line("Role", "mentor"),
        _line("Skills", _csv(merged_skills)),
        _line("Industries", _csv(profile.get("mentorIndustries"))),
        _line("Company", str(profile.get("mentorCompany") or "")),
        _line("Job title", str(profile.get("mentorJobTitle") or "")),
        _line("Years experience", str(profile.get("mentorYearsExperience") or "")),
        _line("Degree", str(profile.get("degree") or "")),
        _line("Major", str(profile.get("major") or "")),
        _line("Profile skills", _csv(profile_skills)),
        _line("LinkedIn URL", str(profile.get("linkedInUrl") or "")),
        extracted_data_to_text(extracted),
    ]
    return "\n".join([l for l in lines if l])


def mentee_profile_to_text(profile: dict) -> str:
    """Stable text block for a mentee: goals, academics, skills, resume-derived lines (embedding + narration input)."""
    extracted = profile.get("resumeExtractedData") if isinstance(profile, dict) else None
    profile_skills = [str(s) for s in (profile.get("profileSkillKeys") or [])]
    resume_skills = [str(s) for s in ((extracted or {}).get("skills") or [])] if isinstance(extracted, dict) else []
    merged_skills = _merge_string_lists(profile_skills, resume_skills)
    goals = str(profile.get("mentorshipGoals") or "").strip()
    lines = [
        _line("Name", str(profile.get("name") or "")),
        _line("Role", "mentee"),
        _line("Career goals", goals),
        _line("Degree", str(profile.get("degree") or "")),
        _line("Major", str(profile.get("major") or "")),
        _line("Grad date", str(profile.get("gradDate") or "")),
        _line("GPA", str(profile.get("profileGpa") or "")),
        _line("Skills", _csv(merged_skills)),
        _line("Education", _csv([str(e) for e in (profile.get("profileEducation") or [])])),
        extracted_data_to_text(extracted),
    ]
    return "\n".join([l for l in lines if l])


@dataclass
class RuleScoreResult:
    """Rule-based compatibility score and human-readable match signals."""

    score: float
    matched_signals: list[str]


def compute_rule_score(
    mentor_profile: dict,
    mentee_profile: dict,
    *,
    mentor_capacity_remaining: int | None = None,
) -> RuleScoreResult:
    """
    Skill overlap, industry/major alignment, mentor experience (≥3 years for bonus),
    and optional mentor capacity remaining (penalizes at 0 slots).
    """
    reasons: list[str] = []
    score = 0.0

    mentor_skills = _norm_set(
        _merge_string_lists(
            mentor_profile.get("mentorSkills") or [],
            mentor_profile.get("profileSkillKeys") or [],
            ((mentor_profile.get("resumeExtractedData") or {}).get("skills") or []),
        )
    )
    mentee_skills = _norm_set(
        _merge_string_lists(
            mentee_profile.get("profileSkillKeys") or [],
            ((mentee_profile.get("resumeExtractedData") or {}).get("skills") or []),
        )
    )
    if mentor_skills and mentee_skills:
        overlap = mentor_skills.intersection(mentee_skills)
        ratio = len(overlap) / max(len(mentee_skills), 1)
        skill_score = min(1.0, ratio * 1.5)
        score += 0.5 * skill_score
        if overlap:
            reasons.append(f"Shared skills: {', '.join(sorted(list(overlap))[:4])}")

    mentor_inds = _norm_set(mentor_profile.get("mentorIndustries") or [])
    mentee_exp_text = " ".join(str(x).lower() for x in ((mentee_profile.get("resumeExtractedData") or {}).get("experience") or []))
    if mentor_inds and mentee_exp_text:
        ind_overlap = [i for i in mentor_inds if i in mentee_exp_text]
        if ind_overlap:
            score += 0.2
            reasons.append(f"Industry alignment: {', '.join(ind_overlap[:3])}")

    mm = str(mentor_profile.get("major") or "").strip().lower()
    sm = str(mentee_profile.get("major") or "").strip().lower()
    if mm and sm and mm == sm:
        score += 0.15
        reasons.append("Same major background")

    mentor_years = mentor_profile.get("mentorYearsExperience")
    if isinstance(mentor_years, int):
        if mentor_years >= 3:
            exp_bonus = min(0.15, max(0.0, mentor_years / 40))
            score += exp_bonus
            reasons.append(f"Mentor experience: {mentor_years} years")
        else:
            reasons.append(f"Mentor logged {mentor_years} years experience (rule bonus requires ≥3 years)")

    if mentor_capacity_remaining is not None:
        if mentor_capacity_remaining <= 0:
            reasons.append("Mentor has no remaining capacity for new matches")
            score *= 0.25
        elif mentor_capacity_remaining == 1:
            reasons.append("Mentor capacity: 1 slot remaining")
            score *= 0.88
        elif mentor_capacity_remaining < 4:
            reasons.append(f"Mentor capacity: {mentor_capacity_remaining} slots remaining")

    return RuleScoreResult(score=min(1.0, score), matched_signals=reasons[:8])


def rule_scoring(mentor_profile: dict, mentee_profile: dict) -> tuple[float, list[str]]:
    """Backward-compatible wrapper (no capacity signal). Prefer compute_rule_score in new code."""
    r = compute_rule_score(mentor_profile, mentee_profile, mentor_capacity_remaining=None)
    return r.score, r.matched_signals


def rank_candidates(rows: list[dict]) -> list[dict]:
    """
    Sort by boostedScore descending and drop internal-only keys (prefix '_').
    """
    sorted_rows = sorted(rows, key=lambda r: float(r.get("boostedScore") or 0.0), reverse=True)
    out: list[dict] = []
    for r in sorted_rows:
        out.append({k: v for k, v in r.items() if not str(k).startswith("_")})
    return out


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    n1 = math.sqrt(sum(a * a for a in v1))
    n2 = math.sqrt(sum(b * b for b in v2))
    if n1 == 0 or n2 == 0:
        return 0.0
    return dot / (n1 * n2)

