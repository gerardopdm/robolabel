"""Permisos por rol (docs/arquitectura-permisos.md)."""
from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsCompanyMember(BasePermission):
    """Usuario autenticado con empresa."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and getattr(request.user, "company_id", None))


class IsAdministrador(BasePermission):
    """Solo administrador de producto (is_administrador)."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and getattr(request.user, "is_administrador", False),
        )


class IsAsignadorOrAdministrador(BasePermission):
    """Subida de imágenes, grupos, clases, asignaciones y versiones de dataset."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        u = request.user
        return bool(getattr(u, "is_administrador", False) or getattr(u, "is_asignador", False))


class CanExportDataset(BasePermission):
    """Export ZIP / descargar versiones: administrador, asignador o validador (no etiquetador puro)."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        u = request.user
        return bool(
            getattr(u, "is_administrador", False)
            or getattr(u, "is_asignador", False)
            or getattr(u, "is_validador", False),
        )


class ReadOrCanExport(BasePermission):
    """GET: miembro de empresa; POST de export: CanExportDataset (usar junto a IsCompanyMember)."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return bool(getattr(request.user, "company_id", None))
        return bool(
            getattr(request.user, "is_administrador", False)
            or getattr(request.user, "is_asignador", False)
            or getattr(request.user, "is_validador", False),
        )


# Compatibilidad con código que aún importe el nombre antiguo
class IsAdminOrEditor(IsAsignadorOrAdministrador):
    """Deprecated: usar IsAsignadorOrAdministrador."""

    pass
