# Smallest Cloud SQL Postgres instance. pgvector ships with Cloud SQL PG15 — after
# apply, connect and run `CREATE EXTENSION IF NOT EXISTS vector;` on the database.
#
# This config creates the instance + database only. The non-superuser `app_user`
# (LOGIN + RLS-enforcing, per DIRECTIVES §4.21) and the DATABASE_URL secret value
# are provisioned out of band so no DB password lands in Terraform state.
resource "google_sql_database_instance" "postgres" {
  name                = "expertos-pg"
  database_version    = "POSTGRES_15"
  region              = var.region
  deletion_protection = true

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_autoresize   = true
    disk_size         = 10

    ip_configuration {
      # Cloud Run reaches the instance via the Cloud SQL connector
      # (run.googleapis.com/cloudsql-instances volume), which authenticates over
      # IAM+TLS — no authorized networks are opened despite the public IP.
      ipv4_enabled = true
    }

    backup_configuration {
      enabled = true
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_sql_database" "app" {
  name     = var.db_name
  instance = google_sql_database_instance.postgres.name
}
