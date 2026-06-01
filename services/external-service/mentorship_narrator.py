"""
LLM narration for mentorship using Amazon Bedrock (Nova Lite) Converse API.

Env:
- BEDROCK_LLM_MODEL (default amazon.nova-lite-v1:0)
- BEDROCK_LLM_MAX_TOKENS (default 1024)
- BEDROCK_LLM_TEMPERATURE (default 0.3)
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError


def _region() -> str:
    return (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1").strip()


def _llm_model_id() -> str:
    return (os.environ.get("BEDROCK_LLM_MODEL") or "amazon.nova-lite-v1:0").strip()


def _invoke_nova(user_prompt: str) -> str:
    """Call Bedrock Converse (Nova). Returns assistant text or empty string."""
    model_id = _llm_model_id()
    client = boto3.client("bedrock-runtime", region_name=_region())
    try:
        max_tokens = int((os.environ.get("BEDROCK_LLM_MAX_TOKENS") or "1024").strip())
    except ValueError:
        max_tokens = 1024
    try:
        temperature = float((os.environ.get("BEDROCK_LLM_TEMPERATURE") or "0.3").strip())
    except ValueError:
        temperature = 0.3

    try:
        resp = client.converse(
            modelId=model_id,
            messages=[
                {
                    "role": "user",
                    "content": [{"text": user_prompt}],
                }
            ],
            inferenceConfig={
                "maxTokens": max(64, min(4096, max_tokens)),
                "temperature": max(0.0, min(1.0, temperature)),
            },
        )
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"Bedrock Nova call failed: {e}") from e

    parts = (resp.get("output") or {}).get("message", {}).get("content") or []
    for p in parts:
        if isinstance(p, dict) and p.get("text"):
            return str(p["text"]).strip()
    return ""


def generate_match_reason(
    mentor_canonical: str,
    mentee_canonical: str,
    matched_signals: list[str],
    semantic_score: float,
    rule_score: float,
) -> str:
    signals = "; ".join(matched_signals[:8]) if matched_signals else "(none)"
    prompt = (
        "You are a concise career-matching assistant. In 2-4 sentences, explain why this mentor–mentee "
        "pair is a reasonable match for our university mentorship program. "
        "Do not invent employers or degrees not implied by the profiles.\n\n"
        f"Mentor profile text:\n{mentor_canonical[:6000]}\n\n"
        f"Mentee profile text:\n{mentee_canonical[:6000]}\n\n"
        f"Rule-based signals: {signals}\n"
        f"Semantic similarity (0-1): {semantic_score:.3f}; Rule score (0-1): {rule_score:.3f}\n"
    )
    try:
        text = _invoke_nova(prompt)
        return text if text else _fallback_reason(matched_signals, semantic_score, rule_score)
    except Exception:
        return _fallback_reason(matched_signals, semantic_score, rule_score)


def _fallback_reason(signals: list[str], semantic_score: float, rule_score: float) -> str:
    base = f"Fit scores — semantic {semantic_score:.2f}, rules {rule_score:.2f}."
    if signals:
        return base + " Highlights: " + "; ".join(signals[:4]) + "."
    return base


def generate_icebreaker(
    mentor_canonical: str,
    mentee_canonical: str,
    matched_signals: list[str],
) -> str:
    signals = "; ".join(matched_signals[:6]) if matched_signals else ""
    prompt = (
        "Write ONE short icebreaker message (max 60 words) the mentor can send the mentee after a match "
        "is confirmed. Friendly, professional, specific to shared context when possible. No placeholders.\n\n"
        f"Mentor:\n{mentor_canonical[:4000]}\n\nMentee:\n{mentee_canonical[:4000]}\n\nSignals: {signals}\n"
    )
    try:
        text = _invoke_nova(prompt)
        return text if text else "Hi — excited to work with you. Let me know what you are hoping to get from mentorship and we can pick a time to connect."
    except Exception:
        return "Hi — excited to work with you. Let me know what you are hoping to get from mentorship and we can pick a time to connect."


def _strip_json_fences(raw: str) -> str:
    s = (raw or "").strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


def generate_skill_gap_analysis(
    mentor_canonical: str,
    mentee_canonical: str,
    matched_signals: list[str],
) -> list[dict[str, str]]:
    signals = "; ".join(matched_signals[:6]) if matched_signals else ""
    prompt = (
        "Return ONLY a JSON array (no markdown) of 2-6 objects. Each object must have keys "
        "\"skill\" and \"rationale\" (strings). Describe skills the mentee could develop with this mentor.\n\n"
        f"Mentor:\n{mentor_canonical[:3500]}\n\nMentee:\n{mentee_canonical[:3500]}\n\nSignals: {signals}\n"
    )
    try:
        raw = _invoke_nova(prompt)
        cleaned = _strip_json_fences(raw)
        data = json.loads(cleaned)
        if not isinstance(data, list):
            return []
        out: list[dict[str, str]] = []
        for item in data:
            if isinstance(item, dict):
                sk = str(item.get("skill") or "").strip()
                ra = str(item.get("rationale") or "").strip()
                if sk and ra:
                    out.append({"skill": sk[:200], "rationale": ra[:500]})
        return out[:8]
    except Exception:
        return []


def generate_match_insights_bundle(
    mentor_canonical: str,
    mentee_canonical: str,
    matched_signals: list[str],
    semantic_score: float,
    rule_score: float,
) -> dict[str, Any]:
    reason = generate_match_reason(
        mentor_canonical, mentee_canonical, matched_signals, semantic_score, rule_score
    )
    ice = generate_icebreaker(mentor_canonical, mentee_canonical, matched_signals)
    gaps = generate_skill_gap_analysis(mentor_canonical, mentee_canonical, matched_signals)
    return {
        "reasonSummary": reason,
        "suggestedIcebreaker": ice,
        "skillGapOpportunities": gaps,
    }
