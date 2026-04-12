"""Datos de demostración: empresa, usuarios y proyecto vacío."""
from django.core.management.base import BaseCommand

from core.models import Company, GroupAssignment, ImageGroup, Project, User


class Command(BaseCommand):
    help = "Crea empresa demo, usuarios (password: demo1234) y asignación de ejemplo"

    def handle(self, *args, **options):
        company, _ = Company.objects.get_or_create(name="Empresa Demo")
        if not User.objects.filter(email="admin@demo.local").exists():
            u = User.objects.create_user(
                email="admin@demo.local",
                password="demo1234",
                company=company,
                is_administrador=True,
                is_asignador=True,
                first_name="Admin",
                last_name="Demo",
            )
            self.stdout.write(self.style.SUCCESS(f"Usuario admin: {u.email}"))
        if not User.objects.filter(email="editor@demo.local").exists():
            User.objects.create_user(
                email="editor@demo.local",
                password="demo1234",
                company=company,
                is_asignador=True,
                is_etiquetador=True,
            )
            self.stdout.write(self.style.SUCCESS("Usuario editor (asignador+etiquetador): editor@demo.local"))
        if not User.objects.filter(email="viewer@demo.local").exists():
            User.objects.create_user(
                email="viewer@demo.local",
                password="demo1234",
                company=company,
                is_validador=True,
            )
            self.stdout.write(self.style.SUCCESS("Usuario viewer (validador): viewer@demo.local"))
        project, _ = Project.objects.get_or_create(
            company=company,
            name="Proyecto de prueba",
            defaults={
                "description": "Creado por seed_demo",
                "created_by": User.objects.filter(email="admin@demo.local").first(),
                "updated_by": User.objects.filter(email="admin@demo.local").first(),
            },
        )
        group = ImageGroup.objects.filter(project=project, deleted_at__isnull=True).first()
        if group is None:
            group = ImageGroup.objects.create(project=project, name="Grupo inicial", sort_order=0)
        editor = User.objects.filter(email="editor@demo.local").first()
        if group and editor and not GroupAssignment.objects.filter(image_group=group, labeler=editor).exists():
            admin_u = User.objects.filter(email="admin@demo.local").first()
            GroupAssignment.objects.create(
                image_group=group,
                labeler=editor,
                assigned_by=admin_u,
            )
            self.stdout.write(self.style.SUCCESS("Asignación de grupo de prueba → editor@demo.local"))
        self.stdout.write(self.style.SUCCESS("Listo. Contraseña por defecto: demo1234"))
