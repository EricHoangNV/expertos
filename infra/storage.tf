# Uploads bucket (document ingestion + query-time uploads). Uniform access,
# versioned, private. Name is project-scoped to stay globally unique.
resource "google_storage_bucket" "uploads" {
  name                        = "${var.project_id}-expertos-uploads"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.services]
}
