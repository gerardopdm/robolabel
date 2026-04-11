"""Template-matching strategy using OpenCV."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .base import DetectedObject, SearchParams, SimilarityFinder, SourceObject

_BoxTuple = tuple[float, float, float, float, int, float]


def _non_max_suppression(boxes: list[_BoxTuple], iou_threshold: float = 0.4) -> list[_BoxTuple]:
    """Greedy NMS over (x, y, w, h, label_class_id, score) tuples."""
    if not boxes:
        return []

    arr = np.array(boxes, dtype=np.float64)
    x1 = arr[:, 0]
    y1 = arr[:, 1]
    x2 = x1 + arr[:, 2]
    y2 = y1 + arr[:, 3]
    scores = arr[:, 5]
    areas = arr[:, 2] * arr[:, 3]

    order = scores.argsort()[::-1]
    keep: list[int] = []

    while order.size > 0:
        i = order[0]
        keep.append(int(i))

        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])

        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        union = areas[i] + areas[order[1:]] - inter
        iou = inter / np.maximum(union, 1e-6)

        inds = np.where(iou <= iou_threshold)[0]
        order = order[inds + 1]

    return [boxes[k] for k in keep]


def _center(x: float, y: float, w: float, h: float) -> tuple[float, float]:
    return x + w / 2, y + h / 2


class TemplateMatchingFinder(SimilarityFinder):
    """Multi-scale template matching with distance filtering and NMS."""

    MIN_CROP_PX = 10

    def find(
        self,
        source_image_path: Path,
        target_image_path: Path,
        objects: list[SourceObject],
        params: SearchParams | None = None,
    ) -> list[DetectedObject]:
        if params is None:
            params = SearchParams()

        source = cv2.imread(str(source_image_path))
        target = cv2.imread(str(target_image_path))
        if source is None or target is None:
            return []

        target_gray = cv2.cvtColor(target, cv2.COLOR_BGR2GRAY)
        th, tw = target_gray.shape[:2]

        all_kept: list[DetectedObject] = []

        for obj in objects:
            x, y, w, h = int(obj.x), int(obj.y), int(obj.width), int(obj.height)
            if w < self.MIN_CROP_PX or h < self.MIN_CROP_PX:
                continue

            crop = source[y : y + h, x : x + w]
            if crop.size == 0:
                continue
            crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

            src_cx, src_cy = _center(obj.x, obj.y, obj.width, obj.height)
            raw_boxes: list[_BoxTuple] = []

            for scale in params.scales:
                sw = max(self.MIN_CROP_PX, int(w * scale))
                sh = max(self.MIN_CROP_PX, int(h * scale))
                if sw >= tw or sh >= th:
                    continue

                resized = cv2.resize(crop_gray, (sw, sh), interpolation=cv2.INTER_AREA)
                result = cv2.matchTemplate(target_gray, resized, cv2.TM_CCOEFF_NORMED)

                locs = np.where(result >= params.confidence_threshold)
                for py, px in zip(*locs):
                    det_cx, det_cy = _center(float(px), float(py), float(sw), float(sh))

                    if params.max_distance_px is not None:
                        dist = ((det_cx - src_cx) ** 2 + (det_cy - src_cy) ** 2) ** 0.5
                        if dist > params.max_distance_px:
                            continue

                    score = float(result[py, px])
                    raw_boxes.append((float(px), float(py), float(sw), float(sh), obj.label_class_id, score))

            kept = _non_max_suppression(raw_boxes, iou_threshold=params.nms_iou_threshold)

            if params.max_detections_per_object and len(kept) > params.max_detections_per_object:
                kept.sort(key=lambda b: b[5], reverse=True)
                kept = kept[: params.max_detections_per_object]

            all_kept.extend(
                DetectedObject(
                    label_class_id=int(b[4]),
                    x=round(b[0], 4),
                    y=round(b[1], 4),
                    width=round(b[2], 4),
                    height=round(b[3], 4),
                    confidence=round(b[5], 4),
                )
                for b in kept
            )

        return all_kept
