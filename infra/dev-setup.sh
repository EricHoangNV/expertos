#!/bin/bash
set -euo pipefail

# ExpertOS GCP Dev Environment Setup
# Provisions infrastructure + runs out-of-band steps that Terraform can't handle.
#
# Prerequisites:
#   - gcloud CLI authenticated (`gcloud auth login`)
#   - Terraform >= 1.5
#   - A GCP project with billing enabled
#
# Usage:
#   ./infra/dev-setup.sh <gcp-project-id> [region]
#
# Example:
#   ./infra/dev-setup.sh expertos-dev us-central1

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <gcp-project-id> [region]"
  exit 1
fi

PROJECT_ID="$1"
REGION="${2:-us-central1}"
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_PASSWORD="$(openssl rand -base64 24 | tr -d '=/+')"

echo "=== ExpertOS Dev Environment Setup ==="
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo ""

# ── Step 1: Set project ──────────────────────────────────────────────────────
echo "[1/7] Setting GCP project..."
gcloud config set project "$PROJECT_ID"

# ── Step 2: Terraform apply ──────────────────────────────────────────────────
echo "[2/7] Running terraform init + apply..."
terraform -chdir="$INFRA_DIR" init
terraform -chdir="$INFRA_DIR" apply \
  -var "project_id=$PROJECT_ID" \
  -var "region=$REGION" \
  -var "db_tier=db-f1-micro" \
  -auto-approve

SQL_CONNECTION=$(terraform -chdir="$INFRA_DIR" output -raw sql_connection_name)
UPLOADS_BUCKET=$(terraform -chdir="$INFRA_DIR" output -raw uploads_bucket)

echo ""
echo "  Cloud SQL connection: $SQL_CONNECTION"
echo "  Uploads bucket:       $UPLOADS_BUCKET"

# ── Step 3: Install pgvector + create app_user ───────────────────────────────
echo ""
echo "[3/7] Setting up Postgres (pgvector + app_user)..."
echo "  Waiting for Cloud SQL instance to be ready..."
gcloud sql instances describe expertos-pg --format='value(state)' | grep -q RUNNABLE || \
  (echo "  Waiting..." && sleep 30)

gcloud sql connect expertos-pg --user=postgres --quiet <<SQL
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;

GRANT CONNECT ON DATABASE expertos TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
SQL

echo "  app_user created (password stored — see step 4)"

# ── Step 4: Populate secrets ─────────────────────────────────────────────────
echo ""
echo "[4/7] Populating Secret Manager values..."

DATABASE_URL="postgresql://app_user:${DB_PASSWORD}@/expertos?host=/cloudsql/${SQL_CONNECTION}"
printf '%s' "$DATABASE_URL" | gcloud secrets versions add DATABASE_URL --data-file=- 2>/dev/null || true

echo ""
echo "  DATABASE_URL set."
echo ""
echo "  Now add the remaining secrets manually:"
echo ""
echo "  # Firebase Admin SDK (from Firebase Console > Project Settings > Service Accounts)"
echo "  printf '%s' '<project-id>'   | gcloud secrets versions add FIREBASE_PROJECT_ID   --data-file=-"
echo "  printf '%s' '<client-email>' | gcloud secrets versions add FIREBASE_CLIENT_EMAIL --data-file=-"
echo "  printf '%s' '<private-key>'  | gcloud secrets versions add FIREBASE_PRIVATE_KEY  --data-file=-"
echo ""
echo "  # AI providers (OpenAI = default, Anthropic + Google = backup)"
echo "  printf '%s' '<key>' | gcloud secrets versions add OPENAI_API_KEY    --data-file=-   # required"
echo "  printf '%s' '<key>' | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=-   # backup, optional at launch"
echo "  printf '%s' '<key>' | gcloud secrets versions add GEMINI_API_KEY    --data-file=-   # backup embeddings, optional"
echo ""
echo "  # Stripe (from Stripe Dashboard > Developers > API keys)"
echo "  printf '%s' '<key>' | gcloud secrets versions add STRIPE_SECRET_KEY     --data-file=-"
echo "  printf '%s' '<key>' | gcloud secrets versions add STRIPE_WEBHOOK_SECRET --data-file=-"

# ── Step 5: Configure Docker for Artifact Registry ───────────────────────────
echo ""
echo "[5/7] Configuring Docker for Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Step 6: Run Prisma migrations ────────────────────────────────────────────
echo ""
echo "[6/7] To run Prisma migrations against Cloud SQL, use Cloud SQL Proxy locally:"
echo ""
echo "  # Terminal 1: start proxy"
echo "  cloud-sql-proxy ${SQL_CONNECTION} --port 5433"
echo ""
echo "  # Terminal 2: run migrations"
echo "  DATABASE_URL='postgresql://app_user:${DB_PASSWORD}@localhost:5433/expertos' pnpm prisma:migrate"
echo ""

# ── Step 7: Summary ─────────────────────────────────────────────────────────
echo "[7/7] Done! Summary:"
echo ""
echo "  GCP Project:      $PROJECT_ID"
echo "  Region:           $REGION"
echo "  SQL Connection:   $SQL_CONNECTION"
echo "  Uploads Bucket:   $UPLOADS_BUCKET"
echo "  API URL:          $(terraform -chdir="$INFRA_DIR" output -raw api_url)"
echo "  Web URL:          $(terraform -chdir="$INFRA_DIR" output -raw web_url)"
echo "  Admin URL:        $(terraform -chdir="$INFRA_DIR" output -raw admin_url)"
echo "  Registry:         $(terraform -chdir="$INFRA_DIR" output -raw registry)"
echo ""
echo "  Next steps:"
echo "  1. Add remaining secrets (Firebase, AI keys, Stripe) — see commands above"
echo "  2. Run Cloud SQL Proxy + Prisma migrations — see commands above"
echo "  3. Build & deploy:  PROJECT_ID=$PROJECT_ID pnpm deploy"
echo "  4. Smoke test:      curl \"\$(terraform -chdir=infra output -raw api_url)/health\""
echo ""
echo "  Local .env for development against this Cloud SQL (via proxy on :5433):"
echo "  DATABASE_URL=postgresql://app_user:${DB_PASSWORD}@localhost:5433/expertos"
