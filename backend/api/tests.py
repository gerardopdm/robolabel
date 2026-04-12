from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from core.models import Company, GroupAssignment, ImageGroup, LabelClass, Project, ProjectImage

User = get_user_model()


class AuthAndTenantTests(TestCase):
    def setUp(self):
        self.c1 = Company.objects.create(name="C1")
        self.c2 = Company.objects.create(name="C2")
        self.u1 = User.objects.create_user(
            email="a@test.com",
            password="pass12345",
            company=self.c1,
            is_asignador=True,
            is_etiquetador=True,
        )
        self.u2 = User.objects.create_user(
            email="b@test.com",
            password="pass12345",
            company=self.c2,
            is_asignador=True,
            is_etiquetador=True,
        )
        self.client = APIClient()

    def test_login_returns_tokens(self):
        r = self.client.post(
            "/api/v1/auth/login/",
            {"email": "a@test.com", "password": "pass12345"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertIn("access", r.data)

    def test_me_requires_auth(self):
        r = self.client.get("/api/v1/auth/me/")
        self.assertEqual(r.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_with_token(self):
        self.client.force_authenticate(user=self.u1)
        r = self.client.get("/api/v1/auth/me/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["email"], "a@test.com")
        self.assertIn("is_asignador", r.data)

    def test_project_isolation(self):
        p2 = Project.objects.create(
            company=self.c2,
            name="P2",
            task_type="object_detection",
            created_by=self.u2,
            updated_by=self.u2,
        )
        self.client.force_authenticate(user=self.u1)
        r = self.client.get(f"/api/v1/projects/{p2.pk}/")
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)


class ProjectCrudTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name="C")
        self.user = User.objects.create_user(
            email="e@test.com",
            password="pass12345",
            company=self.company,
            is_administrador=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_list_project(self):
        r = self.client.post(
            "/api/v1/projects/",
            {"name": "Proyecto 1", "description": "d"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        r2 = self.client.get("/api/v1/projects/")
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(r2.data.get("count", 0), 1)


class UserAdminApiTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name="CU")
        self.admin = User.objects.create_user(
            email="adm@test.com",
            password="pass12345",
            company=self.company,
            is_administrador=True,
        )
        self.editor = User.objects.create_user(
            email="ed@test.com",
            password="pass12345",
            company=self.company,
            is_asignador=True,
            is_etiquetador=True,
        )
        self.pure_labeler = User.objects.create_user(
            email="lab@test.com",
            password="pass12345",
            company=self.company,
            is_etiquetador=True,
        )
        self.client = APIClient()

    def test_users_list_forbidden_for_pure_etiquetador(self):
        self.client.force_authenticate(user=self.pure_labeler)
        r = self.client.get("/api/v1/users/")
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_users_list_ok_for_asignador(self):
        self.client.force_authenticate(user=self.editor)
        r = self.client.get("/api/v1/users/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(r.data.get("count", 0), 3)

    def test_users_create_forbidden_for_asignador(self):
        self.client.force_authenticate(user=self.editor)
        r = self.client.post(
            "/api/v1/users/",
            {
                "email": "new@test.com",
                "password": "longpass12",
                "is_etiquetador": True,
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_users_list_ok_for_admin(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.get("/api/v1/users/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(r.data.get("count", 0), 3)


class YoloExportTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name="C")
        self.user = User.objects.create_user(
            email="y@test.com",
            password="pass12345",
            company=self.company,
            is_asignador=True,
            is_etiquetador=True,
        )
        self.project = Project.objects.create(
            company=self.company,
            name="P",
            task_type="object_detection",
            created_by=self.user,
            updated_by=self.user,
        )
        self.group = ImageGroup.objects.create(project=self.project, name="G", sort_order=0)
        self.lc = LabelClass.objects.create(
            project=self.project,
            name="obj",
            color_hex="#ff0000",
            sort_index=0,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_export_empty_raises(self):
        r = self.client.post(
            f"/api/v1/projects/{self.project.pk}/export/yolov8/",
            {"only_completed": True},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)


class LabelerGroupVisibilityTests(TestCase):
    """Etiquetadores solo listan grupos donde tienen asignación; validador puro ve todos."""

    def setUp(self):
        self.company = Company.objects.create(name="CV")
        self.admin = User.objects.create_user(
            email="admin_cv@test.com",
            password="pass12345",
            company=self.company,
            is_administrador=True,
        )
        self.project = Project.objects.create(
            company=self.company,
            name="P",
            task_type="object_detection",
            created_by=self.admin,
            updated_by=self.admin,
        )

        self.g1 = ImageGroup.objects.create(project=self.project, name="G1", sort_order=0)
        self.g2 = ImageGroup.objects.create(project=self.project, name="G2", sort_order=1)

        self.pure_labeler = User.objects.create_user(
            email="solo_lab@test.com",
            password="pass12345",
            company=self.company,
            is_etiquetador=True,
        )
        GroupAssignment.objects.create(image_group=self.g1, labeler=self.pure_labeler, assigned_by=self.admin)

        self.validator_only = User.objects.create_user(
            email="solo_val@test.com",
            password="pass12345",
            company=self.company,
            is_validador=True,
        )

        self.lab_val = User.objects.create_user(
            email="lab_val@test.com",
            password="pass12345",
            company=self.company,
            is_etiquetador=True,
            is_validador=True,
        )
        GroupAssignment.objects.create(image_group=self.g1, labeler=self.lab_val, assigned_by=self.admin)

        self.client = APIClient()

    def test_pure_labeler_lists_only_assigned_groups(self):
        self.client.force_authenticate(user=self.pure_labeler)
        r = self.client.get(f"/api/v1/projects/{self.project.pk}/groups/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = [x["id"] for x in r.data["results"]]
        self.assertEqual(ids, [self.g1.id])

    def test_validator_only_lists_all_groups(self):
        self.client.force_authenticate(user=self.validator_only)
        r = self.client.get(f"/api/v1/projects/{self.project.pk}/groups/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = sorted(x["id"] for x in r.data["results"])
        self.assertEqual(ids, sorted([self.g1.id, self.g2.id]))

    def test_etiquetador_y_validador_lists_only_assigned_groups(self):
        self.client.force_authenticate(user=self.lab_val)
        r = self.client.get(f"/api/v1/projects/{self.project.pk}/groups/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = [x["id"] for x in r.data["results"]]
        self.assertEqual(ids, [self.g1.id])


class ImageGalleryStatusFilterTests(TestCase):
    """Filtros de galería por pestaña (pendientes / validación / validadas)."""

    def setUp(self):
        self.company = Company.objects.create(name="GF")
        self.admin = User.objects.create_user(
            email="adm_gf@test.com",
            password="pass12345",
            company=self.company,
            is_administrador=True,
        )
        self.project = Project.objects.create(
            company=self.company,
            name="PG",
            task_type="object_detection",
            created_by=self.admin,
            updated_by=self.admin,
        )
        self.group = ImageGroup.objects.create(project=self.project, name="GX", sort_order=0)
        S = ProjectImage.Status
        self.im_pending = ProjectImage.objects.create(
            group=self.group,
            storage_path="p/x1.jpg",
            original_filename="a.jpg",
            mime_type="image/jpeg",
            file_size_bytes=1,
            width_px=10,
            height_px=10,
            status=S.PENDING,
            created_by=self.admin,
            updated_by=self.admin,
        )
        self.im_pv = ProjectImage.objects.create(
            group=self.group,
            storage_path="p/x2.jpg",
            original_filename="b.jpg",
            mime_type="image/jpeg",
            file_size_bytes=1,
            width_px=10,
            height_px=10,
            status=S.PENDING_VALIDATION,
            created_by=self.admin,
            updated_by=self.admin,
        )
        self.im_done = ProjectImage.objects.create(
            group=self.group,
            storage_path="p/x3.jpg",
            original_filename="c.jpg",
            mime_type="image/jpeg",
            file_size_bytes=1,
            width_px=10,
            height_px=10,
            status=S.COMPLETED,
            created_by=self.admin,
            updated_by=self.admin,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_list_pendientes_excludes_validation_and_completed(self):
        r = self.client.get(
            f"/api/v1/projects/{self.project.pk}/groups/{self.group.pk}/images/",
            {"status": "pendientes"},
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = [x["id"] for x in r.data["results"]]
        self.assertEqual(ids, [self.im_pending.id])
        gc = r.data["group_image_counts"]
        self.assertEqual(gc["pendientes"], 1)
        self.assertEqual(gc["pending_validation"], 1)
        self.assertEqual(gc["validadas"], 1)

    def test_list_pending_validation(self):
        r = self.client.get(
            f"/api/v1/projects/{self.project.pk}/groups/{self.group.pk}/images/",
            {"status": "pending_validation"},
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = [x["id"] for x in r.data["results"]]
        self.assertEqual(ids, [self.im_pv.id])

    def test_list_validadas(self):
        r = self.client.get(
            f"/api/v1/projects/{self.project.pk}/groups/{self.group.pk}/images/",
            {"status": "validadas"},
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = [x["id"] for x in r.data["results"]]
        self.assertEqual(ids, [self.im_done.id])
