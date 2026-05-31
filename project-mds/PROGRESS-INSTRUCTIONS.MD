# How to Read and Write Progress Files

All agents MUST read this file before reading or updating progress.

---

## File Layout (two files)

| File | Purpose | Size |
|------|---------|------|
| `progress-state.md` | Current State — what's done, test counts, next tasks | ~3 KB |
| `progress-log.md` | Append-only task history — one entry per completed task | Grows forever |

---

## How to READ progress

1. Read `progress-state.md` in full. It is small and always current.
2. Do NOT read `progress-log.md` unless you need detail on a specific past task. If you do, search for a keyword (task name, file path, PRD reference) and read only that entry.

---

## How to WRITE after completing a task

Writing is a multi-step process. All steps are required.

### Step 1 — Overwrite `progress-state.md`

Replace the Current State section with the latest:
- What's now completed
- Current test counts and build status
- What the next tasks are

This is the only file another agent will read, so keep it accurate and current.

### Step 2 — Append to `progress-log.md`

Append a new entry **at the bottom** of `progress-log.md`. Use this format:

```
## [Task title]
**Date:** YYYY-MM-DD
**Ref:** [PRD section / FEEDBACKS cycle / REQUESTS item — whichever triggered this task]

**What was done:**
- Bullet points of work completed

**Key decisions:**
- Why you chose approach A over B
- Trade-offs made

**Files changed:**
- `path/to/file.ts` — what changed and why

**Notes for next iteration:**
- Anything the next agent needs to know
- Unresolved issues, open questions, follow-ups
```

### Step 3 — Update the PRD Task Manifest

Update the Task Manifest in `PRD.md`:
- Change `[ ]` to `[x]` for the task you just completed
- If you completed the last open item in a phase, mark the phase heading as `— COMPLETE`

---

## Rules

- **Never delete or modify existing entries in `progress-log.md`** — it is append-only
- **Always update `progress-state.md`** — an outdated summary misleads the next agent
- **One entry per task** — don't batch multiple unrelated tasks into a single entry
- **Include the ref** — every entry must link back to what triggered it (PRD section, feedback cycle, or request)
- **Be specific in files changed** — list actual paths, not "various files"
- **Notes for next iteration are required** — even if just "None — task is self-contained"

---

## Verification Checklist

After your edit, verify ALL of these:

- [ ] `progress-state.md` reflects your completed work
- [ ] Test counts are updated (run tests if unsure)
- [ ] Next tasks list is accurate
- [ ] Your new entry is appended at the bottom of `progress-log.md`
- [ ] The entry includes Date, Ref, What was done, Key decisions, Files changed, and Notes
- [ ] No existing entries in `progress-log.md` were modified or deleted
- [ ] The PRD Task Manifest is updated (`[ ]` → `[x]`)
