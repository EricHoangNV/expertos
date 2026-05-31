output "api_url" {
  description = "Public URL of the API Cloud Run service"
  value       = google_cloud_run_v2_service.api.uri
}

output "web_url" {
  description = "Public URL of the user web Cloud Run service"
  value       = google_cloud_run_v2_service.frontend["web"].uri
}

output "admin_url" {
  description = "Public URL of the admin Cloud Run service"
  value       = google_cloud_run_v2_service.frontend["admin"].uri
}

output "registry" {
  description = "Artifact Registry path images are pushed to / pulled from"
  value       = local.registry
}

output "sql_connection_name" {
  description = "Cloud SQL connection name (project:region:instance) for the connector / DATABASE_URL socket host"
  value       = google_sql_database_instance.postgres.connection_name
}

output "uploads_bucket" {
  description = "GCS bucket for document + query-time uploads"
  value       = google_storage_bucket.uploads.name
}

output "runtime_service_account" {
  description = "Cloud Run runtime service account email"
  value       = google_service_account.runtime.email
}
