#!/usr/bin/env bash
# One-command benchmark: (extract if needed) -> generate answers -> score.
# Passes any extra flags through to run.cjs (e.g. --lang en, --limit 10).
#
#   scripts/benchmark/bench.sh                 # full 100 EN + 100 VI
#   scripts/benchmark/bench.sh --lang vi       # VI only
#   scripts/benchmark/bench.sh --limit 10      # 10 EN + 10 VI smoke
#
# Requires: Cloud SQL proxy on :5433 up, OPENAI_API_KEY in .env, workspace built (pnpm build).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

# 1. Extract datasets if they are missing (committed, so normally a no-op).
if [ ! -f "$HERE/data/dataset.en.json" ] || [ ! -f "$HERE/data/dataset.vi.json" ]; then
  echo "==> Extracting datasets from spreadsheet"
  python3 "$HERE/extract.py"
fi

# 1b. Seed the NCT voice profiles if not already present (idempotent; skip with BENCH_SKIP_SEED=1).
if [ "${BENCH_SKIP_SEED:-0}" != "1" ]; then
  echo "==> Seeding NCT voice (idempotent)"
  node "$HERE/seed-nct-voice.cjs"
fi

# 2. Generate answers. Capture the run id run.cjs prints so we can score the same run.
RUN_ID="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
echo "==> Generating answers (run $RUN_ID)"
node "$HERE/run.cjs" --run-id "$RUN_ID" "$@"

# 3. Score.
echo "==> Scoring run $RUN_ID"
node "$HERE/score.cjs" --run-id "$RUN_ID"

echo ""
echo "==> Done. Artifacts in scripts/benchmark/results/$RUN_ID/"
echo "    Compare against a prior run: node scripts/benchmark/compare.cjs <priorRunId> $RUN_ID"
