#!/bin/bash

# Exit on unset variables, but not on every non-zero command
set -u

# Load environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/.env"

SANDBOX_NAME="claude-expertos"
SANDBOX_LOG_DIR="/home/agent/.claude/projects/-Volumes-OWC-Express-1M2-Development-expertos"

cleanup() {
  echo "Stopping sandbox..."
  docker sandbox stop "$SANDBOX_NAME" 2>/dev/null
  [ -n "${tail_pid:-}" ] && kill "$tail_pid" 2>/dev/null
  [ -n "${agent_pid:-}" ] && kill "$agent_pid" 2>/dev/null
}
trap cleanup EXIT

# Notify function: echo to both console and Slack
# Splits long messages into multiple Slack posts (3500 char chunks)
notify() {
  local message="$1"
  local timestamp="[$(date '+%Y-%m-%d %H:%M:%S')]"

  # Echo to console
  echo "$timestamp $message"

  # Send to Slack
  if [ -n "${SLACK_WEBHOOK:-}" ]; then
    local full="${timestamp} ${message}"
    local chunk_size=3500
    local offset=0
    local len=${#full}

    while [ $offset -lt $len ]; do
      local chunk="${full:$offset:$chunk_size}"
      local payload
      payload=$(jq -n --arg text "$chunk" '{text: $text}')
      curl -s -X POST -H 'Content-type: application/json' \
        --data "$payload" \
        "$SLACK_WEBHOOK" > /dev/null
      offset=$((offset + chunk_size))
      # Small delay between chunks to preserve order
      [ $offset -lt $len ] && sleep 1
    done
  fi
}

# Extract Claude's final summary from the JSONL session log
# Gets all text from the last complete assistant message (with stop_reason set)
get_final_summary() {
  local log_file="$1"
  docker sandbox exec "$SANDBOX_NAME" \
    cat "$log_file" 2>/dev/null | \
    jq -rs '[.[] | select(.type == "assistant")] | last | [.message.content[]? | select(.type == "text") | .text] | join("\n")'
}

MODE="work"
if [ "${1:-}" = "--validate" ]; then
  MODE="validate"
  shift
fi

if [ -z "${1:-}" ]; then
  notify "Usage: $0 [--validate] <iterations>"
  exit 1
fi

iterations=$1

notify "🚀 Starting AFK mode ($MODE) with $iterations iterations..."

for ((i=1; i<=iterations; i++)); do
  notify "🔄 Starting iteration $i of $iterations..."

  # Ensure sandbox is running (it may have been stopped after a previous iteration)
  docker sandbox start "$SANDBOX_NAME" 2>/dev/null

  # Inject git credentials into sandbox for push access (credential-store, not cache —
  # cache daemon dies between docker exec calls)
  GIT_CREDS_FILE="/Volumes/OWC-Express-1M2/.claude-docker/git-credentials"
  if [ -f "$GIT_CREDS_FILE" ]; then
    GIT_CRED=$(cat "$GIT_CREDS_FILE" | tr -d '\n')
    docker sandbox exec "$SANDBOX_NAME" bash -c "\
      printf '%s\n' '$GIT_CRED' > /home/agent/.git-credentials && \
      git config --global --unset credential.https://github.com.helper 2>/dev/null; \
      git config --global credential.helper store"
  fi

  # Record HEAD before this iteration so we can detect new commits
  head_before=$(git rev-parse HEAD 2>/dev/null)

  # Snapshot existing log files before starting so we can find the new one
  existing_logs=$(docker sandbox exec "$SANDBOX_NAME" find "$SANDBOX_LOG_DIR" -name "*.jsonl" -not -name "history.jsonl" 2>/dev/null | sort)

  # Extract compact context snippets (avoids injecting full files via @)
  # Task Manifest: the dedicated tracking board (PRD.md now holds only design/§ detail, not tasks)
  TASK_MANIFEST=$(cat project-mds/PRD-TRACKING.md)
  # Progress: the full state file (should be ~3KB per PROGRESS-INSTRUCTIONS.MD)
  PROGRESS_SUMMARY=$(cat project-mds/progress-state.md)
  # Safety net: truncate to 8KB if an agent bloated the state file
  if [ ${#PROGRESS_SUMMARY} -gt 8192 ]; then
    PROGRESS_SUMMARY="${PROGRESS_SUMMARY:0:8192}
... (truncated — progress-state.md exceeds 8KB limit, see PROGRESS-INSTRUCTIONS.MD)"
  fi
  # Requests: only the "Open Requests" section (stop at first ---)
  OPEN_REQUESTS=$(sed -n '1,/^---$/p' project-mds/REQUESTS.MD)
  # Feedbacks: only the "Latest Review Verdicts" section (stop at first ---)
  LATEST_VERDICTS=$(sed -n '1,/^---$/p' project-mds/FEEDBACKS.MD)

  # Build prompt based on mode
  if [ "$MODE" = "validate" ]; then
    PROMPT="## MANDATORY FIRST STEP — Read Directives
Before doing ANY work, read the Quick Reference section at the top of project-mds/DIRECTIVES.MD.
This is non-negotiable. Every session starts by reading directives.

## Mode: VALIDATION
Your job is to validate implementation completeness — not to build new features.

## Task Manifest (from PRD-TRACKING.md)
${TASK_MANIFEST}

## Latest Review Verdicts (from FEEDBACKS.MD)
${LATEST_VERDICTS}

## Progress Summary
${PROGRESS_SUMMARY}

## Open Requests
${OPEN_REQUESTS}

## Files to read ON DEMAND (do NOT read in full)
- project-mds/PRD-TRACKING.md — the task manifest / status board (summarized above)
- project-mds/PRD.md — read only the §milestone section for the deliverable you are verifying (design + implementation directions live here)
- project-mds/BUILD-NOTES.md — per-task build notes (files/decisions) for completed work, keyed by task id
- project-mds/DIRECTIVES.MD — Quick Reference already read above; read full § sections when checking specific rules
- project-mds/FEEDBACKS.MD — already summarized above; read full review only if you need remediation details
- project-mds/REQUESTS.MD — already summarized above

## Steps
1. Read the Quick Reference in project-mds/DIRECTIVES.MD (just the summary table at top — ~33 lines). Confirm you've read it before proceeding.
2. Walk through every deliverable in the Task Manifest above.
   For each item marked [x], verify the implementation exists:
   - Check the key files listed in the PRD section exist
   - Check exports, types, and function signatures match the spec
   - Run relevant tests to confirm they pass
   - Flag any gap between spec and implementation
3. Cross-check DIRECTIVES.MD: verify the codebase follows each directive.
   Focus on rules that are easy to drift on (naming, security, i18n, touch targets).
4. Check the Latest Review Verdicts above for any FAIL items that were missed.
5. Check Open Requests above for any unresolved items.
6. Run ALL feedback loops:
   - TypeScript: pnpm typecheck (must pass with no errors)
   - Tests: pnpm test (must pass)
   - Lint: pnpm lint (must pass)
   - Dead code: pnpm deadcode (must pass with no output)
7. If you find gaps or issues:
   - Fix them if the fix is straightforward (< 30 min of work).
   - For larger gaps, add them as [ ] items to project-mds/PRD-TRACKING.md
     and add them to the Next Tasks list in progress-state.md.
   - Commit fixes to both local and remote repositories.
   - Update progress (read PROGRESS-INSTRUCTIONS.MD first).
8. Write a validation summary to progress-log.md with:
   - Sections validated and their status
   - Gaps found and whether you fixed them or deferred them
   - Overall readiness assessment
9. After finishing, if ALL deliverables are verified and no gaps remain: \\
   output <promise>COMPLETE</promise> at the very end of your response. \\
   If gaps remain, do NOT output the promise tag."
  else
    PROMPT="## MANDATORY FIRST STEP — Read Directives
Before doing ANY work, read the Quick Reference section at the top of project-mds/DIRECTIVES.MD.
This is non-negotiable. Every session starts by reading directives.

## Project Status
You have three sources below to decide what to work on. Read them all before choosing.

### Task Manifest (from PRD-TRACKING.md — shows [x] done vs [ ] open)
${TASK_MANIFEST}

### Build & Test Status
${PROGRESS_SUMMARY}

### Open Requests (from REQUESTS.MD)
${OPEN_REQUESTS}

### Latest Review Verdicts (from FEEDBACKS.MD — FAIL items need fixing)
${LATEST_VERDICTS}

## Files to read ON DEMAND (do NOT read in full)
- project-mds/PRD-TRACKING.md — the task manifest / status board (summarized above). Pick your task here.
- project-mds/PRD.md — read ONLY the §milestone section for your chosen task; it holds the design + implementation directions (e.g. §M17 for the settings/embedding work, the \"Paywall, Entitlements & Feature Gating\" section for billing). **Do NOT edit PRD.md on a task run.**
- project-mds/BUILD-NOTES.md — append your build note here after finishing (keyed by task id, e.g. ### M17.1); read prior notes only if you need history.
- project-mds/DIRECTIVES.MD — Quick Reference already read above; read full § sections only when implementing related features
- project-mds/FEEDBACKS.MD — verdicts summarized above; read the full review section only if you need remediation details
- project-mds/LEARNINGS.MD — read before writing new learnings
- project-mds/REQUESTS.MD — open requests summarized above
- requirements/ui-reference-spec.md — **READ BEFORE any M12 task.** Component-by-component spec mapping the approved UI mockup to ds.css classes.
- requirements/Design System.md — design tokens, usage rules, component catalog. Read for M12 tasks.

## Steps
1. Read the Quick Reference in project-mds/DIRECTIVES.MD (just the summary table at top — ~33 lines). Confirm you've read it before proceeding.
2. Using the Task Manifest, Open Requests, and Latest Verdicts above, decide what to work on next.
   Look at open [ ] items in the manifest, any open requests, and any FAIL verdicts.
   Make your own judgment — do NOT just follow the \"Next tasks\" list from a previous agent.
3. Pick the highest priority task using this order:
   a. Architectural decisions and core abstractions
   b. Integration points between modules
   c. Unknown unknowns and spike work
   d. Standard features and implementation
   e. Open requests from REQUESTS.MD
   f. FAIL items from latest review verdicts
   g. Improve test coverage. Polish, cleanup, and quick wins
   Fail fast on risky work. Save easy wins for later.
4. Read ONLY the PRD section for your chosen task (e.g., the \"Paywall, Entitlements & Feature Gating\" section for the subscription milestone).
   Read relevant § sections in DIRECTIVES.MD for any rules that apply. Then implement.
4b. **If your task is an M12 (Frontend UI) task:**
   - Read \\\`requirements/ui-reference-spec.md\\\` BEFORE implementing. It maps every component to exact ds.css classes.
   - Read \\\`requirements/Design System.md\\\` for token rules and usage constraints.
   - Read \\\`packages/ui/src/ds.css\\\` for available classes — use them, do not reinvent.
   - **Verification checklist for every UI component you build:**
     a. Uses ONLY ds.css tokens (--red-600, --ink-900, etc.) — zero hardcoded hex values or pixel sizes outside ds.css scale.
     b. Component class names match the spec in ui-reference-spec.md (e.g., .sources-rail, .msg-user, .input-bar).
     c. Upload sources use info-blue (.cite.upload, badge-info); knowledge sources use crimson (.cite, badge-red). Never mix.
     d. Fonts: headings = --font-display (Sora), body = --font-text (Public Sans), metadata = --font-mono (Spline Sans Mono).
     e. Interactive targets >= 44px.
     f. Existing components are REUSED, not rebuilt: AnswerView (M4.2), AnswerFeedback, SaveAnswer, ConsultationPrompt, UploadPanel.
     g. The three layout directions (classic/studio/focus) degrade gracefully — test at 1280px, 900px, and 375px widths.
   - After implementing, grep your new CSS/TSX files for hardcoded hex (#) and px values not from the ds.css scale. Fix any violations before committing.
5. Run ALL feedback loops:
   - TypeScript: pnpm typecheck (must pass with no errors)
   - Tests: pnpm test (must pass)
   - Lint: pnpm lint (must pass)
   - Dead code: pnpm deadcode (must pass with no output. If knip reports issues, fix them — remove unused exports, delete dead files, fix unlisted deps. Known exceptions are already configured in knip.json)
   - Build and run test with sample data as much as possible to remove all CRUD related errors early
   - During testing, do not just test changed codes. Pay attention to the callers, and the consumers of updated code and test these functions too. Make sure there are no silent crashing or incompatibilities happens.
   Do NOT commit if any feedback loop fails. Fix issues first.
6. Commit your changes to both local and remote repositories.
7. If you found and fix any bugs, update the learning to LEARNINGS.MD (read LEARNINGS-INSTRUCTIONS.MD first). \\
   If the learning warrants a new directive, update DIRECTIVES.MD as well. \\
   If you fix any feedback, update FEEDBACKS.MD (read FEEDBACKS-INSTRUCTIONS.MD first). \\
   If you resolve a request, update REQUESTS.MD (read REQUESTS-INSTRUCTIONS.MD first).
8. After completing each task, update progress (read PROGRESS-INSTRUCTIONS.MD first): \\
   - Overwrite progress-state.md with updated state (test counts, completed items, next tasks). \\
   - Append your detailed entry to the bottom of progress-log.md. \\
   - In project-mds/PRD-TRACKING.md, flip your completed task [ ]→[x]; append its build note (files, decisions, gotchas) to project-mds/BUILD-NOTES.md keyed by task id (e.g. ### M17.1). \\
   - Do NOT edit project-mds/PRD.md — it is the stable design/plan doc; change it only when (re)planning a feature. \\
   ONLY DO ONE TASK AT A TIME.
9. After finishing, run these quick checks (do NOT re-read full files): \\
   - \\\`grep '- \\[ \\]' project-mds/PRD-TRACKING.md\\\` — any open tasks left in the manifest? \\
   - \\\`grep 'FAIL' project-mds/FEEDBACKS.MD | head -5\\\` — any unresolved FAIL verdicts? \\
   - Check the Open Requests section above — any still unresolved? \\
   If ALL are clear, output <promise>COMPLETE</promise> at the very end of your response. \\
   If not, do NOT output the promise tag."
  fi

  # Run the agent in the background
  docker sandbox run claude -- -p "$PROMPT" &
  agent_pid=$!

  # Wait briefly for the new session log to appear
  sleep 5
  new_log=""
  for attempt in $(seq 1 12); do
    current_logs=$(docker sandbox exec "$SANDBOX_NAME" find "$SANDBOX_LOG_DIR" -name "*.jsonl" -not -name "history.jsonl" 2>/dev/null | sort)
    new_log=$(echo "$current_logs" | grep -vxF "$existing_logs" | head -1)
    [ -n "$new_log" ] && break
    sleep 5
  done

  if [ -n "$new_log" ]; then
    echo "Tailing sandbox log: $new_log"
    # Stream assistant text messages in real-time to console
    docker sandbox exec "$SANDBOX_NAME" tail -f "$new_log" 2>/dev/null | \
      jq --unbuffered -r 'select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text' &
    tail_pid=$!
  else
    echo "Warning: could not find session log, no live output"
    tail_pid=""
  fi

  # Poll until Claude process exits inside the sandbox
  echo "Waiting for Claude to finish..."
  while docker sandbox exec "$SANDBOX_NAME" pgrep -x claude >/dev/null 2>&1; do
    sleep 10
  done
  echo "Claude process exited."

  # Kill the docker sandbox run foreground process and log tailer
  kill $agent_pid 2>/dev/null
  wait $agent_pid 2>/dev/null
  [ -n "${tail_pid:-}" ] && kill $tail_pid 2>/dev/null
  tail_pid=""
  agent_pid=""
  sleep 1

  # Get Claude's final summary from the session log and send to Slack
  if [ -n "$new_log" ]; then
    final_summary=$(get_final_summary "$new_log")
    if [ -n "$final_summary" ]; then
      notify "📋 Iteration $i summary:
$final_summary"
    fi
  fi

  # Check for PRD completion signal
  if [ -n "${final_summary:-}" ] && [[ "$final_summary" =~ \<promise\>COMPLETE\</promise\>[[:space:]]*$ ]]; then
    notify "🎉 PRD complete after $i iterations!"
    head_after=$(git rev-parse HEAD 2>/dev/null)
    if [ "$head_before" != "$head_after" ]; then
      commits=$(git log --oneline "${head_before}..HEAD" --format="%h %s" 2>/dev/null | head -10)
      notify "📦 Commits:
$commits"
    fi
    exit 0
  fi

  # Show only commits made during this iteration
  head_after=$(git rev-parse HEAD 2>/dev/null)
  if [ "$head_before" != "$head_after" ]; then
    commits=$(git log --oneline "${head_before}..HEAD" --format="%h %s" 2>/dev/null | head -10)
    notify "📦 Commits:
$commits"
  else
    notify "📦 No new commits this iteration"
  fi

  notify "✅ Iteration $i completed"

  # Stop sandbox to free resources between iterations
  docker sandbox stop "$SANDBOX_NAME" 2>/dev/null
done

notify "⚠️ Reached $iterations iterations without seeing <promise>COMPLETE</promise>."
exit 1
