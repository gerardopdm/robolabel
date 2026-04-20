"""Filter registry — discovers and caches available ImageFilter implementations."""

from __future__ import annotations

from .base import ImageFilter

_REGISTRY: dict[str, ImageFilter] = {}


def _ensure_loaded() -> None:
    if _REGISTRY:
        return
    from .tile_detection import TileDetectionFilter
    from .yolo_detection import YoloDetectionFilter

    for cls in (TileDetectionFilter, YoloDetectionFilter):
        inst = cls()
        _REGISTRY[inst.name] = inst


def get_available_filters() -> dict[str, ImageFilter]:
    _ensure_loaded()
    return dict(_REGISTRY)


def get_filter(name: str) -> ImageFilter:
    _ensure_loaded()
    filt = _REGISTRY.get(name)
    if filt is None:
        available = ", ".join(_REGISTRY) or "(ninguno)"
        raise ValueError(f"Filtro '{name}' no registrado. Disponibles: {available}")
    return filt
