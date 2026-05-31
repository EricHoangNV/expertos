variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run / Cloud SQL"
  type        = string
  default     = "us-central1"
}
