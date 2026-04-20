"""YOLOv8 detection filter — runs inference with a user-selected ``.pt`` model.

The filter discovers model files from the ``YOLO_MODELS_DIR`` setting (defaults
to ``<project_root>/models``).  Each model exposes its trained class names and
the user can optionally map them to project-specific label classes through a
JSON-encoded *class_map* parameter stored alongside the other filter params.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .base import (
    DebugStep,
    FilterDetection,
    FilterParamSpec,
    FilterResult,
    ImageFilter,
)

logger = logging.getLogger(__name__)

_MODELS_CACHE: dict[str, Any] = {}


def _get_models_dir() -> Path:
    from django.conf import settings

    return Path(getattr(settings, "YOLO_MODELS_DIR", Path(settings.BASE_DIR).parent / "models"))


def list_model_files() -> list[str]:
    """Return basenames of ``.pt`` files found in the models directory."""
    d = _get_models_dir()
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.iterdir() if p.suffix == ".pt" and p.is_file())


def get_model_class_names(model_filename: str) -> list[str]:
    """Load a YOLO model and return its class names (cached)."""
    try:
        from ultralytics import YOLO
    except ImportError:
        logger.warning("ultralytics no instalado; no se pueden obtener las clases del modelo.")
        return []
    model_path = _get_models_dir() / model_filename
    if not model_path.is_file():
        return []
    key = str(model_path)
    if key not in _MODELS_CACHE:
        _MODELS_CACHE[key] = YOLO(str(model_path))
    model = _MODELS_CACHE[key]
    names: dict[int, str] = getattr(model, "names", {})
    return [names[i] for i in sorted(names)]


class YoloDetectionFilter(ImageFilter):
    @property
    def name(self) -> str:
        return "yolo_detection"

    @property
    def display_name(self) -> str:
        return "Detección con YOLO (red neuronal)"

    @property
    def param_specs(self) -> list[FilterParamSpec]:
        models = list_model_files()
        model_opts = tuple({"value": m, "label": m} for m in models)
        default_model = models[0] if models else ""
        return [
            FilterParamSpec(
                "model_file", "Modelo",
                "Archivo de modelo YOLOv8 (.pt) de la carpeta models.",
                "select", default_model,
                options=model_opts,
            ),
            FilterParamSpec(
                "confidence", "Confianza mín.",
                "Umbral mínimo de confianza para aceptar una detección.",
                "float", 0.25, 0.01, 1.0, 0.01,
            ),
            FilterParamSpec(
                "iou_threshold", "IoU NMS",
                "Umbral de IoU para Non-Maximum Suppression. Menor valor = menos solapamiento.",
                "float", 0.45, 0.01, 1.0, 0.01,
            ),
            FilterParamSpec(
                "max_det", "Máx. detecciones",
                "Número máximo de detecciones por imagen.",
                "int", 300, 1, 2000, 1,
            ),
            FilterParamSpec(
                "label_mode", "Modo de etiqueta",
                "Cómo asignar la clase a cada detección.",
                "select", "single",
                options=(
                    {"value": "single", "label": "Una sola etiqueta para todo"},
                    {"value": "model", "label": "Usar etiquetas del modelo"},
                    {"value": "map", "label": "Tabla de equivalencias"},
                ),
            ),
            FilterParamSpec(
                "single_class_name", "Etiqueta única",
                "Clase del proyecto que se asignará a todas las detecciones. "
                "Solo se usa en modo 'Una sola etiqueta'.",
                "select", "",
                options=(),
            ),
            FilterParamSpec(
                "class_map", "Tabla de equivalencias",
                "JSON: {\"clase_modelo\": \"clase_proyecto\", ...}. "
                "Solo se usa en modo 'Tabla de equivalencias'.",
                "select", "{}",
                options=(),
            ),
        ]

    def _load_model(self, model_file: str):
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError(
                "La librería 'ultralytics' no está instalada. "
                "Ejecutá: pip install ultralytics"
            ) from exc
        model_path = _get_models_dir() / model_file
        if not model_path.is_file():
            raise FileNotFoundError(f"Modelo no encontrado: {model_path}")
        key = str(model_path)
        if key not in _MODELS_CACHE:
            _MODELS_CACHE[key] = YOLO(str(model_path))
        return _MODELS_CACHE[key]

    def _run(self, image_path: Path, params: dict, *, debug: bool = False) -> FilterResult:
        p = self.coerce_params(params)
        steps: list[DebugStep] = []

        model_file = str(p.get("model_file", ""))
        if not model_file:
            return FilterResult()

        model = self._load_model(model_file)
        names: dict[int, str] = getattr(model, "names", {})

        conf = float(p.get("confidence", 0.25))
        iou = float(p.get("iou_threshold", 0.45))
        max_det = int(p.get("max_det", 300))

        label_mode = str(p.get("label_mode", "single"))
        single_class_name = str(p.get("single_class_name", ""))
        class_map_raw = p.get("class_map", "{}")
        try:
            class_map: dict[str, str] = json.loads(class_map_raw) if isinstance(class_map_raw, str) else {}
        except (json.JSONDecodeError, TypeError):
            class_map = {}

        img = cv2.imread(str(image_path))
        if img is None:
            return FilterResult()

        h_img, w_img = img.shape[:2]

        results = model.predict(
            source=str(image_path),
            conf=conf,
            iou=iou,
            max_det=max_det,
            verbose=False,
        )

        if debug:
            steps.append(DebugStep("Entrada", img.copy()))

        detections: list[FilterDetection] = []
        if results and len(results) > 0:
            r = results[0]
            boxes = r.boxes
            if boxes is not None and len(boxes) > 0:
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    cls_id = int(box.cls[0].cpu().numpy())
                    box_conf = float(box.conf[0].cpu().numpy())
                    cls_name = names.get(cls_id, str(cls_id))

                    if label_mode == "single" and single_class_name:
                        mapped_name = single_class_name
                    elif label_mode == "map" and class_map:
                        mapped_name = class_map.get(cls_name, cls_name)
                    else:
                        mapped_name = cls_name

                    nx = float(x1) / w_img
                    ny = float(y1) / h_img
                    nw = float(x2 - x1) / w_img
                    nh_box = float(y2 - y1) / h_img

                    detections.append(
                        FilterDetection(
                            x=round(nx, 6),
                            y=round(ny, 6),
                            width=round(nw, 6),
                            height=round(nh_box, 6),
                            confidence=round(box_conf, 4),
                            class_name=mapped_name,
                        )
                    )

        if debug and results and len(results) > 0:
            plot_img = results[0].plot()
            if plot_img is not None:
                steps.append(DebugStep(f"YOLO ({len(detections)} det.)", plot_img))

        return FilterResult(detections=detections, debug_steps=steps)

    def apply(self, image_path: Path, params: dict) -> list[FilterDetection]:
        return self._run(image_path, params, debug=False).detections

    def apply_with_debug(self, image_path: Path, params: dict) -> FilterResult:
        return self._run(image_path, params, debug=True)
