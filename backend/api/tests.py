from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from core.models import Company, ImageGroup, LabelClass, Project, ProjectImage

User = get_user_model()


class AuthAndTenantTests(TestCase):
    def setUp(self):
        self.c1 = Company.objects.create(name="C1")
        self.c2 = Company.objects.create(name="C2")
        self.u1 = User.objects.create_user(
            email="a@test.com",
            password="pass12345",
            company=self.c1,
            role=User.Role.EDITOR,
        )
        self.u2 = User.objects.create_user(
            email="b@test.com",
            password="pass12345",
            company=self.c2,
            role=User.Role.EDITOR,
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
            role=User.Role.EDITOR,
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


class YoloExportTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name="C")
        self.user = User.objects.create_user(
            email="y@test.com",
            password="pass12345",
            company=self.company,
            role=User.Role.EDITOR,
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
