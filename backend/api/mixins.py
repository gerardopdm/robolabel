"""Utilidades de queryset por empresa."""
from django.db.models import QuerySet


def filter_projects_for_user(user) -> QuerySet:
    from core.models import Project

    if not getattr(user, "company_id", None):
        return Project.objects.none()
    return Project.objects.filter(company_id=user.company_id, deleted_at__isnull=True)
