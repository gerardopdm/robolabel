from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import views

router = DefaultRouter()
router.register(r"projects", views.ProjectViewSet, basename="project")
router.register(r"users", views.UserAdminViewSet, basename="company-user")

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
        "projects/<int:project_pk>/groups/<int:group_pk>/assignments/",
        views.GroupAssignmentViewSet.as_view({"get": "list", "post": "create"}),
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/assignments/<int:pk>/",
        views.GroupAssignmentViewSet.as_view({"delete": "destroy"}),
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/upload-video/",
        views.upload_video,
        name="upload-video",
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/clear-annotations/",
        views.clear_group_annotations,
        name="clear-group-annotations",
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/delete-all-images/",
        views.delete_all_group_images,
        name="delete-all-group-images",
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
    path("filters/", views.list_filters, name="list-filters"),
    path("yolo-models/", views.list_yolo_models, name="list-yolo-models"),
    path("yolo-models/<str:model_name>/classes/", views.yolo_model_classes, name="yolo-model-classes"),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/images/<int:image_pk>/apply-filter/",
        views.apply_filter,
        name="apply-filter",
    ),
    path(
        "projects/<int:project_pk>/groups/<int:group_pk>/filter-preview/",
        views.filter_preview,
        name="filter-preview",
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
