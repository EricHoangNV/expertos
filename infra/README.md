# infra/

Terraform for ExpertOS on GCP. **Scale-to-zero everything** (Phase 1 cost target).

P0.1 ships the provider skeleton only. P0.4 adds:

- **Cloud Run** services for `apps/api`, `apps/web`, `apps/admin` (min instances = 0)
- **Cloud SQL** Postgres + `pgvector`
- **GCS** bucket for document uploads
- **Secret Manager** for API keys / DB credentials
- **Cloud Tasks** for the ingestion job queue
- **IAM** service accounts with least privilege

## Usage (manual, Phase 1)

```bash
terraform -chdir=infra init
terraform -chdir=infra plan -var project_id=<gcp-project>
terraform -chdir=infra apply -var project_id=<gcp-project>
```
