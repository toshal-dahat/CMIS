"""Embedding utilities used by mentorship matching.

Plain-language summary:
- We turn profile text into numeric vectors (lists of numbers).
- Those vectors let us compute "how similar" two profiles are.
- This file only handles embedding + similarity plumbing; it does not decide
  who gets matched (that happens in `mentorship_service.py`).

Provider options:
- `bedrock-titan` (default)
- `bedrock-cohere`
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from typing import Any, Protocol

import boto3
from botocore.exceptions import BotoCoreError, ClientError

MAX_INPUT_CHARS = 8000
_DEFAULT_EMBED_BATCH = 16
_DEFAULT_TITAN_MODEL = "amazon.titan-embed-text-v2:0"
_DEFAULT_COHERE_MODEL = "cohere.embed-english-v3"


class EmbeddingProvider(Protocol):
    """Small interface so the rest of the code can swap providers easily."""

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        ...

    def metadata(self) -> dict:
        ...


def _clip_for_embedding(text: str) -> str:
    """Keep input text under provider size limits to avoid API errors."""
    t = text or ""
    if len(t) <= MAX_INPUT_CHARS:
        return t
    return t[:MAX_INPUT_CHARS]


def _aws_region() -> str:
    """Resolve AWS region with safe fallbacks for local/dev usage."""
    return (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1").strip()


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Return cosine similarity between two vectors.

    Plain-English meaning:
    - `1.0` = very similar direction
    - `0.0` = not similar (or invalid/empty vectors)
    """
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    n1 = math.sqrt(sum(a * a for a in v1))
    n2 = math.sqrt(sum(b * b for b in v2))
    if n1 == 0 or n2 == 0:
        return 0.0
    return dot / (n1 * n2)


def _titan_dimensions() -> int:
    """Read Titan output size from env; allow only supported dimensions."""
    raw = (os.environ.get("BEDROCK_EMBEDDING_DIMENSIONS") or "1024").strip()
    try:
        d = int(raw)
        return d if d in (256, 512, 1024) else 1024
    except ValueError:
        return 1024


@dataclass
class BedrockTitanProvider:
    """Amazon Titan Text Embeddings v2 provider wrapper."""

    model_id: str
    region: str
    dimensions: int
    normalize: bool = True

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed each text and return one vector per text.

        Titan v2 is called once per text here, so callers typically batch large
        workloads via `embed_texts_in_chunks`.
        """
        if not texts:
            return []
        client = boto3.client("bedrock-runtime", region_name=self.region)
        out: list[list[float]] = []
        for t in texts:
            clipped = _clip_for_embedding(t)
            body = json.dumps(
                {
                    "inputText": clipped,
                    "dimensions": self.dimensions,
                    "normalize": self.normalize,
                }
            )
            try:
                resp = client.invoke_model(
                    modelId=self.model_id,
                    body=body.encode("utf-8"),
                    contentType="application/json",
                    accept="application/json",
                )
                payload = json.loads(resp["body"].read().decode("utf-8"))
            except (ClientError, BotoCoreError, json.JSONDecodeError, KeyError, TypeError) as e:
                raise RuntimeError(f"Bedrock Titan embedding failed: {e}") from e
            emb = payload.get("embedding")
            if not isinstance(emb, list):
                raise RuntimeError("Bedrock Titan response missing embedding array")
            out.append([float(x) for x in emb])
        return out

    def metadata(self) -> dict:
        return {
            "provider": "bedrock-titan",
            "model": self.model_id,
            "dimensions": self.dimensions,
            "normalize": self.normalize,
        }


@dataclass
class BedrockCohereProvider:
    """Cohere Embed English v3 on Bedrock (supports bigger batch calls)."""

    model_id: str
    region: str

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed texts in up to 32-item provider batches."""
        if not texts:
            return []
        client = boto3.client("bedrock-runtime", region_name=self.region)
        out: list[list[float]] = []
        for i in range(0, len(texts), 32):
            clipped = [_clip_for_embedding(t) for t in texts[i : i + 32]]
            body = json.dumps(
                {
                    "texts": clipped,
                    "input_type": "search_document",
                    "truncate": "END",
                }
            )
            try:
                resp = client.invoke_model(
                    modelId=self.model_id,
                    body=body.encode("utf-8"),
                    contentType="application/json",
                    accept="application/json",
                )
                payload = json.loads(resp["body"].read().decode("utf-8"))
            except (ClientError, BotoCoreError, json.JSONDecodeError, KeyError, TypeError) as e:
                raise RuntimeError(f"Bedrock Cohere embedding failed: {e}") from e
            rows = payload.get("embeddings")
            if not isinstance(rows, list):
                raise RuntimeError("Bedrock Cohere response missing embeddings")
            out.extend([list(map(float, row)) for row in rows])
        return out

    def metadata(self) -> dict:
        return {"provider": "bedrock-cohere", "model": self.model_id}


def get_provider() -> EmbeddingProvider:
    """Build the active embedding provider from environment config."""
    provider = (os.environ.get("MENTORSHIP_EMBEDDINGS_PROVIDER") or "bedrock-titan").strip().lower()
    region = _aws_region()

    if provider in ("bedrock-cohere", "bedrock_cohere", "cohere"):
        return BedrockCohereProvider(model_id=_DEFAULT_COHERE_MODEL, region=region)

    if provider in ("bedrock-titan", "bedrock_titan", "titan"):
        model = (os.environ.get("BEDROCK_EMBEDDING_MODEL") or _DEFAULT_TITAN_MODEL).strip()
        return BedrockTitanProvider(
            model_id=model,
            region=region,
            dimensions=_titan_dimensions(),
            normalize=True,
        )

    return BedrockTitanProvider(
        model_id=_DEFAULT_TITAN_MODEL,
        region=region,
        dimensions=_titan_dimensions(),
        normalize=True,
    )


def get_embedding_provider() -> EmbeddingProvider:
    """Compatibility wrapper used by service code."""
    return get_provider()


def embedding_config_info() -> dict[str, Any]:
    """
    Probe the active provider and return health/metadata diagnostics.

    This is used by `GET /mentorship/embedding-config` so admins can quickly
    verify model access and vector dimensions.
    """
    meta: dict[str, Any] = {}
    try:
        provider = get_provider()
        meta = provider.metadata()
        vec = provider.embed_texts(["__cmis_mentorship_probe__"])[0]
        probe_dimensions = len(vec) if vec else 0
        return {"status": "ok", "meta": meta, "probe_dimensions": probe_dimensions}
    except Exception as e:
        return {
            "status": "error",
            "meta": meta,
            "probe_dimensions": 0,
            "error": str(e),
        }


def embed_batch_size() -> int:
    """Read and clamp batch size env var to a safe range (1..64)."""
    raw = (os.environ.get("MENTORSHIP_EMBED_BATCH_SIZE") or str(_DEFAULT_EMBED_BATCH)).strip()
    try:
        n = int(raw)
        return max(1, min(64, n))
    except Exception:
        return _DEFAULT_EMBED_BATCH


def embed_texts_in_chunks(provider: EmbeddingProvider, texts: list[str]) -> list[list[float]]:
    """Embed many texts by splitting into manageable chunks.

    Why this exists:
    - Keeps request sizes predictable.
    - Prevents huge one-shot payloads.
    - Gives one simple path that works for both Titan and Cohere providers.
    """
    if not texts:
        return []
    size = embed_batch_size()
    out: list[list[float]] = []
    for i in range(0, len(texts), size):
        out.extend(provider.embed_texts(texts[i : i + size]))
    return out
