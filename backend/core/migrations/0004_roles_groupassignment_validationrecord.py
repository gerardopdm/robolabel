# Generated manually — roles múltiples, asignaciones y validación (docs/arquitectura-permisos.md)

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def migrate_legacy_roles(apps, schema_editor):
    User = apps.get_model("core", "User")
    for u in User.objects.all():
        r = u.role
        if r == "admin":
            u.is_administrador = True
            u.is_asignador = True
            u.is_staff = True
        elif r == "editor":
            u.is_asignador = True
            u.is_etiquetador = True
        elif r == "viewer":
            u.is_validador = True
        u.save()

def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_imagegroup_deleted_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="is_administrador",
            field=models.BooleanField(default=False, help_text="Gestión amplia y acceso al sitio de administración Django (is_staff sincronizado)."),
        ),
        migrations.AddField(
            model_name="user",
            name="is_asignador",
            field=models.BooleanField(default=False, help_text="Subida de imágenes, asignación a etiquetadores y creación de versiones de dataset."),
        ),
        migrations.AddField(
            model_name="user",
            name="is_etiquetador",
            field=models.BooleanField(default=False, help_text="Etiquetado en imágenes de grupos asignados."),
        ),
        migrations.AddField(
            model_name="user",
            name="is_validador",
            field=models.BooleanField(default=False, help_text="Aprobación o rechazo de imágenes en revisión; transición a completada."),
        ),
        migrations.CreateModel(
            name="GroupAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ('assigned_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='group_assignments_made', to=settings.AUTH_USER_MODEL)),
                ('image_group', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='assignments', to='core.imagegroup')),
                ('labeler', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='group_assignments', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['id'],
            },
        ),
        migrations.AddConstraint(
            model_name='groupassignment',
            constraint=models.UniqueConstraint(fields=('image_group', 'labeler'), name='uniq_group_assignment_labeler'),
        ),
        migrations.CreateModel(
            name='ValidationRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('decision', models.CharField(choices=[('approved', 'Aprobada'), ('rejected', 'Rechazada')], max_length=16)),
                ('comment', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('image', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='validation_records', to='core.projectimage')),
                ('validator', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='validation_records', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AlterField(
            model_name="projectimage",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pendiente"),
                    ("in_progress", "En progreso"),
                    ("pending_validation", "En validación"),
                    ("completed", "Completada"),
                    ("rejected", "Rechazada"),
                ],
                default="pending",
                max_length=32,
            ),
        ),
        migrations.RunPython(migrate_legacy_roles, noop_reverse),
        migrations.RemoveField(
            model_name="user",
            name="role",
        ),
    ]
