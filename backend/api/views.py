"""Vistas API REST RoboLabel."""
from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

import cv2
from django.conf import settings
from django.db.models import Count, Prefetch, Q
from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
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

from .export_service import (
    build_yolo_zip_bytes,
    collect_images,
    compute_class_breakdown,
    count_exported_images_in_zip,
)
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
    ApplyFilterRequestSerializer,
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

        S = ProjectImage.Status
        labelers_by_group: dict[int, list[dict]] = {}
        for a in (
            GroupAssignment.objects.filter(
                image_group__project=project,
                image_group__deleted_at__isnull=True,
            )
            .select_related("labeler")
            .order_by("image_group_id", "id")
        ):
            lb = a.labeler
            display = " ".join(x for x in (lb.first_name or "", lb.last_name or "") if x).strip()
            labelers_by_group.setdefault(a.image_group_id, []).append(
                {
                    "id": a.id,
                    "email": lb.email,
                    "display_name": display or lb.email,
                },
            )

        by_group = []
        for g in ImageGroup.objects.filter(project=project, deleted_at__isnull=True).annotate(
            ic=Count("images", filter=Q(images__deleted_at__isnull=True)),
            cc=Count(
                "images",
                filter=Q(images__deleted_at__isnull=True, images__status=S.COMPLETED),
            ),
            pendientes=Count(
                "images",
                filter=Q(
                    images__deleted_at__isnull=True,
                    images__status__in=(S.PENDING, S.IN_PROGRESS, S.REJECTED),
                ),
            ),
            pending_validation=Count(
                "images",
                filter=Q(images__deleted_at__isnull=True, images__status=S.PENDING_VALIDATION),
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
                    "pendientes": g.pendientes,
                    "pending_validation": g.pending_validation,
                    "validadas": g.cc,
                    "images_by_class": images_by_class,
                    "labelers": labelers_by_group.get(g.id, []),
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
    """Anotaciones de una sola imagen: siempre devolver la lista completa (sin paginar)."""

    serializer_class = AnnotationSerializer
    pagination_class = None

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
def clear_group_annotations(request, project_pk, group_pk):
    """Elimina todas las anotaciones del grupo y deja cada imagen en estado pendiente."""
    group = get_object_or_404(
        ImageGroup,
        pk=group_pk,
        project_id=project_pk,
        project__company_id=request.user.company_id,
        deleted_at__isnull=True,
    )
    qs = ProjectImage.objects.filter(group=group, deleted_at__isnull=True)
    image_ids = list(qs.values_list("id", flat=True))
    if not image_ids:
        return Response({"deleted_annotations": 0, "images_updated": 0})

    ann_qs = Annotation.objects.filter(image_id__in=image_ids)
    n_ann = ann_qs.count()
    with transaction.atomic():
        ann_qs.delete()
        updated = qs.update(
            status=ProjectImage.Status.PENDING,
            updated_by=request.user,
        )

    return Response(
        {
            "deleted_annotations": n_ann,
            "images_updated": updated,
        },
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsCompanyMember, IsAsignadorOrAdministrador])
def delete_all_group_images(request, project_pk, group_pk):
    """Marca como eliminadas todas las imágenes del grupo (soft delete) y borra anotaciones asociadas."""
    group = get_object_or_404(
        ImageGroup,
        pk=group_pk,
        project_id=project_pk,
        project__company_id=request.user.company_id,
        deleted_at__isnull=True,
    )
    qs = ProjectImage.objects.filter(group=group, deleted_at__isnull=True)
    image_ids = list(qs.values_list("id", flat=True))
    if not image_ids:
        return Response({"deleted_images": 0})

    now = timezone.now()
    with transaction.atomic():
        Annotation.objects.filter(image_id__in=image_ids).delete()
        ValidationRecord.objects.filter(image_id__in=image_ids).delete()
        n = qs.update(deleted_at=now, updated_by=request.user, updated_at=now)

    return Response({"deleted_images": n})


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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_filters(request):
    """Return every registered detection filter with its param specs."""
    from .filters import get_available_filters

    filters = get_available_filters()
    data = [f.to_dict() for f in filters.values()]
    return Response(data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_yolo_models(request):
    """Return available YOLO .pt model files."""
    from .filters.yolo_detection import list_model_files

    return Response({"models": list_model_files()})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def yolo_model_classes(request, model_name):
    """Return the class names of a specific YOLO model."""
    from .filters.yolo_detection import get_model_class_names

    classes = get_model_class_names(model_name)
    return Response({"model": model_name, "classes": classes})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsCompanyMember])
def apply_filter(request, project_pk, group_pk, image_pk):
    """Run a detection filter on a single image and return bounding boxes."""
    ser = ApplyFilterRequestSerializer(data=request.data)
    ser.is_valid(raise_exception=True)

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
        return Response({"detail": "Imagen no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    if not user_can_access_project_image(request.user, target_image):
        return Response({"detail": "Imagen no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    target_path = Path(settings.MEDIA_ROOT) / target_image.storage_path
    if not target_path.is_file():
        return Response(
            {"detail": "No se encontró el archivo de imagen en disco."},
            status=status.HTTP_404_NOT_FOUND,
        )

    from .filters import get_filter

    try:
        filt = get_filter(ser.validated_data["filter_name"])
    except ValueError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    params = filt.coerce_params(ser.validated_data.get("params", {}))
    detections = filt.apply(target_path, params)

    label_class_id = ser.validated_data.get("label_class_id")
    out = DetectedObjectSerializer(
        [
            {
                "label_class_id": label_class_id or 0,
                "x": d.x,
                "y": d.y,
                "width": d.width,
                "height": d.height,
                "confidence": d.confidence,
                "class_name": getattr(d, "class_name", ""),
            }
            for d in detections
        ],
        many=True,
    )
    return Response({"detections": out.data, "count": len(detections)})


def _draw_boxes_on_image(img_cv, detections, count_label=True):
    """Draw detection boxes on an image (mutates img_cv in-place)."""
    h_img, w_img = img_cv.shape[:2]
    for i, det in enumerate(detections, 1):
        x1 = int(det.x * w_img)
        y1 = int(det.y * h_img)
        x2 = int((det.x + det.width) * w_img)
        y2 = int((det.y + det.height) * h_img)
        cv2.rectangle(img_cv, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cls_name = getattr(det, "class_name", "")
        label = f"{cls_name} #{i}" if cls_name else f"#{i}"
        conf = getattr(det, "confidence", None)
        if conf is not None and conf < 1.0:
            label += f" {conf:.0%}"
        cv2.putText(
            img_cv,
            label,
            (x1, max(15, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (0, 255, 0),
            1,
        )
    if count_label:
        cv2.putText(
            img_cv,
            f"{len(detections)} objetos",
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 255, 0),
            2,
        )
    return img_cv


def _draw_roi_overlay(img_cv, params):
    """Draw ROI rectangle and dim the outside region. Does nothing if ROI is the full image."""
    import numpy as np

    roi_x = int(params.get("roi_x", 0))
    roi_y = int(params.get("roi_y", 0))
    roi_w = int(params.get("roi_w", 100))
    roi_h = int(params.get("roi_h", 100))

    if roi_x == 0 and roi_y == 0 and roi_w >= 100 and roi_h >= 100:
        return img_cv

    h_img, w_img = img_cv.shape[:2]
    rx1 = int(round(roi_x / 100.0 * w_img))
    ry1 = int(round(roi_y / 100.0 * h_img))
    rx2 = min(w_img, int(round((roi_x + roi_w) / 100.0 * w_img)))
    ry2 = min(h_img, int(round((roi_y + roi_h) / 100.0 * h_img)))

    overlay = img_cv.copy()
    cv2.rectangle(overlay, (0, 0), (w_img, ry1), (0, 0, 0), -1)
    cv2.rectangle(overlay, (0, ry2), (w_img, h_img), (0, 0, 0), -1)
    cv2.rectangle(overlay, (0, ry1), (rx1, ry2), (0, 0, 0), -1)
    cv2.rectangle(overlay, (rx2, ry1), (w_img, ry2), (0, 0, 0), -1)
    img_cv[:] = cv2.addWeighted(overlay, 0.5, img_cv, 0.5, 0)
    cv2.rectangle(img_cv, (rx1, ry1), (rx2, ry2), (0, 255, 255), 2)
    return img_cv


def _build_debug_mosaic(original_bgr, debug_steps, detections):
    """Build a labelled grid of intermediate images + final result."""
    import math

    import numpy as np

    h_orig, w_orig = original_bgr.shape[:2]

    cell_w = min(w_orig, 480)
    scale = cell_w / w_orig
    cell_h = int(h_orig * scale)

    panels: list[tuple[str, "np.ndarray"]] = []

    panels.append(("Original", original_bgr))

    for step in debug_steps:
        panels.append((step.label, step.image))

    result_img = original_bgr.copy()
    _draw_boxes_on_image(result_img, detections, count_label=False)
    panels.append((f"Resultado ({len(detections)})", result_img))

    cols = min(4, len(panels))
    rows = math.ceil(len(panels) / cols)
    label_h = 28
    total_cell_h = cell_h + label_h
    mosaic = np.full((rows * total_cell_h, cols * cell_w, 3), 40, dtype=np.uint8)

    for idx, (label, panel_img) in enumerate(panels):
        r, c = divmod(idx, cols)
        y_off = r * total_cell_h
        x_off = c * cell_w

        if len(panel_img.shape) == 2:
            panel_bgr = cv2.cvtColor(panel_img, cv2.COLOR_GRAY2BGR)
        else:
            panel_bgr = panel_img

        resized = cv2.resize(panel_bgr, (cell_w, cell_h), interpolation=cv2.INTER_AREA)
        mosaic[y_off : y_off + cell_h, x_off : x_off + cell_w] = resized

        label_y = y_off + cell_h + 20
        cv2.putText(
            mosaic,
            label,
            (x_off + 6, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (220, 220, 220),
            1,
            cv2.LINE_AA,
        )

    return mosaic


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsCompanyMember])
def filter_preview(request, project_pk, group_pk):
    """Run a filter on an image and return a preview image (JPEG).

    Modes (sent as ``mode`` in the request body):
    - ``"result"`` (default): image with green detection boxes drawn on it.
    - ``"original_boxes"``: original image with translucent boxes (no processing overlays).
    - ``"debug"``: mosaic grid showing each intermediate processing step.
    """
    image_id = request.data.get("image_id")
    filter_name = request.data.get("filter_name", "")
    params_raw = request.data.get("params", {})
    mode = request.data.get("mode", "result")

    if not image_id or not filter_name:
        return Response(
            {"detail": "Se requieren image_id y filter_name."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    company_id = request.user.company_id

    try:
        img_obj = ProjectImage.objects.select_related("group__project").get(
            pk=image_id,
            group_id=group_pk,
            group__project_id=project_pk,
            deleted_at__isnull=True,
            group__deleted_at__isnull=True,
            group__project__company_id=company_id,
        )
    except ProjectImage.DoesNotExist:
        return Response({"detail": "Imagen no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    if not user_can_access_project_image(request.user, img_obj):
        return Response({"detail": "Imagen no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    img_path = Path(settings.MEDIA_ROOT) / img_obj.storage_path
    if not img_path.is_file():
        return Response(
            {"detail": "No se encontró el archivo de imagen en disco."},
            status=status.HTTP_404_NOT_FOUND,
        )

    from .filters import get_filter

    try:
        filt = get_filter(filter_name)
    except ValueError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    params = filt.coerce_params(params_raw)
    img_cv = cv2.imread(str(img_path))
    from django.http import HttpResponse

    if mode == "debug":
        result = filt.apply_with_debug(img_path, params)
        mosaic = _build_debug_mosaic(img_cv, result.debug_steps, result.detections)
        _, buf = cv2.imencode(".jpg", mosaic, [cv2.IMWRITE_JPEG_QUALITY, 90])
        resp = HttpResponse(buf.tobytes(), content_type="image/jpeg")
        resp["X-Detection-Count"] = str(len(result.detections))
        return resp

    if mode == "original_boxes":
        import numpy as np

        detections = filt.apply(img_path, params)
        overlay = img_cv.copy()
        h_img, w_img = img_cv.shape[:2]
        for det in detections:
            x1 = int(det.x * w_img)
            y1 = int(det.y * h_img)
            x2 = int((det.x + det.width) * w_img)
            y2 = int((det.y + det.height) * h_img)
            cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 255, 0), -1)
        alpha = 0.25
        blended = cv2.addWeighted(overlay, alpha, img_cv, 1 - alpha, 0)
        _draw_roi_overlay(blended, params)
        _draw_boxes_on_image(blended, detections)
        _, buf = cv2.imencode(".jpg", blended, [cv2.IMWRITE_JPEG_QUALITY, 90])
        resp = HttpResponse(buf.tobytes(), content_type="image/jpeg")
        resp["X-Detection-Count"] = str(len(detections))
        return resp

    # mode == "result" (default)
    detections = filt.apply(img_path, params)
    _draw_roi_overlay(img_cv, params)
    _draw_boxes_on_image(img_cv, detections)
    _, buf = cv2.imencode(".jpg", img_cv, [cv2.IMWRITE_JPEG_QUALITY, 85])
    resp = HttpResponse(buf.tobytes(), content_type="image/jpeg")
    resp["X-Detection-Count"] = str(len(detections))
    return resp


class DatasetVersionViewSet(viewsets.ModelViewSet):
    serializer_class = DatasetVersionSerializer
    queryset = DatasetVersion.objects.none()

    def get_queryset(self):
        pid = self.kwargs["project_pk"]
        return (
            DatasetVersion.objects.filter(
                project_id=pid,
                project__company_id=self.request.user.company_id,
                deleted_at__isnull=True,
            )
            .annotate(images_count=Count("version_images"))
            .order_by("-created_at")
        )

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
                exported_n = count_exported_images_in_zip(
                    images,
                    split_train=data["split_train"],
                    split_test=data["split_test"],
                    split_val=data["split_val"],
                    augmentations=aug,
                )
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
                exported_n = count_exported_images_in_zip(
                    images,
                    train_val_split=float(data.get("train_val_split", 0.8)),
                    augmentations=aug,
                )
                raw, size = build_yolo_zip_bytes(
                    project,
                    images,
                    train_val_split=float(data.get("train_val_split", 0.8)),
                    augmentations=aug,
                )
            class_breakdown = compute_class_breakdown(project, images)
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
        dv.exported_image_count = exported_n
        dv.class_breakdown = class_breakdown
        dv.artifact_status = DatasetVersion.ArtifactStatus.READY
        dv.save(
            update_fields=[
                "artifact_storage_path",
                "artifact_size_bytes",
                "exported_image_count",
                "class_breakdown",
                "artifact_status",
                "updated_at",
            ]
        )
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


