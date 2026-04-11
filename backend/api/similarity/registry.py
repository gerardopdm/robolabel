"""Strategy registry — returns the active SimilarityFinder based on settings."""

from __future__ import annotations

from django.conf import settings

from .base import SimilarityFinder

_ENGINES: dict[str, str] = {
    "template_matching": "api.similarity.template_matching.TemplateMatchingFinder",
    # "embedding":      "api.similarity.embedding.EmbeddingFinder",
    # "llm_vision":     "api.similarity.llm_vision.LLMVisionFinder",
}

_cache: dict[str, SimilarityFinder] = {}


def get_finder() -> SimilarityFinder:
    """Instantiate (and cache) the engine selected via ``SIMILARITY_ENGINE``."""
    engine_name: str = getattr(settings, "SIMILARITY_ENGINE", "template_matching")

    if engine_name in _cache:
        return _cache[engine_name]

    dotted_path = _ENGINES.get(engine_name)
    if not dotted_path:
        raise ValueError(
            f"Unknown similarity engine '{engine_name}'. "
            f"Available: {', '.join(_ENGINES)}"
        )

    module_path, cls_name = dotted_path.rsplit(".", 1)
    import importlib

    module = importlib.import_module(module_path)
    cls = getattr(module, cls_name)
    instance = cls()
    _cache[engine_name] = instance
    return instance
