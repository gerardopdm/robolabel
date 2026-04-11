from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import views

router = DefaultRouter()
router.register(r"projects", views.ProjectViewSet, basename="project")

urlpatterns = [
    path("health/", views.health),
    path("auth/login/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/me/", views.MeView.as_view({"get": "list"}), name="auth-me"),
    path("images/<int:pk>/file/", views.project_image_file, name="project-image-file"),
    path("images/<int:pk>/neighbors/", views.image_neighbors, name="image-neighbors"),
    path(
        "projects/<int:project_pk>/groups/",
        views.ImageGroupViewSet.as_view({"get": "list", "post": "create"}),
    ),
    path(
        "projects/<int:project_pk>/groups/<int:pk>/",
        views.ImageGroupViewSet.as_view({"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}),
    ),
    path(
        "projects/<int:project_pk>/classes/",
        views.LabelClassViewSet.as_view({"get": "list", "post": "create"}),
    ),
    path(
        "projects/<int:project_pk>/classes/<int:pk>/",
        views.LabelClassViewSet.as_view(
            {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"},
        ),
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/upload-video/",
        views.upload_video,
        name="upload-video",
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/images/",
        views.ProjectImageViewSet.as_view({"get": "list", "post": "create"}),
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/images/<int:pk>/",
        views.ProjectImageViewSet.as_view(
            {"get": "retrieve", "patch": "partial_update", "delete": "destroy"},
        ),
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/images/<int:image_pk>/annotations/replace/",
        views.AnnotationViewSet.as_view({"put": "replace"}),
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/images/<int:image_pk>/annotations/",
        views.AnnotationViewSet.as_view({"get": "list", "post": "create"}),
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/images/<int:image_pk>/annotations/<int:pk>/",
        views.AnnotationViewSet.as_view(
            {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"},
        ),
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/images/<int:image_pk>/find-similar/",
        views.find_similar_objects,
        name="find-similar-objects",
    ),
    path(
        "projects/<int:project_pk>/dataset-versions/",
        views.DatasetVersionViewSet.as_view({"get": "list", "post": "create"}),
    ),
    path(
        "projects/<int:project_pk>/dataset-versions/<int:pk>/export/yolov8/",
        views.DatasetVersionViewSet.as_view({"get": "export_yolov8"}),
    ),
    path(
        "projects/<int:project_pk>/dataset-versions/<int:pk>/",
        views.DatasetVersionViewSet.as_view(
            {"get": "retrieve", "delete": "destroy"},
        ),
    ),
    path("", include(router.urls)),
]
