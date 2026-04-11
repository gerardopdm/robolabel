"""Utilidades de formato YOLO (normalización)."""
from decimal import Decimal


def pixel_to_yolo_line(
    x: Decimal,
    y: Decimal,
    w: Decimal,
    h: Decimal,
    img_w: int,
    img_h: int,
    class_index: int,
) -> str:
    fw, fh = float(img_w), float(img_h)
    xc = (float(x) + float(w) / 2) / fw
    yc = (float(y) + float(h) / 2) / fh
    nw = float(w) / fw
    nh = float(h) / fh
    xc = min(1.0, max(0.0, xc))
    yc = min(1.0, max(0.0, yc))
    nw = min(1.0, max(0.0, nw))
    nh = min(1.0, max(0.0, nh))
    return f"{class_index} {xc:.6f} {yc:.6f} {nw:.6f} {nh:.6f}"
