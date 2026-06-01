"""
Mentorship embeddings: Amazon Bedrock (default) or OpenAI.

Default: Bedrock Titan Text Embeddings v2 (amazon.titan-embed-text-v2:0).
Optional: Bedrock Cohere English v3, or OpenAI (legacy).

Env:
- MENTORSHIP_EMBEDDINGS_PROVIDER: bedrock-titan | bedrock-cohere | openai
- BEDROCK_EMBEDDING_MODEL (Titan default amazon.titan-embed-text-v2:0)
- BEDROCK_EMBEDDING_DIMENSIONS (256 | 512 | 1024, default 1024)
- OPENAI_API_KEY / OPENAI_EMBEDDING_MODEL when provider=openai
"""

from __future__ import annotations

import json
import math
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

import boto3
from botocore.exceptions import BotoCoreError, ClientError

_MAX_CHARS_PER_INPUT = 26000
_DEFAULT_EMBED_BATCH = 16
_DEFAULT_TITAN_MODEL = "amazon.titan-embed-text-v2:0"
_DEFAULT_COHERE_MODEL = "cohere.embed-english-v3"


class EmbeddingProvider(Protocol):
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        ...

    def metadata(self) -> dict:
        ...


def _clip_for_embedding(text: str) -> str:
    t = text or ""
    if len(t) <= _MAX_CHARS_PER_INPUT:
        return t
    return t[: _MAX_CHARS_PER_INPUT - 16] + "\n[truncated]"


def _aws_region() -> str:
    return (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1").strip()


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Cosine similarity in [0,1]-style magnitude; safe for zero vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    n1 = math.sqrt(sum(a * a for a in v1))
    n2 = math.sqrt(sum(b * b for b in v2))
    if n1 == 0 or n2 == 0:
        return 0.0
    return dot / (n1 * n2)


def _titan_dimensions() -> int:
    raw = (os.environ.get("BEDROCK_EMBEDDING_DIMENSIONS") or "1024").strip()
    try:
        d = int(raw)
        return d if d in (256, 512, 1024) else 1024
    except ValueError:
        return 1024


@dataclass
class BedrockTitanEmbeddingProvider:
    """Amazon Titan Text Embeddings v2 via bedrock-runtime invoke_model."""

    model_id: str
    region: str
    dimensions: int
    normalize: bool = True

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
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
class BedrockCohereEmbeddingProvider:
    """Cohere Embed English v3 on Bedrock (batch-friendly)."""

    model_id: str
    region: str

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        client = boto3.client("bedrock-runtime", region_name=self.region)
        clipped = [_clip_for_embedding(t) for t in texts]
        body = json.dumps(
            {
                "texts": clipped,
                "input_type": "search_document",
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
        rows = payload.get("embeddings") or payload.get("embedding")
        if not isinstance(rows, list):
            raise RuntimeError("Bedrock Cohere response missing embeddings")
        return [list(map(float, row)) for row in rows]

    def metadata(self) -> dict:
        return {"provider": "bedrock-cohere", "model": self.model_id}


@dataclass
class OpenAIEmbeddingProvider:
    api_key: str
    model: str = "text-embedding-3-large"
    endpoint: str = "https://api.openai.com/v1/embeddings"
    timeout_seconds: int = 30

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        clipped = [_clip_for_embedding(t) for t in texts]
        payload = {"model": self.model, "input": clipped}
        req = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:1400]
            raise RuntimeError(f"OpenAI embeddings HTTP {e.code}: {err_body}") from e
        except urllib.error.URLError as e:
            raise RuntimeError(f"OpenAI embeddings network error: {e}") from e
        rows = body.get("data") or []
        rows.sort(key=lambda r: int(r.get("index", 0)))
        return [list(map(float, r.get("embedding") or [])) for r in rows]

    def metadata(self) -> dict:
        return {"provider": "openai", "model": self.model}


def get_embedding_provider() -> EmbeddingProvider:
    provider = (os.environ.get("MENTORSHIP_EMBEDDINGS_PROVIDER") or "bedrock-titan").strip().lower()
    region = _aws_region()

    if provider in ("bedrock-titan", "bedrock_titan", "titan"):
        model = (os.environ.get("BEDROCK_EMBEDDING_MODEL") or _DEFAULT_TITAN_MODEL).strip()
        return BedrockTitanEmbeddingProvider(
            model_id=model,
            region=region,
            dimensions=_titan_dimensions(),
            normalize=True,
        )

    if provider in ("bedrock-cohere", "bedrock_cohere", "cohere"):
        model = (os.environ.get("BEDROCK_EMBEDDING_MODEL") or _DEFAULT_COHERE_MODEL).strip()
        return BedrockCohereEmbeddingProvider(model_id=model, region=region)

    if provider == "openai":
        api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required when MENTORSHIP_EMBEDDINGS_PROVIDER=openai")
        model = (os.environ.get("OPENAI_EMBEDDING_MODEL") or "text-embedding-3-large").strip()
        return OpenAIEmbeddingProvider(api_key=api_key, model=model)

    raise RuntimeError(f"Unsupported embeddings provider: {provider}")


def embedding_config_info() -> dict[str, Any]:
    """
    Probe embedding provider once and return diagnostics (for GET /mentorship/embedding-config).
    """
    meta: dict[str, Any] = {}
    try:
        provider = get_embedding_provider()
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
    raw = (os.environ.get("MENTORSHIP_EMBED_BATCH_SIZE") or str(_DEFAULT_EMBED_BATCH)).strip()
    try:
        n = int(raw)
        return max(1, min(64, n))
    except Exception:
        return _DEFAULT_EMBED_BATCH


def embed_texts_in_chunks(provider: EmbeddingProvider, texts: list[str]) -> list[list[float]]:
    """Embed in batches; Bedrock Titan uses single-text invokes internally — batching reduces payload size."""
    if not texts:
        return []
    size = embed_batch_size()
    out: list[list[float]] = []
    for i in range(0, len(texts), size):
        out.extend(provider.embed_texts(texts[i : i + size]))
    return out
