"""Tile (teja) detection filter using LAB thresholding + distance transform.

Designed for tiles on a roller conveyor: a vertical morphological closing
step bridges the horizontal dark gaps that rollers leave on the thresholded
image, reconstructing each tile as a single connected component before the
distance-transform stage.

Supports an optional ROI (Region of Interest) so only a portion of the image
is processed and the rest is ignored.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .base import DebugStep, FilterDetection, FilterParamSpec, FilterResult, ImageFilter


class TileDetectionFilter(ImageFilter):
    @property
    def name(self) -> str:
        return "tile_detection"

    @property
    def display_name(self) -> str:
        return "Detección de tejas (LAB + Dist. Transform)"

    @property
    def param_specs(self) -> list[FilterParamSpec]:
        return [
            # --- ROI ---
            FilterParamSpec(
                "roi_x", "ROI — izquierda %",
                "Borde izquierdo de la región de interés (% del ancho). 0 = desde el borde izquierdo.",
                "int", 0, 0, 99, 1,
            ),
            FilterParamSpec(
                "roi_y", "ROI — arriba %",
                "Borde superior de la región de interés (% del alto). 0 = desde el borde superior.",
                "int", 0, 0, 99, 1,
            ),
            FilterParamSpec(
                "roi_w", "ROI — ancho %",
                "Ancho de la región de interés (% del ancho total). 100 = toda la imagen.",
                "int", 100, 1, 100, 1,
            ),
            FilterParamSpec(
                "roi_h", "ROI — alto %",
                "Alto de la región de interés (% del alto total). 100 = toda la imagen.",
                "int", 100, 1, 100, 1,
            ),
            # --- Threshold ---
            FilterParamSpec(
                "thresh_l", "Umbral L",
                "Umbral aplicado al canal L del espacio LAB.",
                "int", 160, 1, 255, 1,
            ),
            # --- Morphology ---
            FilterParamSpec(
                "close_v", "Cierre vertical (px)",
                "Altura del kernel de cierre vertical. Puentea las franjas oscuras de los rodillos "
                "para reconectar fragmentos de la misma teja. 0 = desactivado.",
                "int", 25, 0, 80, 1,
            ),
            FilterParamSpec(
                "close_h", "Cierre horizontal (px)",
                "Ancho del kernel de cierre horizontal. Útil si hay separaciones verticales. "
                "0 = desactivado.",
                "int", 0, 0, 80, 1,
            ),
            FilterParamSpec(
                "kernel_n", "Kernel apertura (2n+1)",
                "Tamaño del kernel de apertura morfológica para limpiar ruido.",
                "int", 2, 1, 15, 1,
            ),
            # --- Distance transform ---
            FilterParamSpec(
                "dist_pct", "Dist % del máx",
                "Porcentaje del máximo de la transformada de distancia para definir foreground seguro.",
                "int", 40, 1, 99, 1,
            ),
            # --- Size filters ---
            FilterParamSpec(
                "min_area", "Área mínima",
                "Contornos con área menor se descartan.",
                "int", 500, 0, 8000, 50,
            ),
            FilterParamSpec(
                "min_box_w", "Ancho mín. box",
                "Ancho mínimo del bounding box en píxeles.",
                "int", 0, 0, 400, 5,
            ),
            FilterParamSpec(
                "min_box_h", "Alto mín. box",
                "Alto mínimo del bounding box en píxeles.",
                "int", 0, 0, 400, 5,
            ),
            FilterParamSpec(
                "max_box_w", "Ancho máx. box",
                "Ancho máximo del bounding box en píxeles. 0 = sin límite.",
                "int", 0, 0, 2000, 10,
            ),
            FilterParamSpec(
                "max_box_h", "Alto máx. box",
                "Alto máximo del bounding box en píxeles. 0 = sin límite.",
                "int", 0, 0, 2000, 10,
            ),
            # --- Box scaling ---
            FilterParamSpec(
                "box_scale_w", "Escala ancho %",
                "Escala del ancho del box (100 = tamaño natural).",
                "int", 100, 10, 300, 5,
            ),
            FilterParamSpec(
                "box_scale_h", "Escala alto %",
                "Escala del alto del box (100 = tamaño natural).",
                "int", 100, 10, 300, 5,
            ),
        ]

    # ------------------------------------------------------------------

    def _compute_roi(self, params: dict, w_img: int, h_img: int) -> tuple[int, int, int, int]:
        """Return (rx1, ry1, rx2, ry2) pixel coords of the ROI."""
        rx = int(params["roi_x"])
        ry = int(params["roi_y"])
        rw = int(params["roi_w"])
        rh = int(params["roi_h"])

        rx1 = int(round(rx / 100.0 * w_img))
        ry1 = int(round(ry / 100.0 * h_img))
        rx2 = min(w_img, int(round((rx + rw) / 100.0 * w_img)))
        ry2 = min(h_img, int(round((ry + rh) / 100.0 * h_img)))

        rx1 = max(0, min(rx1, w_img - 1))
        ry1 = max(0, min(ry1, h_img - 1))
        rx2 = max(rx1 + 1, rx2)
        ry2 = max(ry1 + 1, ry2)
        return rx1, ry1, rx2, ry2

    def _is_full_image(self, params: dict) -> bool:
        return (
            int(params["roi_x"]) == 0
            and int(params["roi_y"]) == 0
            and int(params["roi_w"]) >= 100
            and int(params["roi_h"]) >= 100
        )

    def _run(self, image_path: Path, params: dict, *, debug: bool = False) -> FilterResult:
        p = self.coerce_params(params)
        steps: list[DebugStep] = []

        img = cv2.imread(str(image_path))
        if img is None:
            return FilterResult()

        h_img, w_img = img.shape[:2]

        # --- ROI ---
        full_image = self._is_full_image(p)
        rx1, ry1, rx2, ry2 = self._compute_roi(p, w_img, h_img)
        roi_img = img if full_image else img[ry1:ry2, rx1:rx2]
        h_roi, w_roi = roi_img.shape[:2]

        if debug and not full_image:
            roi_vis = img.copy()
            cv2.rectangle(roi_vis, (rx1, ry1), (rx2, ry2), (0, 255, 255), 2)
            overlay = roi_vis.copy()
            cv2.rectangle(overlay, (0, 0), (w_img, ry1), (0, 0, 0), -1)
            cv2.rectangle(overlay, (0, ry2), (w_img, h_img), (0, 0, 0), -1)
            cv2.rectangle(overlay, (0, ry1), (rx1, ry2), (0, 0, 0), -1)
            cv2.rectangle(overlay, (rx2, ry1), (w_img, ry2), (0, 0, 0), -1)
            roi_vis = cv2.addWeighted(overlay, 0.55, roi_vis, 0.45, 0)
            cv2.rectangle(roi_vis, (rx1, ry1), (rx2, ry2), (0, 255, 255), 2)
            steps.append(DebugStep("ROI", roi_vis))

        # --- Step 1: Canal L del espacio LAB ---
        lab = cv2.cvtColor(roi_img, cv2.COLOR_BGR2LAB)
        l_ch, _, _ = cv2.split(lab)
        if debug:
            steps.append(DebugStep("Canal L (LAB)", l_ch))

        # --- Step 2: Umbralización ---
        _, thresh = cv2.threshold(l_ch, int(p["thresh_l"]), 255, cv2.THRESH_BINARY)
        if debug:
            steps.append(DebugStep(f"Umbral L > {int(p['thresh_l'])}", thresh))

        # --- Step 3: Cierre vertical (puentea rodillos) ---
        closed = thresh
        cv_h = int(p["close_v"])
        if cv_h >= 2:
            k_v = cv2.getStructuringElement(cv2.MORPH_RECT, (1, cv_h))
            closed = cv2.morphologyEx(closed, cv2.MORPH_CLOSE, k_v, iterations=1)
        if debug:
            steps.append(DebugStep(
                f"Cierre vert. ({cv_h}px)" if cv_h >= 2 else "Cierre vert. (off)",
                closed,
            ))

        # --- Step 4: Cierre horizontal (opcional) ---
        ch_w = int(p["close_h"])
        if ch_w >= 2:
            k_h = cv2.getStructuringElement(cv2.MORPH_RECT, (ch_w, 1))
            closed = cv2.morphologyEx(closed, cv2.MORPH_CLOSE, k_h, iterations=1)
            if debug:
                steps.append(DebugStep(f"Cierre horiz. ({ch_w}px)", closed))

        # --- Step 5: Apertura morfológica (limpieza de ruido) ---
        k = max(3, (2 * max(1, int(p["kernel_n"])) + 1))
        kernel = np.ones((k, k), np.uint8)
        opening = cv2.morphologyEx(closed, cv2.MORPH_OPEN, kernel, iterations=1)
        if debug:
            steps.append(DebugStep(f"Apertura ({k}x{k})", opening))

        # --- Step 6: Transformada de distancia ---
        dist_transform = cv2.distanceTransform(opening, cv2.DIST_L2, 5)
        if debug:
            dt_vis = np.zeros_like(l_ch)
            if dist_transform.max() > 0:
                dt_vis = np.uint8(255 * dist_transform / dist_transform.max())
            steps.append(DebugStep("Transf. distancia", dt_vis))

        # --- Step 7: Foreground seguro ---
        factor = max(1, min(99, int(p["dist_pct"]))) / 100.0
        dt_max = dist_transform.max()
        if dt_max <= 0:
            return FilterResult(debug_steps=steps)
        _, sure_fg = cv2.threshold(dist_transform, factor * dt_max, 255, 0)
        sure_fg = np.uint8(sure_fg)
        if debug:
            steps.append(DebugStep(f"Foreground ({int(p['dist_pct'])}%)", sure_fg))

        # --- Step 8: Contornos ---
        contours, _ = cv2.findContours(sure_fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if debug:
            contour_vis = np.zeros((h_roi, w_roi, 3), dtype=np.uint8)
            cv2.drawContours(contour_vis, contours, -1, (0, 255, 0), 1)
            steps.append(DebugStep(f"Contornos ({len(contours)})", contour_vis))

        # --- Step 9: Filtrado y boxes ---
        sw = max(10, min(300, int(p["box_scale_w"]))) / 100.0
        sh = max(10, min(300, int(p["box_scale_h"]))) / 100.0
        min_area = int(p["min_area"])
        min_bw = int(p["min_box_w"])
        min_bh = int(p["min_box_h"])
        max_bw = int(p["max_box_w"])
        max_bh = int(p["max_box_h"])

        detections: list[FilterDetection] = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area <= min_area:
                continue
            x, y, w, h = cv2.boundingRect(cnt)
            if w < min_bw or h < min_bh:
                continue

            cx = x + w * 0.5
            cy = y + h * 0.5
            nw = int(round(w * sw))
            nh = int(round(h * sh))

            if max_bw > 0 and nw > max_bw:
                continue
            if max_bh > 0 and nh > max_bh:
                continue

            x1 = int(round(cx - nw * 0.5))
            y1 = int(round(cy - nh * 0.5))
            x2 = x1 + nw
            y2 = y1 + nh

            # Clamp to ROI bounds
            x1 = max(0, min(x1, w_roi - 1))
            y1 = max(0, min(y1, h_roi - 1))
            x2 = max(x1 + 1, min(x2, w_roi))
            y2 = max(y1 + 1, min(y2, h_roi))

            # Offset to full-image coordinates
            abs_x1 = x1 + rx1
            abs_y1 = y1 + ry1
            abs_x2 = x2 + rx1
            abs_y2 = y2 + ry1

            detections.append(
                FilterDetection(
                    x=round(abs_x1 / w_img, 6),
                    y=round(abs_y1 / h_img, 6),
                    width=round((abs_x2 - abs_x1) / w_img, 6),
                    height=round((abs_y2 - abs_y1) / h_img, 6),
                    confidence=1.0,
                )
            )

        return FilterResult(detections=detections, debug_steps=steps)

    def apply(self, image_path: Path, params: dict) -> list[FilterDetection]:
        return self._run(image_path, params, debug=False).detections

    def apply_with_debug(self, image_path: Path, params: dict) -> FilterResult:
        return self._run(image_path, params, debug=True)
