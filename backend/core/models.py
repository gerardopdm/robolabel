"""Modelos de dominio RoboLabel (multiempresa, proyectos, grupos, imágenes, anotaciones, versiones)."""
from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models


class Company(models.Model):
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "companies"

    def __str__(self):
        return self.name


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("El email es obligatorio")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        extra_fields.setdefault("is_administrador", True)
        if extra_fields.get("company_id") is None:
            company, _ = Company.objects.get_or_create(name="Sistema")
            extra_fields["company"] = company
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True, max_length=254)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="users")
    is_administrador = models.BooleanField(
        default=False,
        help_text="Gestión amplia y acceso al sitio de administración Django (is_staff sincronizado).",
    )
    is_asignador = models.BooleanField(
        default=False,
        help_text="Subida de imágenes, asignación a etiquetadores y creación de versiones de dataset.",
    )
    is_etiquetador = models.BooleanField(
        default=False,
        help_text="Etiquetado en imágenes de grupos asignados.",
    )
    is_validador = models.BooleanField(
        default=False,
        help_text="Aprobación o rechazo de imágenes en revisión; transición a completada.",
    )
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        ordering = ["email"]

    def __str__(self):
        return self.email

    def save(self, *args, **kwargs):
        if not self.is_superuser:
            self.is_staff = bool(self.is_administrador)
        super().save(*args, **kwargs)


class Project(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="projects")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    task_type = models.CharField(max_length=64, default="object_detection")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="projects_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="projects_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        indexes = [
            models.Index(fields=["company", "deleted_at"]),
        ]

    def __str__(self):
        return self.name


class ImageGroup(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="groups")
    name = models.CharField(max_length=255)
    sort_order = models.IntegerField(default=0)
    detection_filter = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="Active detection filter name (empty = none).",
    )
    detection_filter_params = models.JSONField(
        default=dict,
        blank=True,
        help_text="Parameters for the selected detection filter (schema varies per filter).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["sort_order", "id"]
        indexes = [
            models.Index(fields=["project", "deleted_at"]),
        ]

    def __str__(self):
        return f"{self.project.name} / {self.name}"


class GroupAssignment(models.Model):
    """Asigna un grupo de imágenes a un etiquetador (docs/arquitectura-permisos.md)."""

    image_group = models.ForeignKey(ImageGroup, on_delete=models.CASCADE, related_name="assignments")
    labeler = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="group_assignments",
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="group_assignments_made",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["image_group", "labeler"],
                name="uniq_group_assignment_labeler",
            ),
        ]
        ordering = ["id"]

    def __str__(self):
        return f"{self.image_group_id} → {self.labeler_id}"


class LabelClass(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="label_classes")
    name = models.CharField(max_length=255)
    color_hex = models.CharField(max_length=7, blank=True, default="#3B82F6")
    sort_index = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_index", "id"]
        constraints = [
            models.UniqueConstraint(fields=["project", "name"], name="uniq_label_class_per_project"),
        ]

    def __str__(self):
        return f"{self.name}"


class ProjectImage(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente"
        IN_PROGRESS = "in_progress", "En progreso"
        PENDING_VALIDATION = "pending_validation", "En validación"
        COMPLETED = "completed", "Completada"
        REJECTED = "rejected", "Rechazada"

    group = models.ForeignKey(ImageGroup, on_delete=models.CASCADE, related_name="images")
    storage_path = models.CharField(max_length=512)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=64)
    file_size_bytes = models.BigIntegerField()
    width_px = models.IntegerField()
    height_px = models.IntegerField()
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.PENDING,
    )
    discarded_for_dataset = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Si es True, la imagen no se incluye al generar exportaciones ZIP / dataset de entrenamiento.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="images_uploaded",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="images_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["group", "status"]),
        ]

    @property
    def project(self):
        return self.group.project


class ValidationRecord(models.Model):
    """Historial de decisiones de validación sobre una imagen."""

    class Decision(models.TextChoices):
        APPROVED = "approved", "Aprobada"
        REJECTED = "rejected", "Rechazada"

    image = models.ForeignKey(ProjectImage, on_delete=models.CASCADE, related_name="validation_records")
    validator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="validation_records",
    )
    decision = models.CharField(max_length=16, choices=Decision.choices)
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class Annotation(models.Model):
    image = models.ForeignKey(ProjectImage, on_delete=models.CASCADE, related_name="annotations")
    label_class = models.ForeignKey(LabelClass, on_delete=models.CASCADE, related_name="annotations")
    x = models.DecimalField(max_digits=12, decimal_places=4)
    y = models.DecimalField(max_digits=12, decimal_places=4)
    width = models.DecimalField(max_digits=12, decimal_places=4)
    height = models.DecimalField(max_digits=12, decimal_places=4)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="annotations_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="annotations_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]


class DatasetVersion(models.Model):
    class ArtifactStatus(models.TextChoices):
        PENDING = "pending", "Pendiente"
        READY = "ready", "Listo"
        FAILED = "failed", "Error"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="dataset_versions")
    name = models.CharField(max_length=255)
    notes = models.TextField(blank=True)
    artifact_status = models.CharField(
        max_length=32,
        choices=ArtifactStatus.choices,
        default=ArtifactStatus.PENDING,
    )
    artifact_storage_path = models.CharField(max_length=512, blank=True)
    artifact_size_bytes = models.BigIntegerField(null=True, blank=True)
    exported_image_count = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Imágenes en el ZIP (train con aumentos + test + val).",
    )
    class_breakdown = models.JSONField(
        default=list,
        blank=True,
        help_text="Lista [{label_class_id, name, images_count}] al crear la versión.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="dataset_versions_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class DatasetVersionImage(models.Model):
    dataset_version = models.ForeignKey(
        DatasetVersion,
        on_delete=models.CASCADE,
        related_name="version_images",
    )
    project_image = models.ForeignKey(
        ProjectImage,
        on_delete=models.CASCADE,
        related_name="version_memberships",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["dataset_version", "project_image"],
                name="uniq_version_image_membership",
            ),
        ]
