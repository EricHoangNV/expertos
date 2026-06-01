# Secret containers only — values (versions) are added out of band so plaintext
# never lands in Terraform state:
#   echo -n "<value>" | gcloud secrets versions add <name> --data-file=-
#
# DATABASE_URL must point at the non-superuser app_user so Postgres RLS is
# enforced (DIRECTIVES §4.21 / §35). The app_user + grants are provisioned out of
# band against the Cloud SQL instance created in database.tf.
locals {
  secret_ids = [
    "DATABASE_URL",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]
}

resource "google_secret_manager_secret" "app" {
  for_each  = toset(local.secret_ids)
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}
