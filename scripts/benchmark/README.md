# ExpertOS Q&A Benchmark Harness

Runs the 100-question UAT benchmark (English + Vietnamese) through the ExpertOS answer
pipeline, scores each generated answer against the reference ("gold") answer, and writes
parse-able results so runs can be compared over time.

Source questions: `tmp/Benchmark UAT Questions Design - John Ngo_260711.xlsx`.

## What it does

1. **Extract** the spreadsheet into two frozen datasets — `data/dataset.en.json` and
   `data/dataset.vi.json`, 100 records each (question, gold answer, category/level/difficulty).
2. **Generate** an answer for each question by driving the real production pipeline
   in-process (retrieve → load expert voice → `buildAnswerPrompt` → LLM), the same path
   `tmp/verify_llm_voice.cjs` uses — no HTTP server, no Firebase auth. Language is passed
   explicitly per dataset, and answers render in the **NCT expert's voice** (see below).
3. **Score** each answer two ways:
   - **LLM judge** (primary): a 0–100 substance-match score against the gold answer
     (rubric ignores wording/voice; penalizes omissions, contradictions, "I don't know").
   - **Embedding similarity** (secondary): cosine similarity of gold vs candidate
     embeddings, 0–100. Deterministic and near-free — a cheap regression tripwire.
4. **Aggregate** into `summary.json` (overall + by language / difficulty / level, pass rate)
   and emit per-question detail in `results.jsonl`.

`100% = totally match, 0% = completely different` maps to the **judge score**.

## Prerequisites

- Cloud SQL proxy on `localhost:5433` running, and the knowledge base ingested (the
  answers are grounded on published `global_expert` chunks).
- `OPENAI_API_KEY` set in the repo `.env` (the only provider wired locally).
- Workspace built so the compiled pipeline is importable: `pnpm build`
  (needs `apps/api/dist`, `packages/{ai,db,shared}/dist`).
- **NCT voice seeded** (one-time, idempotent):
  ```bash
  node scripts/benchmark/seed-nct-voice.cjs
  ```
  This creates the `nct` expert (Ngô Công Trường) and two published voice profiles —
  the Vietnamese one (matches production) and an English one (benchmark-only, so the EN
  set also renders in NCT's voice). Signature style examples come from the KBM Approved
  Response Bank under `tmp/AJJ AI KBM/03_COMMUNICATION_STYLE/`. If that asset is missing,
  profiles seed guidelines-only. Without this step, answers fall back to neutral voice.

## Voice

Answers render in the **NCT expert's voice** by default (`--expert nct`): the pipeline loads
his published voice profile for the answer language, retrieves the top-3 nearest voice
examples by cosine, and passes the guidelines + examples into `buildAnswerPrompt` — the same
wiring `ChatService` uses. The LLM judge scores substance, not voice, so voice mainly changes
the answers' style, not their score; run `--expert none` (or `--neutral`) for a neutral-voice
baseline to compare against.

> Production only ships NCT's **Vietnamese** profile; EN chat questions fall back to neutral
> there. This harness seeds an English NCT profile too so the EN benchmark set is also in his
> voice (the EN gold answers are written in his first person). That EN profile is benchmark-only
> config — flagged in `seed-nct-voice.cjs` and in each run's `run-meta.json` (`voice` block).

## Usage

```bash
# Full run: 100 EN + 100 VI, generate then score
scripts/benchmark/bench.sh

# Faster subset while iterating
scripts/benchmark/bench.sh --limit 10          # 10 EN + 10 VI
scripts/benchmark/bench.sh --lang vi           # Vietnamese only

# Or drive the steps directly (lets you re-score without re-generating)
node scripts/benchmark/run.cjs   --lang both --concurrency 4          # -> prints a run id
node scripts/benchmark/score.cjs --run-id <ID> [--judge-model gpt-4o] # re-scorable
node scripts/benchmark/compare.cjs <baselineRunId> <candidateRunId>   # regression diff
```

### Flags

`run.cjs`: `--lang en|vi|both` · `--limit N` · `--only 1,2,3` · `--concurrency N` (default 4)
· `--topk 8` · `--run-id ID` · `--resume` (skip already-answered questions in the same run)
· `--expert <slug>` (default `nct`) · `--expert none` / `--neutral` (neutral-voice baseline).

`score.cjs`: `--run-id ID` (required) · `--judge-model <model>` (default `gpt-4o-mini`; set a
stronger judge like `gpt-4o` for higher-fidelity scoring) · `--pass N` (pass threshold, default 70)
· `--concurrency N`.

## Output

Everything lands in `results/<runId>/` where `runId = <timestamp>-<gitSha>`:

| File | Contents |
|------|----------|
| `run-meta.json` | run config + provenance (git sha, model, dataset hashes, timings) |
| `answers.jsonl` | one line per question: generated answer, retrieved chunks, tokens, latency |
| `results.jsonl` | one line per question: judge score, similarity, verdict, missing points, contradictions, rationale |
| `summary.json`  | aggregates: overall + by language / difficulty / level, pass rate, cost |

`results.jsonl` and `summary.json` are stable JSON/JSONL — diff them across runs or load
them into a notebook. `compare.cjs` does the common diff (aggregate movement + biggest
per-question swings) for you.

## Design notes / known scoping

- **NCT voice.** Answers render in the NCT expert's voice (guidelines + top-3 cosine voice
  examples), mirroring `ChatService`. The judge scores *substance*, not persona, so voice
  changes the answers' style more than their score. Use `--expert none` for a neutral baseline.
  The English NCT profile is benchmark-only config (production ships VI only) — see **Voice** above.
- **Judge stability.** The judge runs at temperature 0 for run-to-run consistency, but LLM
  judging is not perfectly deterministic. The embedding similarity column is the fully
  deterministic signal; watch both when comparing runs.
- **Cost.** A full run is 200 generations + 200 judge calls + 400 embeddings on
  `gpt-4o-mini` / `text-embedding-3-small` — roughly a dollar and a few minutes at
  concurrency 4. Re-score without regenerating via `score.cjs --run-id`.
- **`results/` is git-ignored** (except `.gitkeep`); the datasets under `data/` are committed
  so every run scores against the same frozen input.
