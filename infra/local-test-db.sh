#!/bin/bash
set -euo pipefail

# ExpertOS — local live-DB integration harness (M11 / M11.2).
#
# Stands up a throwaway Postgres+pgvector container, migrates + seeds it, grants the
# non-superuser `app_user` role a LOGIN (migrations create it NOLOGIN — see
# packages/db/.../_rls_and_vector_index), and runs the opt-in live-DB integration
# suites that are excluded from the default `pnpm test`:
#
#   - packages/db   rls.integration.test.ts            (15 RLS negative tests, M11.2)
#   - apps/api      *.integration.test.ts              (35 PgVectorStore / search /
#                                                        expert-store / semantic-cache /
#                                                        expert-portal / failed-query tests)
#
# These suites self-skip when RLS_TEST_DATABASE_URL is unset, so they never run in the
# default coverage gate. This harness wires the live database they need.
#
# Usage:
#   bash infra/local-test-db.sh            # up + migrate + seed + run suites (default)
#   bash infra/local-test-db.sh up         # start + migrate + seed only (leave running)
#   bash infra/local-test-db.sh test       # run the suites against an already-up DB
#   bash infra/local-test-db.sh down       # stop + remove the container
#
# Requires: Docker, pnpm. No GCP / cloud dependencies (unlike infra/dev-setup.sh).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CONTAINER="${EXPERTOS_TEST_PG_CONTAINER:-expertos-test-pg}"
IMAGE="${EXPERTOS_TEST_PG_IMAGE:-pgvector/pgvector:pg16}"
PORT="${EXPERTOS_TEST_PG_PORT:-5432}"
DB_NAME="${EXPERTOS_TEST_PG_DB:-expertos}"
APP_USER_PW="${EXPERTOS_TEST_APP_USER_PW:-app_user}"

# Owner URL (superuser) — used for migrate + seed. app_user URL — used for the tests, so
# they exercise the same non-superuser role + FORCE RLS path the app runs under in prod.
OWNER_URL="postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}?schema=public"
APP_USER_URL="postgresql://app_user:${APP_USER_PW}@localhost:${PORT}/${DB_NAME}?schema=public"

start_db() {
  echo "[1/4] Starting ${IMAGE} as '${CONTAINER}' on :${PORT}..."
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  docker run -d --name "${CONTAINER}" \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB="${DB_NAME}" \
    -p "${PORT}:5432" \
    "${IMAGE}" >/dev/null

  echo -n "      waiting for readiness"
  for _ in $(seq 1 60); do
    if docker exec "${CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
      echo " — ready."
      return 0
    fi
    echo -n "."
    sleep 1
  done
  echo ""
  echo "ERROR: Postgres did not become ready in time." >&2
  exit 1
}

migrate_and_seed() {
  echo "[2/4] Applying migrations + seed (as owner)..."
  DATABASE_URL="${OWNER_URL}" pnpm --dir "${ROOT_DIR}" --filter @expertos/db db:deploy
  DATABASE_URL="${OWNER_URL}" pnpm --dir "${ROOT_DIR}" --filter @expertos/db db:seed

  echo "[3/4] Granting app_user a LOGIN (migrations create it NOLOGIN)..."
  docker exec "${CONTAINER}" psql -U postgres -d "${DB_NAME}" -q \
    -c "ALTER ROLE app_user WITH LOGIN PASSWORD '${APP_USER_PW}';"
}

run_suites() {
  echo "[4/4] Running live-DB integration suites as app_user..."
  echo "      RLS_TEST_DATABASE_URL=${APP_USER_URL}"
  RLS_TEST_DATABASE_URL="${APP_USER_URL}" pnpm --dir "${ROOT_DIR}" --filter @expertos/db test:integration
  RLS_TEST_DATABASE_URL="${APP_USER_URL}" pnpm --dir "${ROOT_DIR}" --filter @expertos/api test:integration
  echo ""
  echo "✓ Live-DB integration suites passed."
}

stop_db() {
  echo "Removing container '${CONTAINER}'..."
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  echo "✓ Done."
}

case "${1:-all}" in
  up)
    start_db
    migrate_and_seed
    echo ""
    echo "DB is up. Run the suites with:"
    echo "  RLS_TEST_DATABASE_URL='${APP_USER_URL}' pnpm --filter @expertos/db test:integration"
    echo "  RLS_TEST_DATABASE_URL='${APP_USER_URL}' pnpm --filter @expertos/api test:integration"
    ;;
  test)
    run_suites
    ;;
  down)
    stop_db
    ;;
  all)
    start_db
    migrate_and_seed
    run_suites
    echo ""
    echo "Tip: 'bash infra/local-test-db.sh down' to remove the container."
    ;;
  *)
    echo "Usage: $0 [up|test|down|all]" >&2
    exit 1
    ;;
esac
