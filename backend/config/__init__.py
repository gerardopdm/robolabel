import os

if os.environ.get("DJANGO_DATABASE", "").strip().lower() == "mysql":
    import pymysql

    pymysql.install_as_MySQLdb()
