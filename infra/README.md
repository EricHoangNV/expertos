# infra/ — manual build & deploy (Phase 1)

Terraform for ExpertOS on GCP. **Scale-to-zero everything** (Phase 1 cost target):
Cloud Run services run at `min_instance_count = 0`; Cloud SQL uses the smallest
tier (it has no true scale-to-zero). Phase 1 is **manual** build & deploy — the
CI/CD pipeline is deferred to Phase 2 (PRD §"Phased Delivery Roadmap").

## What this provisions

| File            | Resources |
|-----------------|-----------|
| `main.tf`       | provider + required Google APIs |
| `registry.tf`   | Artifact Registry (Docker) repo for the images |
| `cloud_run.tf`  | `expertos-api` / `expertos-web` / `expertos-admin` (scale-to-zero) + public invoker IAM |
| `database.tf`   | Cloud SQL Postgres 15 (pgvector-capable) + the `expertos` database |
| `storage.tf`    | GCS uploads bucket (private, versioned) |
| `secrets.tf`    | Secret Manager containers: `DATABASE_URL`, `FIREBASE_*` (values added out of band) |
| `iam.tf`        | least-privilege runtime service account |
| `outputs.tf`    | service URLs, registry path, SQL connection name, bucket |

## Quick start (dev environment)

```bash
./infra/dev-setup.sh <gcp-project-id> [region]
```

This automates steps 1–2 below: Terraform apply, pgvector, app_user, DATABASE_URL
secret, Docker auth. You'll still need to add Firebase/AI/Stripe secrets manually
(the script prints the exact commands).

## 1. Provision infrastructure

```bash
terraform -chdir=infra init
terraform -chdir=infra apply -var project_id=<gcp-project>
```

`terraform apply` references the container images, so on a brand-new project
either build & push images first (step 3) or apply, then deploy — the Cloud Run
revisions go healthy once images exist.

## 2. Out-of-band setup (kept out of Terraform state)

```bash
# pgvector extension on the app database
gcloud sql connect expertos-pg --user=postgres   # then: CREATE EXTENSION IF NOT EXISTS vector;

# Non-superuser app role so Postgres RLS is enforced (DIRECTIVES §4.21).
# Create app_user with LOGIN (no SUPERUSER/BYPASSRLS) + grants, then:
printf '%s' 'postgresql://app_user:<pw>@/expertos?host=/cloudsql/<connection_name>' \
  | gcloud secrets versions add DATABASE_URL --data-file=-

# Firebase Admin credentials for the API token-verify guard (P0.3)
printf '%s' '<project-id>'   | gcloud secrets versions add FIREBASE_PROJECT_ID   --data-file=-
printf '%s' '<client-email>' | gcloud secrets versions add FIREBASE_CLIENT_EMAIL --data-file=-
printf '%s' '<private-key>'  | gcloud secrets versions add FIREBASE_PRIVATE_KEY  --data-file=-
```

`<connection_name>` is the `sql_connection_name` Terraform output.

## 3. Build & deploy (manual)

From the repo root, with `gcloud auth configure-docker <region>-docker.pkg.dev` done:

```bash
# one app
PROJECT_ID=<gcp-project> pnpm deploy:api      # build → push → gcloud run deploy
PROJECT_ID=<gcp-project> pnpm deploy:web
PROJECT_ID=<gcp-project> pnpm deploy:admin

# all three
PROJECT_ID=<gcp-project> pnpm deploy
```

Each script (`infra/deploy.sh <app>`) builds `apps/<app>/Dockerfile` with the repo
root as context (pnpm workspace), pushes to Artifact Registry, then
`gcloud run deploy --image` updates the Terraform-managed service (scaling,
secrets, and the Cloud SQL connector stay as Terraform set them). Override
`REGION` / `REPO` / `TAG` via env vars.

NEXT_PUBLIC_* values for `web`/`admin` are baked at build time — pass them as
`--build-arg` (add `ARG`/`ENV` lines to those Dockerfiles) when you wire P0.3
Firebase web config into deploys.

## 4. Tests + coverage gate (run before deploy)

`pnpm test` runs every workspace's Jest suite with `--coverage`; the 90% gate is
enforced in `jest.base.cjs` (and the API's `*.service.ts`-scoped config). Phase 1
runs this locally / pre-push; CI takes it over in Phase 2.

## 5. Smoke test

```bash
curl "$(terraform -chdir=infra output -raw api_url)/health"
```
