"""Abstract base for image detection filters."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np


@dataclass(frozen=True)
class FilterDetection:
    """A bounding box found by a filter (coordinates normalised 0-1)."""

    x: float
    y: float
    width: float
    height: float
    confidence: float = 1.0
    class_name: str = ""


@dataclass
class DebugStep:
    """One intermediate image produced during filtering."""

    label: str
    image: np.ndarray  # BGR or grayscale


@dataclass
class FilterResult:
    """Full output including detections and optional debug steps."""

    detections: list[FilterDetection] = field(default_factory=list)
    debug_steps: list[DebugStep] = field(default_factory=list)


@dataclass(frozen=True)
class FilterParamSpec:
    """Metadata that lets the frontend render a control automatically.

    ``param_type`` values:
    - ``"int"``   / ``"float"`` → slider (uses *min_val*, *max_val*, *step*).
    - ``"select"`` → dropdown (uses *options*: list of ``{"value": …, "label": …}``).
    - ``"bool"``   → checkbox (*default* should be 0 or 1).
    """

    key: str
    label: str
    help: str
    param_type: str  # "int" | "float" | "select" | "bool"
    default: Any
    min_val: float = 0
    max_val: float = 0
    step: float = 0
    unit: str = ""
    options: tuple[dict[str, str], ...] | None = None


class ImageFilter(abc.ABC):
    """Every detection filter must implement this interface."""

    @property
    @abc.abstractmethod
    def name(self) -> str:
        """Unique machine-readable identifier (e.g. ``tile_detection``)."""

    @property
    @abc.abstractmethod
    def display_name(self) -> str:
        """Human-readable name shown in the UI."""

    @property
    @abc.abstractmethod
    def param_specs(self) -> list[FilterParamSpec]:
        """Ordered list of tuneable parameters."""

    @abc.abstractmethod
    def apply(
        self,
        image_path: Path,
        params: dict,
    ) -> list[FilterDetection]:
        """Run the filter on *image_path* and return normalised bounding boxes.

        ``params`` keys match the ``key`` fields of :pyattr:`param_specs`.
        """

    def apply_with_debug(
        self,
        image_path: Path,
        params: dict,
    ) -> FilterResult:
        """Run the filter and return detections **plus** debug visualisations.

        The default implementation just wraps :meth:`apply` with no debug steps.
        Subclasses should override this to provide intermediate images.
        """
        return FilterResult(detections=self.apply(image_path, params))

    # ------------------------------------------------------------------
    def default_params(self) -> dict:
        """Return a dict with every param set to its default value."""
        return {s.key: s.default for s in self.param_specs}

    def coerce_params(self, raw: dict) -> dict:
        """Merge *raw* with defaults and clamp values to valid ranges."""
        out: dict = {}
        for spec in self.param_specs:
            val = raw.get(spec.key, spec.default)
            if spec.param_type == "select":
                out[spec.key] = str(val) if val is not None else str(spec.default)
            elif spec.param_type == "bool":
                if isinstance(val, bool):
                    out[spec.key] = int(val)
                else:
                    out[spec.key] = int(bool(int(val))) if val not in (None, "") else int(bool(spec.default))
            elif spec.param_type == "int":
                val = int(round(float(val)))
                val = max(int(spec.min_val), min(int(spec.max_val), val))
                out[spec.key] = val
            else:
                val = float(val)
                val = max(spec.min_val, min(spec.max_val, val))
                out[spec.key] = val
        return out

    def to_dict(self) -> dict:
        specs_list: list[dict] = []
        for s in self.param_specs:
            d: dict[str, Any] = {
                "key": s.key,
                "label": s.label,
                "help": s.help,
                "param_type": s.param_type,
                "default": s.default,
            }
            if s.param_type in ("int", "float"):
                d.update(min_val=s.min_val, max_val=s.max_val, step=s.step, unit=s.unit)
            if s.options is not None:
                d["options"] = list(s.options)
            specs_list.append(d)
        return {
            "name": self.name,
            "display_name": self.display_name,
            "param_specs": specs_list,
        }
