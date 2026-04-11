"""Aumento de datos para export YOLO (geométricas + fotométricas)."""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageFilter

from .yolo_utils import pixel_to_yolo_line


def _boxes_from_annotations(annotations, w: int, h: int) -> list[tuple[float, float, float, float, int]]:
    out = []
    for a in annotations:
        out.append((float(a.x), float(a.y), float(a.width), float(a.height), a.label_class_id))
    return out


def _write_label(
    lbl_path: Path,
    boxes: list[tuple[float, float, float, float, int]],
    idx_map: dict[int, int],
    img_w: int,
    img_h: int,
) -> None:
    lines = []
    for x, y, bw, bh, lc_id in boxes:
        cid = idx_map.get(lc_id)
        if cid is None:
            continue
        lines.append(
            pixel_to_yolo_line(
                Decimal(str(x)),
                Decimal(str(y)),
                Decimal(str(bw)),
                Decimal(str(bh)),
                img_w,
                img_h,
                cid,
            ),
        )
    lbl_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def apply_augmentations_to_pair(
    abs_path: Path,
    annotations,
    idx_map: dict[int, int],
    img_dir: Path,
    lbl_dir: Path,
    *,
    base_name: str,
    original_ext: str,
    options: dict[str, Any],
    width_px: int,
    height_px: int,
) -> None:
    """Genera variantes aumentadas adicionales en img_dir/lbl_dir."""
    if not options:
        return

    im = Image.open(abs_path).convert("RGB")
    W, H = im.size
    boxes = _boxes_from_annotations(annotations, W, H)

    def save_variant(pil_img: Image.Image, bxs: list[tuple[float, float, float, float, int]], suffix: str) -> None:
        ext = original_ext if original_ext.startswith(".") else f".{original_ext}"
        iname = f"{base_name}_aug_{suffix}{ext}"
        pil_img.save(img_dir / iname)
        _write_label(lbl_dir / Path(iname).with_suffix(".txt").name, bxs, idx_map, pil_img.size[0], pil_img.size[1])

    # Volteo horizontal
    if options.get("flip_horizontal"):
        flipped = im.transpose(Image.FLIP_LEFT_RIGHT)
        nb = []
        for x, y, bw, bh, lid in boxes:
            nx = W - x - bw
            nb.append((nx, y, bw, bh, lid))
        save_variant(flipped, nb, "flip_h")

    # Volteo vertical
    if options.get("flip_vertical"):
        flipped = im.transpose(Image.FLIP_TOP_BOTTOM)
        nb = []
        for x, y, bw, bh, lid in boxes:
            ny = H - y - bh
            nb.append((x, ny, bw, bh, lid))
        save_variant(flipped, nb, "flip_v")

    # Rotación pequeña (grados)
    angle = float(options.get("rotate_deg", 0) or 0)
    if abs(angle) > 0.01:
        rad = angle * 3.141592653589793 / 180.0
        import math

        cos_a = math.cos(rad)
        sin_a = math.sin(rad)
        cx, cy = W / 2, H / 2
        rotated = im.rotate(-angle, expand=True, fillcolor=(128, 128, 128))
        Rw, Rh = rotated.size
        nb = []
        for x, y, bw, bh, lid in boxes:
            corners = [(x, y), (x + bw, y), (x + bw, y + bh), (x, y + bh)]
            rc = []
            for px, py in corners:
                tx = px - cx
                ty = py - cy
                rx = tx * cos_a - ty * sin_a + Rw / 2
                ry = tx * sin_a + ty * cos_a + Rh / 2
                rc.append((rx, ry))
            xs = [p[0] for p in rc]
            ys = [p[1] for p in rc]
            nx = min(xs)
            ny = min(ys)
            nxb = max(xs) - nx
            nyb = max(ys) - ny
            nx = max(0, min(Rw - 1, nx))
            ny = max(0, min(Rh - 1, ny))
            nxb = max(1, min(Rw - nx, nxb))
            nyb = max(1, min(Rh - ny, nyb))
            nb.append((nx, ny, nxb, nyb, lid))
        save_variant(rotated, nb, f"rot_{int(angle)}")

    # Fotométricas (no cambian geometría de cajas)
    if options.get("brightness") and float(options["brightness"]) != 1.0:
        factor = float(options["brightness"])
        enh = ImageEnhance.Brightness(im)
        out = enh.enhance(factor)
        save_variant(out, boxes, f"bright_{factor:.2f}".replace(".", "_"))

    if options.get("contrast") and float(options["contrast"]) != 1.0:
        factor = float(options["contrast"])
        enh = ImageEnhance.Contrast(im)
        out = enh.enhance(factor)
        save_variant(out, boxes, f"contr_{factor:.2f}".replace(".", "_"))

    if options.get("blur_sigma"):
        sigma = float(options["blur_sigma"])
        if sigma > 0:
            out = im.filter(ImageFilter.GaussianBlur(radius=sigma))
            save_variant(out, boxes, f"blur_{sigma:.2f}".replace(".", "_"))
