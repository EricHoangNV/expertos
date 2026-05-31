# ExpertOS infrastructure (Terraform).
# P0.1 ships the skeleton; P0.4 adds Cloud Run (scale-to-zero), Cloud SQL,
# GCS, Secret Manager, Cloud Tasks, and IAM with minimal resources.

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
