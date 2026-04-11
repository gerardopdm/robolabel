"""Datos de demostración: empresa, usuarios y proyecto vacío."""
from django.core.management.base import BaseCommand

from core.models import Company, Project, User


class Command(BaseCommand):
    help = "Crea empresa demo, admin y editor (password: demo1234)"

    def handle(self, *args, **options):
        company, _ = Company.objects.get_or_create(name="Empresa Demo")
        if not User.objects.filter(email="admin@demo.local").exists():
            u = User.objects.create_user(
                email="admin@demo.local",
                password="demo1234",
                company=company,
                role=User.Role.ADMIN,
                first_name="Admin",
                last_name="Demo",
            )
            self.stdout.write(self.style.SUCCESS(f"Usuario admin: {u.email}"))
        if not User.objects.filter(email="editor@demo.local").exists():
            User.objects.create_user(
                email="editor@demo.local",
                password="demo1234",
                company=company,
                role=User.Role.EDITOR,
            )
            self.stdout.write(self.style.SUCCESS("Usuario editor: editor@demo.local"))
        if not User.objects.filter(email="viewer@demo.local").exists():
            User.objects.create_user(
                email="viewer@demo.local",
                password="demo1234",
                company=company,
                role=User.Role.VIEWER,
            )
            self.stdout.write(self.style.SUCCESS("Usuario viewer: viewer@demo.local"))
        Project.objects.get_or_create(
            company=company,
            name="Proyecto de prueba",
            defaults={
                "description": "Creado por seed_demo",
                "created_by": User.objects.filter(email="admin@demo.local").first(),
                "updated_by": User.objects.filter(email="admin@demo.local").first(),
            },
        )
        self.stdout.write(self.style.SUCCESS("Listo. Contraseña por defecto: demo1234"))
