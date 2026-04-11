"""Similarity-search package — strategy-based object finder.

Swap the active strategy via Django settings:

    SIMILARITY_ENGINE = "template_matching"   # default
    SIMILARITY_ENGINE = "embedding"           # future: DINOv2 / CLIP
    SIMILARITY_ENGINE = "llm_vision"          # future: GPT-4o / Gemini
"""

from .base import SimilarityFinder
from .registry import get_finder

__all__ = ["SimilarityFinder", "get_finder"]
