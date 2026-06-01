"""
Provider-agnostic embedding scaffold for mentorship matching.

Default provider/model:
- provider: openai
- model: text-embedding-3-large
"""

from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass
from typing import Protocol


class EmbeddingProvider(Protocol):
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        ...

    def metadata(self) -> dict:
        ...


@dataclass
class OpenAIEmbeddingProvider:
    api_key: str
    model: str = "text-embedding-3-large"
    endpoint: str = "https://api.openai.com/v1/embeddings"
    timeout_seconds: int = 30

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        payload = {"model": self.model, "input": texts}
        req = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        rows = body.get("data") or []
        rows.sort(key=lambda r: int(r.get("index", 0)))
        return [list(map(float, r.get("embedding") or [])) for r in rows]

    def metadata(self) -> dict:
        return {"provider": "openai", "model": self.model}


def get_embedding_provider() -> EmbeddingProvider:
    provider = (os.environ.get("MENTORSHIP_EMBEDDINGS_PROVIDER") or "openai").strip().lower()
    if provider == "openai":
        api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for openai embeddings provider")
        model = (os.environ.get("OPENAI_EMBEDDING_MODEL") or "text-embedding-3-large").strip()
        return OpenAIEmbeddingProvider(api_key=api_key, model=model)
    raise RuntimeError(f"Unsupported embeddings provider: {provider}")

