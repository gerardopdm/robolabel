"""Generación de ZIP YOLOv8 y utilidades de coordenadas."""
from __future__ import annotations

import io
import os
import random
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Iterable

import yaml
from django.conf import settings

from core.models import LabelClass, Project, ProjectImage

from . import augmentation as aug
from .yolo_utils import pixel_to_yolo_line


def class_index_map(project: Project) -> dict[int, int]:
    """label_class.id -> índice YOLO 0..N-1 por sort_index."""
    classes = list(LabelClass.objects.filter(project=project).order_by("sort_index", "id"))
    return {c.id: i for i, c in enumerate(classes)}


def collect_images(
    project: Project,
    *,
    group_ids: list[int] | None,
    only_completed: bool,
) -> list[ProjectImage]:
    qs = ProjectImage.objects.filter(
        group__project=project,
        group__deleted_at__isnull=True,
        deleted_at__isnull=True,
        discarded_for_dataset=False,
    ).select_related("group")
    if group_ids:
        qs = qs.filter(group_id__in=group_ids)
    if only_completed:
        qs = qs.filter(status=ProjectImage.Status.COMPLETED)
    return list(qs.order_by("id"))


def _copy_image_to(
    src_abs: Path,
    dest_dir: Path,
    filename: str,
) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_abs, dest_dir / filename)


def _resolve_three_way_ratios(
    *,
    train_val_split: float | None,
    split_train: float | None,
    split_test: float | None,
    split_val: float | None,
) -> tuple[float, float, float]:
    """Devuelve (r_train, r_test, r_val) que suman 1."""
    if split_train is not None:
        if split_test is None or split_val is None:
            raise ValueError("Si indicás split_train, también debés enviar split_test y split_val.")
        t, e, v = float(split_train), float(split_test), float(split_val)
        s = t + e + v
        if s <= 0:
            raise ValueError("Las proporciones train/test/valid deben sumar un valor positivo.")
        return (t / s, e / s, v / s)
    tv = float(train_val_split if train_val_split is not None else 0.8)
    if tv <= 0 or tv >= 1:
        raise ValueError("train_val_split debe estar entre 0 y 1 (excluidos).")
    return (tv, 0.0, 1.0 - tv)


def _split_images_three_way(
    imgs: list[ProjectImage],
    r_train: float,
    r_test: float,
    r_val: float,
) -> tuple[list[ProjectImage], list[ProjectImage], list[ProjectImage]]:
    """Reparte imágenes en train / test / val; los conteos suman len(imgs)."""
    n = len(imgs)
    shuffled = imgs[:]
    rng = random.Random(42)
    rng.shuffle(shuffled)
    n_train = int(round(n * r_train))
    n_test = int(round(n * r_test))
    n_val = n - n_train - n_test
    # Ajustes por si el redondeo dejó algún conteo negativo
    if n_val < 0:
        n_test += n_val
        n_val = 0
    if n_test < 0:
        n_train += n_test
        n_test = 0
    i0 = 0
    train_list = shuffled[i0 : i0 + n_train]
    i0 += n_train
    test_list = shuffled[i0 : i0 + n_test]
    i0 += n_test
    val_list = shuffled[i0 : i0 + n_val]

    # Asegurar train y val no vacíos cuando hay suficientes imágenes (compat. YOLO)
    if not train_list and (test_list or val_list):
        if test_list:
            train_list.append(test_list.pop())
        elif val_list:
            train_list.append(val_list.pop())
    if not val_list and train_list:
        val_list.append(train_list.pop())
    if not train_list and val_list:
        train_list.append(val_list.pop())

    return train_list, test_list, val_list


def build_yolo_zip_bytes(
    project: Project,
    images: Iterable[ProjectImage],
    *,
    train_val_split: float | None = None,
    split_train: float | None = None,
    split_test: float | None = None,
    split_val: float | None = None,
    augmentations: dict | None = None,
) -> tuple[bytes, int]:
    """
    Construye ZIP en memoria. Devuelve (bytes, tamaño).
    augmentations: p.ej. {"flip_horizontal": true, "brightness": 0.1, ...}

    Reparto:
    - Modo nuevo: split_train + split_test + split_val = 1 (cada uno en [0, 1]).
    - Modo legacy: solo train_val_split (p. ej. 0.8) → train 80 %, valid 20 %, test 0 %.
    """
    augmentations = augmentations or {}
    imgs = list(images)
    if not imgs:
        raise ValueError("No hay imágenes elegibles para exportar.")

    r_train, r_test, r_val = _resolve_three_way_ratios(
        train_val_split=train_val_split,
        split_train=split_train,
        split_test=split_test,
        split_val=split_val,
    )
    train_list, test_list, val_list = _split_images_three_way(imgs, r_train, r_test, r_val)

    idx_map = class_index_map(project)
    class_rows = list(LabelClass.objects.filter(project=project).order_by("sort_index", "id"))
    names = [c.name for c in class_rows]

    media_root = Path(settings.MEDIA_ROOT)

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        images_train = root / "images" / "train"
        images_test = root / "images" / "test"
        images_val = root / "images" / "val"
        labels_train = root / "labels" / "train"
        labels_test = root / "labels" / "test"
        labels_val = root / "labels" / "val"
        for d in (images_train, images_test, images_val, labels_train, labels_test, labels_val):
            d.mkdir(parents=True, exist_ok=True)

        def process_image(pi: ProjectImage, split: str) -> None:
            abs_path = media_root / pi.storage_path
            if not abs_path.is_file():
                raise FileNotFoundError(f"Falta archivo: {abs_path}")

            base_name = Path(pi.original_filename).stem
            ext = Path(pi.original_filename).suffix.lower() or ".jpg"
            img_name = f"p{pi.pk}_{base_name}{ext}"

            if split == "train":
                img_dir, lbl_dir = images_train, labels_train
            elif split == "test":
                img_dir, lbl_dir = images_test, labels_test
            else:
                img_dir, lbl_dir = images_val, labels_val

            anns = list(
                pi.annotations.select_related("label_class").all(),
            )
            lines = []
            for a in anns:
                cid = idx_map.get(a.label_class_id)
                if cid is None:
                    continue
                lines.append(
                    pixel_to_yolo_line(
                        a.x,
                        a.y,
                        a.width,
                        a.height,
                        pi.width_px,
                        pi.height_px,
                        cid,
                    ),
                )

            _copy_image_to(abs_path, img_dir, img_name)
            label_name = Path(img_name).with_suffix(".txt").name
            (lbl_dir / label_name).write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

            # Variantes aumentadas (solo train para no duplicar validación)
            if split == "train" and augmentations:
                aug.apply_augmentations_to_pair(
                    abs_path,
                    anns,
                    idx_map,
                    img_dir,
                    lbl_dir,
                    base_name=f"p{pi.pk}_{base_name}",
                    original_ext=ext,
                    options=augmentations,
                    width_px=pi.width_px,
                    height_px=pi.height_px,
                )

        for pi in train_list:
            process_image(pi, "train")
        for pi in test_list:
            process_image(pi, "test")
        for pi in val_list:
            process_image(pi, "val")

        data = {
            "path": ".",
            "train": "images/train",
            "val": "images/val",
            "nc": len(names),
            "names": names,
        }
        if test_list:
            data["test"] = "images/test"
        (root / "data.yaml").write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for folder, _, files in os.walk(root):
                for fn in files:
                    fp = Path(folder) / fn
                    arc = fp.relative_to(root).as_posix()
                    zf.write(fp, arcname=arc)
        raw = buf.getvalue()
        return raw, len(raw)


def count_exported_images_in_zip(
    images: list[ProjectImage],
    *,
    train_val_split: float | None = None,
    split_train: float | None = None,
    split_test: float | None = None,
    split_val: float | None = None,
    augmentations: dict | None = None,
) -> int:
    """Número de archivos de imagen en el ZIP YOLO (train + variantes + test + val)."""
    imgs = list(images)
    if not imgs:
        return 0
    r_train, r_test, r_val = _resolve_three_way_ratios(
        train_val_split=train_val_split,
        split_train=split_train,
        split_test=split_test,
        split_val=split_val,
    )
    train_list, test_list, val_list = _split_images_three_way(imgs, r_train, r_test, r_val)
    k = aug.count_augmentation_variants_per_train_image(augmentations)
    return len(train_list) * (1 + k) + len(test_list) + len(val_list)


def compute_class_breakdown(project: Project, images: list[ProjectImage]) -> list[dict]:
    """
    Por cada clase del proyecto, cuántas imágenes de la versión tienen al menos una anotación de esa clase.
    """
    if not images:
        return []
    image_ids = [pi.id for pi in images]
    classes = LabelClass.objects.filter(project=project).order_by("sort_index", "id")
    out: list[dict] = []
    for lc in classes:
        n = (
            ProjectImage.objects.filter(id__in=image_ids)
            .filter(annotations__label_class_id=lc.id)
            .distinct()
            .count()
        )
        out.append(
            {
                "label_class_id": lc.id,
                "name": lc.name,
                "images_count": n,
            }
        )
    return out
