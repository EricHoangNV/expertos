# Docker image registry for the api/web/admin images built in P0.4's deploy flow.
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.repo_id
  description   = "ExpertOS container images"
  format        = "DOCKER"

  depends_on = [google_project_service.services]
}
