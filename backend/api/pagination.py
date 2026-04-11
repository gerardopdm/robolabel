"""Paginación API."""
from rest_framework.pagination import PageNumberPagination


class FlexiblePageSizePagination(PageNumberPagination):
    """Permite ?page_size= (máx. 200) además de ?page=."""

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 200
