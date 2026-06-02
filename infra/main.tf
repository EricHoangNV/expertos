# ExpertOS infrastructure (OpenTofu) — P0.4 minimal, scale-to-zero.
# Cloud Run (min instances = 0) for api/web/admin, Artifact Registry for images,
# a small Cloud SQL Postgres (+pgvector), a GCS uploads bucket, Secret Manager,
# and a least-privilege runtime service account. Everything that can scale to
# zero does; Cloud SQL uses the smallest tier (it has no true scale-to-zero).

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# APIs the rest of this config depends on. disable_on_destroy = false so a
# `terraform destroy` of ExpertOS resources never tears down shared project APIs.
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "cloudbuild.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}
