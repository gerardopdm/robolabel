from decimal import Decimal

from django.conf import settings
from rest_framework import serializers

from core.models import (
    Annotation,
    Company,
    DatasetVersion,
    GroupAssignment,
    ImageGroup,
    LabelClass,
    Project,
    ProjectImage,
    User,
)


class CompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ("id", "name")


class UserMeSerializer(serializers.ModelSerializer):
    company = CompanySerializer(read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "is_administrador",
            "is_asignador",
            "is_etiquetador",
            "is_validador",
            "company",
        )


class UserListSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "is_administrador",
            "is_asignador",
            "is_etiquetador",
            "is_validador",
            "is_active",
            "created_at",
        )


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8, style={"input_type": "password"})

    class Meta:
        model = User
        fields = (
            "email",
            "password",
            "first_name",
            "last_name",
            "is_administrador",
            "is_asignador",
            "is_etiquetador",
            "is_validador",
        )

    def create(self, validated_data):
        password = validated_data.pop("password")
        request = self.context["request"]
        email = validated_data.pop("email")
        return User.objects.create_user(
            email=email,
            password=password,
            company=request.user.company,
            **validated_data,
        )


class UserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "first_name",
            "last_name",
            "is_administrador",
            "is_asignador",
            "is_etiquetador",
            "is_validador",
            "is_active",
        )

    def validate(self, attrs):
        request = self.context.get("request")
        instance = self.instance
        if request and instance and instance.pk == request.user.pk:
            if attrs.get("is_administrador") is False and instance.is_administrador:
                raise serializers.ValidationError(
                    {"is_administrador": "No podés quitarte el rol de administrador a vos mismo."},
                )
        return attrs


class ProjectListSerializer(serializers.ModelSerializer):
    groups_count = serializers.IntegerField(read_only=True)
    images_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Project
        fields = (
            "id",
            "name",
            "description",
            "task_type",
            "created_at",
            "updated_at",
            "groups_count",
            "images_count",
        )


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = (
            "id",
            "name",
            "description",
            "task_type",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("task_type",)

    def create(self, validated_data):
        request = self.context["request"]
        validated_data["company_id"] = request.user.company_id
        validated_data["created_by"] = request.user
        validated_data["updated_by"] = request.user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data["updated_by"] = self.context["request"].user
        return super().update(instance, validated_data)


class ImageGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImageGroup
        fields = ("id", "project", "name", "sort_order", "created_at", "updated_at")
        read_only_fields = ("project",)

    def create(self, validated_data):
        from core.models import Project

        project = Project.objects.get(
            pk=self.context["project_id"],
            company_id=self.context["request"].user.company_id,
            deleted_at__isnull=True,
        )
        validated_data["project"] = project
        return super().create(validated_data)


class GroupAssignmentSerializer(serializers.ModelSerializer):
    labeler_email = serializers.EmailField(source="labeler.email", read_only=True)
    assigned_by_email = serializers.SerializerMethodField()

    class Meta:
        model = GroupAssignment
        fields = (
            "id",
            "image_group",
            "labeler",
            "labeler_email",
            "assigned_by",
            "assigned_by_email",
            "created_at",
        )
        read_only_fields = ("id", "image_group", "assigned_by", "created_at", "labeler_email", "assigned_by_email")

    def get_assigned_by_email(self, obj):
        return obj.assigned_by.email if obj.assigned_by_id else None

    def validate_labeler(self, value: User):
        if not value.is_etiquetador:
            raise serializers.ValidationError("El usuario debe tener rol de etiquetador.")
        request = self.context.get("request")
        if request and value.company_id != request.user.company_id:
            raise serializers.ValidationError("El etiquetador debe ser de la misma empresa.")
        return value

    def create(self, validated_data):
        validated_data["assigned_by"] = self.context["request"].user
        gid = self.context["image_group_id"]
        from core.models import ImageGroup

        group = ImageGroup.objects.get(
            pk=gid,
            project_id=self.context["project_id"],
            project__company_id=self.context["request"].user.company_id,
            deleted_at__isnull=True,
        )
        validated_data["image_group"] = group
        return super().create(validated_data)


class ProjectImageSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    annotation_count = serializers.IntegerField(read_only=True, required=False)
    annotations_preview = serializers.SerializerMethodField()

    class Meta:
        model = ProjectImage
        fields = (
            "id",
            "group",
            "storage_path",
            "original_filename",
            "mime_type",
            "file_size_bytes",
            "width_px",
            "height_px",
            "status",
            "discarded_for_dataset",
            "created_at",
            "updated_at",
            "file_url",
            "annotation_count",
            "annotations_preview",
        )
        read_only_fields = (
            "group",
            "storage_path",
            "mime_type",
            "file_size_bytes",
            "width_px",
            "height_px",
            "created_at",
            "updated_at",
        )

    def get_file_url(self, obj):
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(f"/api/v1/images/{obj.pk}/file/")
        return f"/api/v1/images/{obj.pk}/file/"

    def get_annotations_preview(self, obj):
        """Cajas en coordenadas de píxeles de la imagen (mismo sistema que el lienzo de anotación)."""
        return [
            {
                "label_class_id": a.label_class_id,
                "x": format(a.x, "f"),
                "y": format(a.y, "f"),
                "width": format(a.width, "f"),
                "height": format(a.height, "f"),
            }
            for a in obj.annotations.all()
        ]

    def validate(self, attrs):
        # group_id inmutable en actualización
        if self.instance is not None and "group" in self.initial_data:
            raise serializers.ValidationError({"group": "No se puede cambiar el grupo de una imagen."})
        return attrs


class ProjectImageUpdateSerializer(serializers.ModelSerializer):
    validation_comment = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = ProjectImage
        fields = ("status", "discarded_for_dataset", "validation_comment")

    def validate(self, attrs):
        from api.mixins import user_can_validate_image

        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError("Autenticación requerida.")
        instance = self.instance
        old_status = instance.status
        new_status = attrs.get("status", old_status)

        if "discarded_for_dataset" in attrs and attrs["discarded_for_dataset"] != instance.discarded_for_dataset:
            if not (getattr(user, "is_administrador", False) or getattr(user, "is_asignador", False)):
                raise serializers.ValidationError(
                    {"discarded_for_dataset": "Solo administrador o asignador pueden cambiar este campo."},
                )

        if new_status == old_status:
            return attrs

        S = ProjectImage.Status
        if getattr(user, "is_administrador", False):
            return attrs

        # Enviar a validación (etiquetador)
        if new_status == S.PENDING_VALIDATION and old_status in (S.PENDING, S.IN_PROGRESS):
            if not getattr(user, "is_etiquetador", False):
                raise serializers.ValidationError({"status": "Solo un etiquetador puede enviar a validación."})
            return attrs

        # Rechazada → en progreso
        if new_status == S.IN_PROGRESS and old_status == S.REJECTED:
            if not getattr(user, "is_etiquetador", False):
                raise serializers.ValidationError({"status": "Solo un etiquetador puede reabrir una imagen rechazada."})
            return attrs

        # Decisiones de validación
        if old_status == S.PENDING_VALIDATION and new_status in (S.COMPLETED, S.REJECTED):
            if not user_can_validate_image(user):
                raise serializers.ValidationError({"status": "Solo un validador o administrador puede aprobar o rechazar."})
            return attrs

        # Devolver al etiquetador para corregir (sin pasar por rechazado formal)
        if old_status == S.PENDING_VALIDATION and new_status == S.IN_PROGRESS:
            if not user_can_validate_image(user):
                raise serializers.ValidationError(
                    {"status": "Solo un validador o administrador puede devolver la imagen a edición."},
                )
            return attrs

        if old_status == S.COMPLETED and new_status == S.PENDING_VALIDATION:
            if not user_can_validate_image(user):
                raise serializers.ValidationError({"status": "Solo un validador o administrador puede reabrir una imagen completada."})
            return attrs

        raise serializers.ValidationError({"status": "Transición de estado no permitida."})


class LabelClassSerializer(serializers.ModelSerializer):
    annotation_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = LabelClass
        fields = (
            "id",
            "project",
            "name",
            "color_hex",
            "sort_index",
            "created_at",
            "updated_at",
            "annotation_count",
        )
        read_only_fields = ("project",)

    def create(self, validated_data):
        from core.models import Project

        project = Project.objects.get(
            pk=self.context["project_id"],
            company_id=self.context["request"].user.company_id,
            deleted_at__isnull=True,
        )
        validated_data["project"] = project
        return super().create(validated_data)

    def validate_name(self, value):
        project_id = self.context.get("project_id")
        qs = LabelClass.objects.filter(project_id=project_id, name=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ya existe una clase con este nombre en el proyecto.")
        return value


class AnnotationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Annotation
        fields = (
            "id",
            "image",
            "label_class",
            "x",
            "y",
            "width",
            "height",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("image",)

    def validate(self, attrs):
        image = attrs.get("image") or (self.instance.image if self.instance else None)
        label_class = attrs.get("label_class") or (self.instance.label_class if self.instance else None)
        if image and label_class and label_class.project_id != image.group.project_id:
            raise serializers.ValidationError("La clase debe pertenecer al mismo proyecto que la imagen.")
        for key in ("x", "y", "width", "height"):
            v = attrs.get(key)
            if v is not None and v < 0:
                raise serializers.ValidationError({key: "Valores no negativos."})
        return attrs

    def create(self, validated_data):
        validated_data["created_by"] = self.context["request"].user
        validated_data["updated_by"] = self.context["request"].user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data["updated_by"] = self.context["request"].user
        return super().update(instance, validated_data)


class AnnotationWriteItemSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False, allow_null=True)
    label_class_id = serializers.IntegerField()
    x = serializers.DecimalField(max_digits=12, decimal_places=4)
    y = serializers.DecimalField(max_digits=12, decimal_places=4)
    width = serializers.DecimalField(max_digits=12, decimal_places=4)
    height = serializers.DecimalField(max_digits=12, decimal_places=4)


class FindSimilarRequestSerializer(serializers.Serializer):
    source_image_id = serializers.IntegerField()
    confidence_threshold = serializers.FloatField(default=0.55, min_value=0.1, max_value=0.99)
    max_distance_px = serializers.FloatField(required=False, default=None, allow_null=True, min_value=1)
    scale_min = serializers.FloatField(default=0.7, min_value=0.1, max_value=3.0)
    scale_max = serializers.FloatField(default=1.35, min_value=0.1, max_value=3.0)
    scale_steps = serializers.IntegerField(default=7, min_value=1, max_value=20)
    nms_iou_threshold = serializers.FloatField(default=0.4, min_value=0.05, max_value=0.95)
    max_detections_per_object = serializers.IntegerField(default=5, min_value=1, max_value=50)


class DetectedObjectSerializer(serializers.Serializer):
    label_class_id = serializers.IntegerField()
    x = serializers.FloatField()
    y = serializers.FloatField()
    width = serializers.FloatField()
    height = serializers.FloatField()
    confidence = serializers.FloatField()


class DatasetVersionSerializer(serializers.ModelSerializer):
    images_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = DatasetVersion
        fields = (
            "id",
            "project",
            "name",
            "notes",
            "artifact_status",
            "artifact_storage_path",
            "artifact_size_bytes",
            "exported_image_count",
            "class_breakdown",
            "created_at",
            "updated_at",
            "images_count",
        )
        read_only_fields = (
            "project",
            "artifact_status",
            "artifact_storage_path",
            "artifact_size_bytes",
            "exported_image_count",
            "class_breakdown",
        )


class DatasetVersionCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    notes = serializers.CharField(required=False, allow_blank=True)
    group_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    only_completed = serializers.BooleanField(default=True)
    train_val_split = serializers.FloatField(required=False, default=0.8, min_value=0.01, max_value=0.99)
    split_train = serializers.FloatField(required=False, min_value=0.0, max_value=1.0)
    split_test = serializers.FloatField(required=False, min_value=0.0, max_value=1.0)
    split_val = serializers.FloatField(required=False, min_value=0.0, max_value=1.0)
    augmentations = serializers.DictField(required=False, default=dict)

    def validate(self, data):
        st = data.get("split_train")
        ste = data.get("split_test")
        sv = data.get("split_val")
        has_triple = st is not None or ste is not None or sv is not None
        if has_triple:
            if st is None or ste is None or sv is None:
                raise serializers.ValidationError(
                    {"split_train": "Enviá split_train, split_test y split_val juntos, o ninguno (y usá train_val_split)."}
                )
            s = st + ste + sv
            if abs(s - 1.0) > 0.001:
                raise serializers.ValidationError(
                    "Las proporciones train + test + valid deben sumar 1 (100 %)."
                )
        return data
