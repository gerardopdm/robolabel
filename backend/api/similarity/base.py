"""Abstract base for similarity-search strategies."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class SourceObject:
    """A cropped region from the source (previous) image."""

    label_class_id: int
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class DetectedObject:
    """A candidate bounding box found in the target image."""

    label_class_id: int
    x: float
    y: float
    width: float
    height: float
    confidence: float


@dataclass(frozen=True)
class SearchParams:
    """Tunable parameters that every engine should honour where applicable."""

    confidence_threshold: float = 0.55
    max_distance_px: float | None = None
    scale_min: float = 0.7
    scale_max: float = 1.35
    scale_steps: int = 7
    nms_iou_threshold: float = 0.4
    max_detections_per_object: int = 5

    @property
    def scales(self) -> list[float]:
        if self.scale_steps <= 1:
            return [1.0]
        step = (self.scale_max - self.scale_min) / (self.scale_steps - 1)
        return [round(self.scale_min + i * step, 4) for i in range(self.scale_steps)]


class SimilarityFinder(abc.ABC):
    """Base class every similarity engine must implement."""

    @abc.abstractmethod
    def find(
        self,
        source_image_path: Path,
        target_image_path: Path,
        objects: list[SourceObject],
        params: SearchParams | None = None,
    ) -> list[DetectedObject]:
        """Return candidate boxes in *target* that resemble *objects* from *source*.

        Parameters
        ----------
        source_image_path:
            Absolute path to the image the objects come from.
        target_image_path:
            Absolute path to the image where we search.
        objects:
            List of annotated regions in the source image.
        params:
            Tunable search parameters. Use defaults when ``None``.
        """
