# Least-privilege runtime identity shared by the Cloud Run services. It can read
# secrets, connect to Cloud SQL, and read/write the uploads bucket — nothing else.
resource "google_service_account" "runtime" {
  account_id   = "expertos-run"
  display_name = "ExpertOS Cloud Run runtime"
}

resource "google_project_iam_member" "runtime_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Object-level (not project-level) storage access, scoped to the uploads bucket.
resource "google_storage_bucket_iam_member" "runtime_uploads" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}
