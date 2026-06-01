# Cloud Run services — all scale to zero (min_instance_count = 0). Cloud Run sets
# the PORT env to container_port (8080); the API reads PORT (apps/api/src/main.ts)
# and the Next standalone servers read PORT too.
locals {
  registry = "${var.region}-docker.pkg.dev/${var.project_id}/${var.repo_id}"
  images = {
    api   = "${local.registry}/api:${var.image_tag}"
    web   = "${local.registry}/web:${var.image_tag}"
    admin = "${local.registry}/admin:${var.image_tag}"
  }
  # Public-facing Next apps — no runtime secrets (NEXT_PUBLIC_* are baked at build
  # time via docker build args).
  frontends = {
    web   = "expertos-web"
    admin = "expertos-admin"
  }
}

# --- API: secrets + Cloud SQL connector ---------------------------------------
resource "google_cloud_run_v2_service" "api" {
  name     = "expertos-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = local.images["api"]

      ports {
        container_port = 8080
      }

      dynamic "env" {
        for_each = toset(local.secret_ids)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
    }

    # Mounts the instance's Unix socket at /cloudsql/<connection_name> via the
    # built-in connector (IAM+TLS); DATABASE_URL uses that socket host.
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
  }

  depends_on = [
    google_project_service.services,
    google_secret_manager_secret.app,
  ]
}

# --- Frontends: web + admin ---------------------------------------------------
resource "google_cloud_run_v2_service" "frontend" {
  for_each = local.frontends

  name     = each.value
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = local.images[each.key]

      ports {
        container_port = 8080
      }
    }
  }

  depends_on = [google_project_service.services]
}

# --- Public invocation (optional, default on) ---------------------------------
resource "google_cloud_run_v2_service_iam_member" "api_invoker" {
  count    = var.allow_unauthenticated ? 1 : 0
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_invoker" {
  for_each = var.allow_unauthenticated ? local.frontends : {}
  location = google_cloud_run_v2_service.frontend[each.key].location
  name     = google_cloud_run_v2_service.frontend[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
