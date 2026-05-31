variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run / Cloud SQL / Artifact Registry"
  type        = string
  default     = "us-central1"
}

variable "repo_id" {
  description = "Artifact Registry repository ID for ExpertOS container images"
  type        = string
  default     = "expertos"
}

variable "image_tag" {
  description = "Container image tag to deploy for all Cloud Run services"
  type        = string
  default     = "latest"
}

variable "db_tier" {
  description = "Cloud SQL machine tier (smallest by default to minimize cost)"
  type        = string
  default     = "db-f1-micro"
}

variable "db_name" {
  description = "Postgres database name"
  type        = string
  default     = "expertos"
}

variable "max_instances" {
  description = "Per-service Cloud Run max instance cap (cost guardrail)"
  type        = number
  default     = 4
}

variable "allow_unauthenticated" {
  description = <<-EOT
    Allow public (unauthenticated) invocation of the Cloud Run services. The API
    enforces Firebase auth in-app (FirebaseAuthGuard), and the web/admin apps are
    public entry points, so this is true by default. Set false to gate at the
    platform layer (e.g. behind IAP / a load balancer) instead.
  EOT
  type        = bool
  default     = true
}
