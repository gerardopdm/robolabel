"""Utilidades de queryset por empresa y rol."""
from django.db.models import QuerySet

from core.models import GroupAssignment, ProjectImage


def user_has_global_project_access(user) -> bool:
    """Ve todos los proyectos/grupos de la empresa (admin, asignador o validador sin rol etiquetador).

    Un validador que también es etiquetador no tiene visión global: solo ve grupos donde está asignado,
    igual que un etiquetador puro (cada etiquetador solo sus grupos).
    """
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "is_administrador", False) or getattr(user, "is_asignador", False):
        return True
    if getattr(user, "is_validador", False) and not getattr(user, "is_etiquetador", False):
        return True
    return False


def filter_projects_for_user(user) -> QuerySet:
    from core.models import Project

    if not getattr(user, "company_id", None):
        return Project.objects.none()
    qs = Project.objects.filter(company_id=user.company_id, deleted_at__isnull=True)
    if user_has_global_project_access(user):
        return qs
    if getattr(user, "is_etiquetador", False):
        return qs.filter(
            groups__assignments__labeler_id=user.pk,
            groups__deleted_at__isnull=True,
        ).distinct()
    return Project.objects.none()


def filter_image_groups_for_user(qs: QuerySet, user) -> QuerySet:
    """Restringe grupos para etiquetador sin otros roles amplios."""
    if user_has_global_project_access(user):
        return qs
    if getattr(user, "is_etiquetador", False):
        return qs.filter(assignments__labeler=user).distinct()
    return qs.none()


def user_can_access_project_image(user, image: ProjectImage) -> bool:
    if not getattr(user, "company_id", None):
        return False
    if image.group.project.company_id != user.company_id:
        return False
    if image.group.deleted_at or image.deleted_at:
        return False
    if user_has_global_project_access(user):
        return True
    if getattr(user, "is_etiquetador", False):
        return GroupAssignment.objects.filter(image_group=image.group, labeler=user).exists()
    return False


def user_can_export_dataset(user) -> bool:
    return bool(
        getattr(user, "is_administrador", False)
        or getattr(user, "is_asignador", False)
        or getattr(user, "is_validador", False),
    )


def user_can_annotate_image(user, image: ProjectImage) -> bool:
    if not user_can_access_project_image(user, image):
        return False
    s = image.status
    S = ProjectImage.Status
    if getattr(user, "is_administrador", False):
        return True
    if getattr(user, "is_asignador", False):
        return True
    if getattr(user, "is_validador", False) and s == S.PENDING_VALIDATION:
        return True
    if getattr(user, "is_etiquetador", False):
        return s in (S.PENDING, S.IN_PROGRESS, S.REJECTED)
    return False


def user_can_validate_image(user) -> bool:
    return bool(getattr(user, "is_administrador", False) or getattr(user, "is_validador", False))
