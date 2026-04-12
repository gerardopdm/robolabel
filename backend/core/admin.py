from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import (
    Annotation,
    Company,
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


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "created_at")


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    model = User
    ordering = ("email",)
    list_display = (
        "email",
        "company",
        "is_administrador",
        "is_asignador",
        "is_etiquetador",
        "is_validador",
        "is_staff",
        "is_active",
    )
    list_filter = ("is_administrador", "is_asignador", "is_etiquetador", "is_validador", "is_staff", "is_active")
    search_fields = ("email", "first_name", "last_name")

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (
            "Organización",
            {
                "fields": (
                    "company",
                    "is_administrador",
                    "is_asignador",
                    "is_etiquetador",
                    "is_validador",
                ),
            },
        ),
        ("Información personal", {"fields": ("first_name", "last_name")}),
        (
            "Permisos",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        ("Fechas", {"fields": ("last_login", "created_at", "updated_at", "last_login_at")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "company",
                    "is_administrador",
                    "is_asignador",
                    "is_etiquetador",
                    "is_validador",
                    "password1",
                    "password2",
                ),
            },
        ),
    )
    readonly_fields = ("created_at", "updated_at", "last_login")

    filter_horizontal = ("groups", "user_permissions")


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "company", "deleted_at")


@admin.register(ImageGroup)
class ImageGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "project", "deleted_at")
    list_filter = ("deleted_at",)


@admin.register(GroupAssignment)
class GroupAssignmentAdmin(admin.ModelAdmin):
    list_display = ("id", "image_group", "labeler", "assigned_by", "created_at")


@admin.register(LabelClass)
class LabelClassAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "project", "sort_index")


@admin.register(ProjectImage)
class ProjectImageAdmin(admin.ModelAdmin):
    list_display = ("id", "original_filename", "group", "status", "discarded_for_dataset")


@admin.register(ValidationRecord)
class ValidationRecordAdmin(admin.ModelAdmin):
    list_display = ("id", "image", "validator", "decision", "created_at")


@admin.register(Annotation)
class AnnotationAdmin(admin.ModelAdmin):
    list_display = ("id", "image", "label_class")


@admin.register(DatasetVersion)
class DatasetVersionAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "project", "artifact_status")


@admin.register(DatasetVersionImage)
class DatasetVersionImageAdmin(admin.ModelAdmin):
    list_display = ("id", "dataset_version", "project_image")
