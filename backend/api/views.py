"""Vistas API REST RoboLabel."""
from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

import cv2
from django.conf import settings
from django.db.models import Count, Prefetch, Q
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from core.models import (
    Annotation,
    DatasetVersion,
    DatasetVersionImage,
    GroupAssignment,
    ImageGroup,
    LabelClass,
    Project,
    ProjectImage,
    User,
    ValidationRecord,
)

from .export_service import build_yolo_zip_bytes, collect_images
from .pagination import FlexiblePageSizePagination
from .mixins import (
    filter_image_groups_for_user,
    filter_projects_for_user,
    user_can_access_project_image,
    user_can_annotate_image,
    user_can_validate_image,
    user_has_global_project_access,
)
from .permissions import (
    CanExportDataset,
    IsAdministrador,
    IsAsignadorOrAdministrador,
    IsCompanyMember,
)
from .serializers import (
    AnnotationSerializer,
    AnnotationWriteItemSerializer,
    DatasetVersionCreateSerializer,
    DatasetVersionSerializer,
    DetectedObjectSerializer,
    FindSimilarRequestSerializer,
    GroupAssignmentSerializer,
    ImageGroupSerializer,
    LabelClassSerializer,
    ProjectImageSerializer,
    ProjectImageUpdateSerializer,
    ProjectListSerializer,
    ProjectSerializer,
    UserCreateSerializer,
    UserListSerializer,
    UserMeSerializer,
    UserUpdateSerializer,
)


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "service": "robolabel-api"})


class MeView(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, IsCompanyMember]

    def list(self, request):
        return Response(UserMeSerializer(request.user).data)


class UserAdminViewSet(viewsets.ModelViewSet):
    """Alta y edición de usuarios: lectura para asignador/admin (p. ej. asignar grupos); escritura solo administrador."""

    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsCompanyMember(), IsAsignadorOrAdministrador()]
        return [IsAuthenticated(), IsCompanyMember(), IsAdministrador()]

    def get_queryset(self):
        return User.objects.filter(company_id=self.request.user.company_id).order_by("email")

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        if self.action in ("partial_update", "update"):
            return UserUpdateSerializer
        return UserListSerializer

    def perform_destroy(self, instance):
        if instance.pk == self.request.user.pk:
            raise PermissionDenied("No podés desactivar tu propio usuario.")
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.none()

    def get_queryset(self):
        qs = filter_projects_for_user(self.request.user).annotate(
            groups_count=Count("groups", filter=Q(groups__deleted_at__isnull=True), distinct=True),
            images_count=Count(
                "groups__images",
                filter=Q(
                    groups__deleted_at__isnull=True,
                    groups__images__deleted_at__isnull=True,
                ),
            ),
        )
        if self.action == "list":
            return qs
        return filter_projects_for_user(self.request.user)

    def get_serializer_class(self):
        if self.action == "list":
            return ProjectListSerializer
        return ProjectSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve", "stats"):
            return [IsAuthenticated(), IsCompanyMember()]
        if self.action == "export_yolov8":
            return [IsAuthenticated(), IsCompanyMember(), CanExportDataset()]
        return [IsAuthenticated(), IsCompanyMember(), IsAdministrador()]

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.updated_by = self.request.user
        instance.save(update_fields=["deleted_at", "updated_at", "updated_by"])

    @action(detail=True, methods=["get"])
    def stats(self, request, pk=None):
        project = self.get_object()
        imgs = ProjectImage.objects.filter(
            group__project=project,
            group__deleted_at__isnull=True,
            deleted_at__isnull=True,
        )
        total = imgs.count()
        completed = imgs.filter(status=ProjectImage.Status.COMPLETED).count()
        pending = imgs.filter(status=ProjectImage.Status.PENDING).count()
        in_progress = imgs.filter(status=ProjectImage.Status.IN_PROGRESS).count()
        pending_validation = imgs.filter(status=ProjectImage.Status.PENDING_VALIDATION).count()
        rejected = imgs.filter(status=ProjectImage.Status.REJECTED).count()
        label_classes = list(
            LabelClass.objects.filter(project=project).order_by("sort_index", "id").values("id", "name", "color_hex"),
        )
        counts_map: dict[tuple[int, int], int] = {}
        for row in (
            Annotation.objects.filter(
                image__group__project=project,
                image__deleted_at__isnull=True,
                image__group__deleted_at__isnull=True,
            )
            .values("image__group_id", "label_class_id")
            .annotate(image_count=Count("image_id", distinct=True))
        ):
            counts_map[(row["image__group_id"], row["label_class_id"])] = row["image_count"]

        by_group = []
        for g in ImageGroup.objects.filter(project=project, deleted_at__isnull=True).annotate(
            ic=Count("images", filter=Q(images__deleted_at__isnull=True)),
            cc=Count(
                "images",
                filter=Q(images__deleted_at__isnull=True, images__status=ProjectImage.Status.COMPLETED),
            ),
        ):
            images_by_class = [
                {
                    "id": lc["id"],
                    "name": lc["name"],
                    "color_hex": lc["color_hex"] or "#3B82F6",
                    "image_count": counts_map.get((g.id, lc["id"]), 0),
                }
                for lc in label_classes
            ]
            by_group.append(
                {
                    "id": g.id,
                    "name": g.name,
                    "total_images": g.ic,
                    "completed_images": g.cc,
                    "images_by_class": images_by_class,
                },
            )
        return Response(
            {
                "total_images": total,
                "completed_images": completed,
                "pending_images": pending,
                "in_progress_images": in_progress,
                "pending_validation_images": pending_validation,
                "rejected_images": rejected,
                "groups": by_group,
            },
        )

    @action(detail=True, methods=["post"], url_path="export/yolov8")
    def export_yolov8(self, request, pk=None):
        project = self.get_object()
        group_ids = request.data.get("group_ids")
        only_completed = request.data.get("only_completed", True)
        augmentations = request.data.get("augmentations") or {}
        images = collect_images(project, group_ids=group_ids, only_completed=only_completed)
        try:
            st = request.data.get("split_train")
            if st is not None:
                data, size = build_yolo_zip_bytes(
                    project,
                    images,
                    train_val_split=None,
                    split_train=float(st),
                    split_test=float(request.data["split_test"]),
                    split_val=float(request.data["split_val"]),
                    augmentations=augmentations,
                )
            else:
                train_val_split = float(request.data.get("train_val_split", 0.8))
                data, size = build_yolo_zip_bytes(
                    project,
                    images,
                    train_val_split=train_val_split,
                    augmentations=augmentations,
                )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        from django.http import HttpResponse

        resp = HttpResponse(data, content_type="application/zip")
        resp["Content-Disposition"] = f'attachment; filename="project_{project.pk}_yolov8.zip"'
        resp["Content-Length"] = str(size)
        return resp


class GroupAssignmentViewSet(viewsets.ModelViewSet):
    """Asignación de un grupo a etiquetadores (solo asignador o administrador escriben)."""

    serializer_class = GroupAssignmentSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_permissions(self):
        return [IsAuthenticated(), IsCompanyMember(), IsAsignadorOrAdministrador()]

    def get_queryset(self):
        gid = self.kwargs["group_pk"]
        return GroupAssignment.objects.filter(
            image_group_id=gid,
            image_group__project_id=self.kwargs["project_pk"],
            image_group__project__company_id=self.request.user.company_id,
            image_group__deleted_at__isnull=True,
        ).select_related("labeler", "assigned_by")

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["project_id"] = self.kwargs["project_pk"]
        ctx["image_group_id"] = self.kwargs["group_pk"]
        return ctx


class ImageGroupViewSet(viewsets.ModelViewSet):
    serializer_class = ImageGroupSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsCompanyMember()]
        return [IsAuthenticated(), IsCompanyMember(), IsAsignadorOrAdministrador()]

    def get_queryset(self):
        pid = self.kwargs["project_pk"]
        qs = ImageGroup.objects.filter(
            project_id=pid,
            project__company_id=self.request.user.company_id,
            deleted_at__isnull=True,
        )
        return filter_image_groups_for_user(qs, self.request.user)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["project_id"] = self.kwargs["project_pk"]
        return ctx

    def perform_create(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at", "updated_at"])


class LabelClassViewSet(viewsets.ModelViewSet):
    serializer_class = LabelClassSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsCompanyMember()]
        return [IsAuthenticated(), IsCompanyMember(), IsAsignadorOrAdministrador()]

    def get_queryset(self):
        pid = self.kwargs["project_pk"]
        return LabelClass.objects.filter(project_id=pid, project__company_id=self.request.user.company_id).annotate(
            annotation_count=Count("annotations"),
        )

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["project_id"] = self.kwargs["project_pk"]
        return ctx

    def perform_create(self, serializer):
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.annotations.exists():
            return Response(
                {"detail": "Existen anotaciones que usan esta clase. Elimínalas o reasígnalas antes."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)


class ProjectImageViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    pagination_class = FlexiblePageSizePagination

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsCompanyMember()]
        if self.action == "create":
            return [IsAuthenticated(), IsCompanyMember(), IsAsignadorOrAdministrador()]
        if self.action == "destroy":
            return [IsAuthenticated(), IsCompanyMember(), IsAsignadorOrAdministrador()]
        if self.action in ("partial_update", "update"):
            return [IsAuthenticated(), IsCompanyMember()]
        return [IsAuthenticated(), IsCompanyMember()]

    def get_queryset(self):
        gid = self.kwargs["group_pk"]
        ann_qs = Annotation.objects.order_by("id")
        qs = (
            ProjectImage.objects.filter(
                group_id=gid,
                group__deleted_at__isnull=True,
                group__project__company_id=self.request.user.company_id,
                deleted_at__isnull=True,
            )
            .annotate(annotation_count=Count("annotations"))
            .prefetch_related(Prefetch("annotations", queryset=ann_qs))
        )
        user = self.request.user
        if not user_has_global_project_access(user) and getattr(user, "is_etiquetador", False):
            qs = qs.filter(group__assignments__labeler=user).distinct()
        status_filter = (self.request.query_params.get("status") or "").strip().lower()
        S = ProjectImage.Status
        if status_filter in ("pendientes", "to_label", "labeling"):
            qs = qs.filter(status__in=[S.PENDING, S.IN_PROGRESS, S.REJECTED])
        elif status_filter in ("pending_validation", "etiquetadas", "validar", "to_validate"):
            qs = qs.filter(status=S.PENDING_VALIDATION)
        elif status_filter in ("validadas", "completed", "validated"):
            qs = qs.filter(status=S.COMPLETED)
        elif status_filter == "pending":
            # Compatibilidad: todo lo que no está validado como completado
            qs = qs.filter(
                status__in=[S.PENDING, S.IN_PROGRESS, S.REJECTED, S.PENDING_VALIDATION],
            )
        return qs.order_by("id")

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        gid = self.kwargs["group_pk"]
        base = ProjectImage.objects.filter(
            group_id=gid,
            group__deleted_at__isnull=True,
            group__project__company_id=request.user.company_id,
            deleted_at__isnull=True,
        )
        S = ProjectImage.Status
        pendientes = base.filter(status__in=[S.PENDING, S.IN_PROGRESS, S.REJECTED]).count()
        pending_validation = base.filter(status=S.PENDING_VALIDATION).count()
        validadas = base.filter(status=S.COMPLETED).count()
        counts = {
            "all": base.count(),
            "pendientes": pendientes,
            "pending_validation": pending_validation,
            "validadas": validadas,
            "completed": validadas,
            "pending": pendientes + pending_validation,
        }
        if hasattr(response, "data") and isinstance(response.data, dict):
            response.data["group_image_counts"] = counts
        return response

    def get_serializer_class(self):
        if self.action in ("partial_update", "update"):
            return ProjectImageUpdateSerializer
        return ProjectImageSerializer

    def create(self, request, *args, **kwargs):
        group = ImageGroup.objects.select_related("project").get(
            pk=self.kwargs["group_pk"],
            project_id=self.kwargs["project_pk"],
            project__company_id=request.user.company_id,
            deleted_at__isnull=True,
        )
        files = request.FILES.getlist("files")
        if not files:
            return Response({"detail": "No se enviaron archivos (campo files)."}, status=status.HTTP_400_BAD_REQUEST)
        if len(files) > settings.MAX_IMAGES_PER_UPLOAD:
            return Response({"detail": f"Máximo {settings.MAX_IMAGES_PER_UPLOAD} imágenes por subida."}, status=400)

        from PIL import Image as PILImage

        created = []
        errors = []
        media_root = Path(settings.MEDIA_ROOT)
        rel_base = Path("projects") / str(group.project_id) / "groups" / str(group.id)
        dest_dir = media_root / rel_base
        dest_dir.mkdir(parents=True, exist_ok=True)

        for f in files:
            if f.size > settings.MAX_UPLOAD_BYTES:
                errors.append({"file": f.name, "error": "Tamaño máximo 10MB"})
                continue
            mime = f.content_type or ""
            if mime not in settings.ALLOWED_IMAGE_MIME:
                errors.append({"file": f.name, "error": "Solo JPEG o PNG"})
                continue
            try:
                pil = PILImage.open(f)
                pil.verify()
            except Exception:
                errors.append({"file": f.name, "error": "Imagen inválida"})
                continue
            f.seek(0)
            pil = PILImage.open(f)
            if pil.mode not in ("RGB", "RGBA"):
                pil = pil.convert("RGB")
            w, h = pil.size
            ext = ".jpg" if mime == "image/jpeg" else ".png"
            safe_name = f"{uuid.uuid4().hex}{ext}"
            abs_path = dest_dir / safe_name
            pil.save(abs_path, quality=95)
            rel_path = str(rel_base / safe_name).replace("\\", "/")
            pi = ProjectImage.objects.create(
                group=group,
                storage_path=rel_path,
                original_filename=f.name[:255],
                mime_type=mime or "image/jpeg",
                file_size_bytes=os.path.getsize(abs_path),
                width_px=w,
                height_px=h,
                status=ProjectImage.Status.PENDING,
                created_by=request.user,
                updated_by=request.user,
            )
            created.append(pi)

        ser = ProjectImageSerializer(created, many=True, context={"request": request})
        return Response({"created": ser.data, "errors": errors}, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        comment = serializer.validated_data.pop("validation_comment", "")
        prev_status = serializer.instance.status
        image = serializer.save(updated_by=self.request.user)
        new_status = image.status
        user = self.request.user
        if (
            prev_status == ProjectImage.Status.PENDING_VALIDATION
            and new_status in (ProjectImage.Status.COMPLETED, ProjectImage.Status.REJECTED)
            and user_can_validate_image(user)
        ):
            ValidationRecord.objects.create(
                image=image,
                validator=user,
                decision=(
                    ValidationRecord.Decision.APPROVED
                    if new_status == ProjectImage.Status.COMPLETED
                    else ValidationRecord.Decision.REJECTED
                ),
                comment=comment or "",
            )

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.updated_by = self.request.user
        instance.save(update_fields=["deleted_at", "updated_at", "updated_by"])


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsCompanyMember])
def project_image_file(request, pk):
    try:
        img = ProjectImage.objects.select_related("group__project").get(
            pk=pk,
            deleted_at__isnull=True,
            group__deleted_at__isnull=True,
            group__project__company_id=request.user.company_id,
        )
    except ProjectImage.DoesNotExist:
        raise Http404
    if not user_can_access_project_image(request.user, img):
        raise Http404
    path = Path(settings.MEDIA_ROOT) / img.storage_path
    if not path.is_file():
        raise Http404
    return FileResponse(open(path, "rb"), content_type=img.mime_type)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsCompanyMember])
def image_neighbors(request, pk):
    try:
        img = ProjectImage.objects.select_related("group").get(
            pk=pk,
            deleted_at__isnull=True,
            group__deleted_at__isnull=True,
            group__project__company_id=request.user.company_id,
        )
    except ProjectImage.DoesNotExist:
        raise Http404
    if not user_can_access_project_image(request.user, img):
        raise Http404
    qs = ProjectImage.objects.filter(group=img.group, deleted_at__isnull=True).order_by("id")
    ids = list(qs.values_list("id", flat=True))
    try:
        i = ids.index(img.id)
    except ValueError:
        return Response({"previous": None, "next": None})
    prev_id = ids[i - 1] if i > 0 else None
    next_id = ids[i + 1] if i < len(ids) - 1 else None
    return Response({"previous": prev_id, "next": next_id})


class AnnotationViewSet(viewsets.ModelViewSet):
    serializer_class = AnnotationSerializer

    def get_permissions(self):
        return [IsAuthenticated(), IsCompanyMember()]

    def get_queryset(self):
        iid = self.kwargs["image_pk"]
        qs = Annotation.objects.filter(
            image_id=iid,
            image__group__project__company_id=self.request.user.company_id,
            image__group__deleted_at__isnull=True,
            image__deleted_at__isnull=True,
        )
        user = self.request.user
        if not user_has_global_project_access(user) and getattr(user, "is_etiquetador", False):
            qs = qs.filter(image__group__assignments__labeler=user)
        return qs

    def perform_create(self, serializer):
        image = ProjectImage.objects.get(
            pk=self.kwargs["image_pk"],
            deleted_at__isnull=True,
            group__deleted_at__isnull=True,
            group__project__company_id=self.request.user.company_id,
        )
        if not user_can_annotate_image(self.request.user, image):
            raise PermissionDenied("No podés anotar esta imagen en su estado actual.")
        ann = serializer.save(image=image)
        self._sync_image_status(image)

    def perform_update(self, serializer):
        if not user_can_annotate_image(self.request.user, serializer.instance.image):
            raise PermissionDenied("No podés editar anotaciones en esta imagen.")
        ann = serializer.save()
        self._sync_image_status(ann.image)

    def perform_destroy(self, instance):
        image = instance.image
        if not user_can_annotate_image(self.request.user, image):
            raise PermissionDenied("No podés eliminar anotaciones en esta imagen.")
        super().perform_destroy(instance)
        self._sync_image_status(image)

    def _sync_image_status(self, image: ProjectImage):
        if image.status == ProjectImage.Status.COMPLETED:
            return
        if image.status == ProjectImage.Status.PENDING_VALIDATION:
            return
        has_ann = image.annotations.exists()
        if image.status == ProjectImage.Status.REJECTED:
            new_status = ProjectImage.Status.IN_PROGRESS if has_ann else ProjectImage.Status.PENDING
        else:
            new_status = ProjectImage.Status.IN_PROGRESS if has_ann else ProjectImage.Status.PENDING
        if image.status != new_status:
            image.status = new_status
            image.save(update_fields=["status", "updated_at"])

    @action(detail=False, methods=["put"], url_path="replace")
    def replace(self, request, project_pk=None, group_pk=None, image_pk=None):
        image = ProjectImage.objects.select_related("group__project").get(
            pk=image_pk,
            group_id=group_pk,
            group__project_id=project_pk,
            deleted_at__isnull=True,
            group__deleted_at__isnull=True,
            group__project__company_id=request.user.company_id,
        )
        if not user_can_annotate_image(request.user, image):
            raise PermissionDenied("No podés reemplazar anotaciones en esta imagen.")
        ser = AnnotationWriteItemSerializer(data=request.data, many=True)
        ser.is_valid(raise_exception=True)
        idx_map = {lc.id: lc for lc in LabelClass.objects.filter(project_id=project_pk)}
        Annotation.objects.filter(image=image).delete()
        for item in ser.validated_data:
            lc = idx_map.get(item["label_class_id"])
            if not lc:
                return Response({"detail": "Clase inválida"}, status=400)
            Annotation.objects.create(
                image=image,
                label_class=lc,
                x=item["x"],
                y=item["y"],
                width=item["width"],
                height=item["height"],
                created_by=request.user,
                updated_by=request.user,
            )
        if image.status != ProjectImage.Status.COMPLETED:
            image.status = (
                ProjectImage.Status.IN_PROGRESS if image.annotations.exists() else ProjectImage.Status.PENDING
            )
            image.updated_by = request.user
            image.save(update_fields=["status", "updated_at", "updated_by"])
        out = AnnotationSerializer(image.annotations.all(), many=True, context={"request": request})
        return Response(out.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsCompanyMember])
def find_similar_objects(request, project_pk, group_pk, image_pk):
    """Use objects annotated on a source image to find similar objects in the target image."""
    ser = FindSimilarRequestSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    source_image_id = ser.validated_data["source_image_id"]

    company_id = request.user.company_id

    try:
        target_image = ProjectImage.objects.select_related("group__project").get(
            pk=image_pk,
            group_id=group_pk,
            group__project_id=project_pk,
            deleted_at__isnull=True,
            group__deleted_at__isnull=True,
            group__project__company_id=company_id,
        )
    except ProjectImage.DoesNotExist:
        return Response({"detail": "Imagen destino no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    if not user_can_access_project_image(request.user, target_image):
        return Response({"detail": "Imagen destino no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    try:
        source_image = ProjectImage.objects.select_related("group__project").get(
            pk=source_image_id,
            deleted_at__isnull=True,
            group__deleted_at__isnull=True,
            group__project__company_id=company_id,
        )
    except ProjectImage.DoesNotExist:
        return Response({"detail": "Imagen origen no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    if not user_can_access_project_image(request.user, source_image):
        return Response({"detail": "Imagen origen no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    source_annotations = Annotation.objects.filter(image=source_image).select_related("label_class")
    if not source_annotations.exists():
        return Response({"detail": "La imagen origen no tiene anotaciones.", "detections": []})

    source_path = Path(settings.MEDIA_ROOT) / source_image.storage_path
    target_path = Path(settings.MEDIA_ROOT) / target_image.storage_path
    if not source_path.is_file() or not target_path.is_file():
        return Response(
            {"detail": "No se encontró el archivo de imagen en disco."},
            status=status.HTTP_404_NOT_FOUND,
        )

    from .similarity import get_finder
    from .similarity.base import SearchParams, SourceObject

    vd = ser.validated_data
    search_params = SearchParams(
        confidence_threshold=vd["confidence_threshold"],
        max_distance_px=vd.get("max_distance_px"),
        scale_min=vd["scale_min"],
        scale_max=vd["scale_max"],
        scale_steps=vd["scale_steps"],
        nms_iou_threshold=vd["nms_iou_threshold"],
        max_detections_per_object=vd["max_detections_per_object"],
    )

    objects = [
        SourceObject(
            label_class_id=ann.label_class_id,
            x=float(ann.x),
            y=float(ann.y),
            width=float(ann.width),
            height=float(ann.height),
        )
        for ann in source_annotations
    ]

    finder = get_finder()
    detections = finder.find(
        source_image_path=source_path,
        target_image_path=target_path,
        objects=objects,
        params=search_params,
    )

    out = DetectedObjectSerializer(
        [
            {
                "label_class_id": d.label_class_id,
                "x": d.x,
                "y": d.y,
                "width": d.width,
                "height": d.height,
                "confidence": d.confidence,
            }
            for d in detections
        ],
        many=True,
    )
    return Response({"detections": out.data, "source_image_id": source_image_id})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsCompanyMember, IsAsignadorOrAdministrador])
def upload_video(request, project_pk, group_pk):
    """Extract frames from a video and create ProjectImage records."""
    group = ImageGroup.objects.select_related("project").get(
        pk=group_pk,
        project_id=project_pk,
        project__company_id=request.user.company_id,
        deleted_at__isnull=True,
    )
    video_file = request.FILES.get("video")
    if not video_file:
        return Response({"detail": "No se envió un video (campo video)."}, status=status.HTTP_400_BAD_REQUEST)

    if video_file.size > settings.MAX_VIDEO_UPLOAD_BYTES:
        return Response(
            {"detail": f"El video supera el límite de {settings.MAX_VIDEO_UPLOAD_BYTES // (1024 * 1024)} MB."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    ext = Path(video_file.name).suffix.lower()
    mime = video_file.content_type or ""
    if ext not in settings.ALLOWED_VIDEO_EXTENSIONS and mime not in settings.ALLOWED_VIDEO_MIME:
        return Response(
            {"detail": "Formato de video no soportado. Usa MP4, MOV, AVI o WebM."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        fps_extract = float(request.data.get("fps", 1))
        if fps_extract <= 0 or fps_extract > 60:
            raise ValueError
    except (TypeError, ValueError):
        return Response({"detail": "fps debe ser un número entre 0.1 y 60."}, status=status.HTTP_400_BAD_REQUEST)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    try:
        for chunk in video_file.chunks():
            tmp.write(chunk)
        tmp.close()

        cap = cv2.VideoCapture(tmp.name)
        if not cap.isOpened():
            return Response({"detail": "No se pudo abrir el video."}, status=status.HTTP_400_BAD_REQUEST)

        video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration_sec = total_frames / video_fps if video_fps > 0 else 0
        frame_interval = max(1, int(round(video_fps / fps_extract)))

        media_root = Path(settings.MEDIA_ROOT)
        rel_base = Path("projects") / str(group.project_id) / "groups" / str(group.id)
        dest_dir = media_root / rel_base
        dest_dir.mkdir(parents=True, exist_ok=True)

        created = []
        frame_idx = 0
        extracted = 0
        original_name = Path(video_file.name).stem

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx % frame_interval == 0:
                safe_name = f"{uuid.uuid4().hex}.jpg"
                abs_path = dest_dir / safe_name
                cv2.imwrite(str(abs_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
                h, w = frame.shape[:2]
                rel_path = str(rel_base / safe_name).replace("\\", "/")
                pi = ProjectImage.objects.create(
                    group=group,
                    storage_path=rel_path,
                    original_filename=f"{original_name}_frame{frame_idx:06d}.jpg",
                    mime_type="image/jpeg",
                    file_size_bytes=os.path.getsize(abs_path),
                    width_px=w,
                    height_px=h,
                    status=ProjectImage.Status.PENDING,
                    created_by=request.user,
                    updated_by=request.user,
                )
                created.append(pi)
                extracted += 1
            frame_idx += 1

        cap.release()
    finally:
        os.unlink(tmp.name)

    ser = ProjectImageSerializer(created, many=True, context={"request": request})
    return Response(
        {
            "created": ser.data,
            "video_info": {
                "original_filename": video_file.name,
                "duration_seconds": round(duration_sec, 2),
                "video_fps": round(video_fps, 2),
                "total_video_frames": total_frames,
                "extract_fps": fps_extract,
                "frames_extracted": extracted,
            },
        },
        status=status.HTTP_201_CREATED,
    )


class DatasetVersionViewSet(viewsets.ModelViewSet):
    serializer_class = DatasetVersionSerializer
    queryset = DatasetVersion.objects.none()

    def get_queryset(self):
        pid = self.kwargs["project_pk"]
        return DatasetVersion.objects.filter(
            project_id=pid,
            project__company_id=self.request.user.company_id,
            deleted_at__isnull=True,
        ).annotate(images_count=Count("version_images"))

    def get_permissions(self):
        if self.action == "export_yolov8":
            return [IsAuthenticated(), IsCompanyMember(), CanExportDataset()]
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsCompanyMember()]
        return [IsAuthenticated(), IsCompanyMember(), IsAsignadorOrAdministrador()]

    def create(self, request, *args, **kwargs):
        project = Project.objects.get(
            pk=self.kwargs["project_pk"],
            company_id=request.user.company_id,
            deleted_at__isnull=True,
        )
        ser = DatasetVersionCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        images = collect_images(
            project,
            group_ids=data.get("group_ids"),
            only_completed=data.get("only_completed", True),
        )
        if not images:
            return Response({"detail": "No hay imágenes elegibles."}, status=400)

        dv = DatasetVersion.objects.create(
            project=project,
            name=data["name"],
            notes=data.get("notes") or "",
            artifact_status=DatasetVersion.ArtifactStatus.PENDING,
            created_by=request.user,
        )
        for im in images:
            DatasetVersionImage.objects.create(dataset_version=dv, project_image=im)

        try:
            aug = data.get("augmentations") or {}
            if data.get("split_train") is not None:
                raw, size = build_yolo_zip_bytes(
                    project,
                    images,
                    train_val_split=None,
                    split_train=data["split_train"],
                    split_test=data["split_test"],
                    split_val=data["split_val"],
                    augmentations=aug,
                )
            else:
                raw, size = build_yolo_zip_bytes(
                    project,
                    images,
                    train_val_split=float(data.get("train_val_split", 0.8)),
                    augmentations=aug,
                )
        except ValueError as e:
            dv.artifact_status = DatasetVersion.ArtifactStatus.FAILED
            dv.save(update_fields=["artifact_status", "updated_at"])
            return Response({"detail": str(e)}, status=400)
        except (FileNotFoundError, OSError) as e:
            dv.artifact_status = DatasetVersion.ArtifactStatus.FAILED
            dv.save(update_fields=["artifact_status", "updated_at"])
            return Response(
                {
                    "detail": (
                        "No se pudo leer un archivo de imagen en el servidor (¿falta el fichero en disco o "
                        f"la ruta de medios?). Detalle: {e}"
                    ),
                },
                status=400,
            )

        export_dir = Path(settings.MEDIA_ROOT) / "exports" / str(project.id)
        try:
            export_dir.mkdir(parents=True, exist_ok=True)
            zip_name = f"version_{dv.pk}.zip"
            zip_path = export_dir / zip_name
            zip_path.write_bytes(raw)
        except OSError as e:
            dv.artifact_status = DatasetVersion.ArtifactStatus.FAILED
            dv.save(update_fields=["artifact_status", "updated_at"])
            return Response({"detail": f"No se pudo guardar el ZIP de exportación: {e}"}, status=400)
        rel = str(Path("exports") / str(project.id) / zip_name).replace("\\", "/")
        dv.artifact_storage_path = rel
        dv.artifact_size_bytes = size
        dv.artifact_status = DatasetVersion.ArtifactStatus.READY
        dv.save(update_fields=["artifact_storage_path", "artifact_size_bytes", "artifact_status", "updated_at"])
        out = DatasetVersionSerializer(dv, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at", "updated_at"])

    @action(detail=True, methods=["get"], url_path="export/yolov8")
    def export_yolov8(self, request, project_pk=None, pk=None):
        dv = self.get_object()
        if dv.artifact_status != DatasetVersion.ArtifactStatus.READY or not dv.artifact_storage_path:
            return Response({"detail": "El ZIP no está disponible."}, status=400)
        path = Path(settings.MEDIA_ROOT) / dv.artifact_storage_path
        if not path.is_file():
            return Response({"detail": "Archivo no encontrado."}, status=404)
        return FileResponse(open(path, "rb"), as_attachment=True, filename=f"dataset_{dv.pk}.zip")


