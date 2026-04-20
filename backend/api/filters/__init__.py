"""Image detection filters for RoboLabel.

Each filter is an :class:`~.base.ImageFilter` subclass registered in
:mod:`~.registry`.  The frontend fetches available filters (with their
param specs) from ``GET /api/v1/filters/`` and renders configuration
UIs dynamically.
"""

from .base import DebugStep, FilterDetection, FilterParamSpec, FilterResult, ImageFilter  # noqa: F401
from .registry import get_available_filters, get_filter  # noqa: F401
