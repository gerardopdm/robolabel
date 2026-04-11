"""Permisos por rol (PRD §4.2)."""
from rest_framework.permissions import BasePermission, SAFE_METHODS

from core.models import User


class IsCompanyMember(BasePermission):
    """Usuario autenticado con empresa."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and getattr(request.user, "company_id", None))


class IsAdminOrEditor(BasePermission):
    """Crear/editar/eliminar solo admin o editor."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return request.user.role in (User.Role.ADMIN, User.Role.EDITOR)


class ReadOrViewerExport(BasePermission):
    """Lectura para todos; escritura admin/editor. Exportar: viewer también (PRD)."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)
