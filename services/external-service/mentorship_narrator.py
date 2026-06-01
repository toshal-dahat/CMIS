"""LLM narration helpers for mentorship using Bedrock Nova Lite."""

# Overview:
# These helpers call an LLM to write friendly text (reason summaries,
# icebreakers, skill-gap hints). If model calls fail, the code falls back
# to deterministic text so matching still works.

from __future__ import annotations

import json
import os
from typing import Any
import logging

import boto3
from botocore.exceptions import BotoCoreError, ClientError


logger = logging.getLogger(__name__)


def _invoke(prompt: str, max_tokens: int = 200, temperature: float = 0.3) -> str:
    """Call Bedrock chat completion (Nova Lite by default); raises on transport/parse errors for callers to catch."""
    client = boto3.client("bedrock-runtime")
    model_id = (os.environ.get("BEDROCK_LLM_MODEL") or "amazon.nova-lite-v1:0").strip()
    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "inferenceConfig": {
            "maxTokens": int(max_tokens),
            "temperature": float(temperature),
            "topP": 0.9,
        },
    }
    try:
        resp = client.invoke_model(
            modelId=model_id,
            body=json.dumps(payload).encode("utf-8"),
            contentType="application/json",
            accept="application/json",
        )
        body = json.loads(resp["body"].read().decode("utf-8"))
        return str(body["output"]["message"]["content"][0]["text"]).strip()
    except (ClientError, BotoCoreError) as e:
        logger.exception("Bedrock invoke failed")
        raise RuntimeError(f"Bedrock invoke failed: {e}") from e
    except Exception as e:
        logger.exception("Narrator parse failed")
        raise RuntimeError(f"Narrator parse failed: {e}") from e


def generate_match_reason(
    mentor_canonical: str,
    mentee_canonical: str,
    matched_signals: list[str],
    semantic_score: float,
    rule_score: float,
) -> str:
    signals = "; ".join(matched_signals[:6]) if matched_signals else "(none)"
    prompt = (
        "Write exactly 2 concise sentences explaining why this is a strong mentor/mentee match.\n"
        f"Matched signals: {signals}\n"
        f"Semantic score: {semantic_score:.3f}\n"
        f"Rule score: {rule_score:.3f}\n"
        f"Mentor profile:\n{mentor_canonical[:3500]}\n\n"
        f"Mentee profile:\n{mentee_canonical[:3500]}\n"
    )
    try:
        text = _invoke(prompt, max_tokens=120, temperature=0.4)
        return text if text else _fallback_reason(semantic_score, rule_score)
    except Exception:
        return _fallback_reason(semantic_score, rule_score)


def _fallback_reason(semantic_score: float, rule_score: float) -> str:
    return f"Strong profile overlap supported by semantic score {semantic_score:.2f} and rule score {rule_score:.2f}."


def generate_icebreaker(
    mentor_name: str,
    mentee_name: str,
    mentor_canonical: str,
    mentee_canonical: str,
) -> str:
    prompt = (
        "Write a 3-sentence opening note from mentor to mentee.\n"
        "It must reference at least one specific overlap and end with an open-ended question.\n"
        f"Mentor name: {mentor_name}\n"
        f"Mentee name: {mentee_name}\n"
        f"Mentor profile:\n{mentor_canonical[:2800]}\n\n"
        f"Mentee profile:\n{mentee_canonical[:2800]}\n"
    )
    try:
        text = _invoke(prompt, max_tokens=180, temperature=0.55)
        if text:
            return text
    except Exception:
        pass
    return (
        f"Hi {mentee_name}, I am excited to connect and support your goals through CMIS mentorship. "
        "I noticed overlap in your interests and my background, and I would love to help you plan your next steps. "
        "What area do you want to focus on first?"
    )


def generate_skill_gap_analysis(
    mentor_canonical: str,
    mentee_canonical: str,
    matched_signals: list[str],
) -> list[dict[str, str]]:
    signals = "; ".join(matched_signals[:6]) if matched_signals else ""
    prompt = (
        "Return exactly 3 skills as JSON array with format "
        '[{"skill":"...","rationale":"..."}].\n'
        f"Signals: {signals}\n"
        f"Mentor:\n{mentor_canonical[:2500]}\n\nMentee:\n{mentee_canonical[:2500]}\n"
    )
    try:
        raw = _invoke(prompt, max_tokens=220, temperature=0.3)
        cleaned = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
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
        return out[:3]
    except Exception:
        return []


def generate_match_insights_bundle(
    mentor_name: str,
    mentee_name: str,
    mentor_canonical: str,
    mentee_canonical: str,
    matched_signals: list[str],
    semantic_score: float,
    rule_score: float,
) -> dict[str, Any]:
    reason = generate_match_reason(
        mentor_canonical, mentee_canonical, matched_signals, semantic_score, rule_score
    )
    ice = generate_icebreaker(mentor_name, mentee_name, mentor_canonical, mentee_canonical)
    gaps = generate_skill_gap_analysis(mentor_canonical, mentee_canonical, matched_signals)
    return {
        "reasonSummary": reason,
        "suggestedIcebreaker": ice,
        "skillGapOpportunities": gaps,
    }
