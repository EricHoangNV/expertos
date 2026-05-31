#!/usr/bin/env bash
# Manual build + deploy of one ExpertOS app to Cloud Run (Phase 1 — no CI/CD yet).
# Builds the image (context = repo root), pushes to Artifact Registry, then
# `gcloud run deploy --image` updates the existing Terraform-managed service
# (which already carries scaling, secrets, and the Cloud SQL connector config).
#
# Usage:  PROJECT_ID=my-proj [REGION=us-central1] [REPO=expertos] [TAG=latest] \
#           infra/deploy.sh <api|web|admin>
set -euo pipefail

APP="${1:?usage: deploy.sh <api|web|admin>}"
: "${PROJECT_ID:?set PROJECT_ID to your GCP project}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-expertos}"
TAG="${TAG:-latest}"

case "$APP" in
  api)   SERVICE="expertos-api" ;;
  web)   SERVICE="expertos-web" ;;
  admin) SERVICE="expertos-admin" ;;
  *) echo "unknown app '$APP' (expected api|web|admin)" >&2; exit 1 ;;
esac

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${APP}:${TAG}"

echo "==> Building ${IMAGE}"
docker build -f "apps/${APP}/Dockerfile" -t "${IMAGE}" .

echo "==> Pushing ${IMAGE}"
docker push "${IMAGE}"

echo "==> Deploying ${SERVICE}"
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}"

echo "==> Done: ${SERVICE}"
