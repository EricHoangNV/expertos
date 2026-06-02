"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Select, Textarea } from "@expertos/ui";
import type {
  AdminExpertSummaryDto,
  ReviewQueueDetailDto,
  ReviewQueueItemDto,
  ReviewTriggerModeValue,
  ReviewVerdictValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import {
  escalateConciergeReview,
  getConciergeReview,
  getConciergeReviews,
  listExperts,
  respondConciergeReview,
} from "../../src/lib/admin-client";

/** How many items to pull per page from the queue API. */
const PAGE_SIZE = 50;

/** Statuses a reviewer can still act on (the "Open" bucket). */
const OPEN_STATUSES = new Set(["requested", "in_review"]);

/** Triage filter tabs (M13.6.2). */
type QueueTab = "open" | "mine" | "done";

/** The default concierge SLA (M9.1) — shown as a header chip; the per-item deadline drives urgency. */
const SLA_HOURS = 24;

export default function ConciergeReviewsPage() {
  const { getIdToken, role } = useAuth();
  const isAdmin = role === "admin";
  const [experts, setExperts] = useState<AdminExpertSummaryDto[]>([]);
  const [expertId, setExpertId] = useState("");
  const [rows, setRows] = useState<ReviewQueueItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<QueueTab>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Admin must pick whose queue to review; an expert is scoped to their own voice by the API.
  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        setExperts(await listExperts(token, { active: true }));
      } catch {
        /* a roster failure surfaces on the queue load below */
      }
    })();
  }, [isAdmin, getIdToken]);

  const loadPage = useCallback(
    async (offset: number) => {
      if (role === null) return;
      setError(null);
      if (isAdmin && expertId === "") {
        setRows(null);
        return;
      }
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to continue.");
          return;
        }
        const page = await getConciergeReviews(token, {
          expertId: isAdmin ? expertId : undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setHasMore(page.length === PAGE_SIZE);
        setRows((prev) => (offset === 0 || prev == null ? page : [...prev, ...page]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load the review queue.");
      }
    },
    [getIdToken, role, isAdmin, expertId],
  );

  useEffect(() => {
    setSelectedId(null);
    void loadPage(0);
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    await loadPage(rows?.length ?? 0);
    setLoadingMore(false);
  }, [loadPage, rows]);

  // After a verdict/escalation commits, reload from the top and clear the open item.
  const onResolved = useCallback(() => {
    setSelectedId(null);
    void loadPage(0);
  }, [loadPage]);

  // Bucket the loaded queue by triage tab. "Mine" surfaces claimed items — the DTO carries no
  // claimer identity, so this is the closest honest signal (an item a reviewer has picked up).
  const filtered = useMemo(() => {
    if (rows == null) return null;
    if (tab === "open") return rows.filter((r) => OPEN_STATUSES.has(r.status));
    if (tab === "mine") return rows.filter((r) => r.claimedAt != null);
    return rows.filter((r) => !OPEN_STATUSES.has(r.status));
  }, [rows, tab]);

  const openCount = useMemo(
    () => (rows == null ? 0 : rows.filter((r) => OPEN_STATUSES.has(r.status)).length),
    [rows],
  );

  // Auto-select the first item in the active tab so the detail pane is never an empty gap.
  useEffect(() => {
    if (filtered == null || filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev != null && filtered.some((r) => r.id === prev) ? prev : filtered[0].id,
    );
  }, [filtered]);

  const selected = filtered?.find((r) => r.id === selectedId) ?? null;

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Concierge · human-in-the-loop</div>
          <h1 className="h1">Review queue</h1>
          <p className="muted">
            Answers flagged for human review, most-urgent first. Open one to see the question and
            full answer, record a verdict, and optionally push a refined update.
          </p>
        </div>
        {isAdmin && (
          <Field label="Expert">
            <Select value={expertId} onChange={(e) => setExpertId(e.target.value)}>
              <option value="">Select an expert…</option>
              {experts.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.displayName}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {isAdmin && expertId === "" && (
        <p className="muted">Select an expert to review their queue.</p>
      )}

      {(!isAdmin || expertId !== "") && (
        <div className="review-pane">
          <aside className="queue-list" aria-label="Review queue">
            <div className="queue-list-head">
              <div className="queue-list-title">
                <span className="label">
                  Queue · {openCount} open
                </span>
                <Badge tone="amber">SLA {SLA_HOURS}h</Badge>
              </div>
              <div className="seg" role="tablist" aria-label="Filter reviews">
                {(["open", "mine", "done"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    className={tab === t ? "active" : undefined}
                    onClick={() => setTab(t)}
                  >
                    {t === "open" ? "Open" : t === "mine" ? "Mine" : "Done"}
                  </button>
                ))}
              </div>
            </div>
            <div className="queue-list-body">
              {filtered == null && <p className="muted queue-empty">Loading…</p>}
              {filtered != null && filtered.length === 0 && (
                <p className="muted queue-empty">
                  {tab === "open"
                    ? "Nothing awaiting review."
                    : tab === "mine"
                      ? "No claimed reviews."
                      : "No completed reviews yet."}
                </p>
              )}
              {filtered?.map((item) => (
                <QueueItem
                  key={item.id}
                  item={item}
                  active={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))}
              {hasMore && (
                <div className="queue-empty">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </div>
          </aside>

          <section className="review-detail" aria-label="Review detail">
            {selected == null ? (
              <p className="muted">Select a review to see the question, answer, and verdict.</p>
            ) : (
              <ReviewDetailPane
                key={selected.id}
                item={selected}
                expertId={isAdmin ? expertId : undefined}
                onResolved={onResolved}
              />
            )}
          </section>
        </div>
      )}
    </AdminFrame>
  );
}

/** A verdict's badge tone (shared with the previous-responses list). */
function verdictTone(verdict: ReviewVerdictValue): "green" | "red" | "info" {
  if (verdict === "great") return "green";
  if (verdict === "bad") return "red";
  return "info";
}

/** Mode badge label + tone (M13.6.2): Mode B is silent/ink, Mode A is user-prompted/amber. */
function modeBadge(mode: ReviewTriggerModeValue): { label: string; tone: "ink" | "amber" } {
  return mode === "auto_silent"
    ? { label: "Auto · silent", tone: "ink" }
    : { label: "User-prompted", tone: "amber" };
}

/** "3h ago" style elapsed time since an ISO timestamp. */
function elapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** SLA remaining (or overdue) from an ISO deadline, e.g. "21h 04m left" / "3h overdue". */
function slaLabel(slaDueAt: string): string {
  const ms = new Date(slaDueAt).getTime() - Date.now();
  const overdue = ms < 0;
  const totalMins = Math.round(Math.abs(ms) / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const span = `${hrs}h ${String(mins).padStart(2, "0")}m`;
  return overdue ? `${span} overdue` : `${span} left`;
}

/** One row in the queue list — truncated answer preview + mode/confidence/time badges. */
function QueueItem({
  item,
  active,
  onSelect,
}: {
  item: ReviewQueueItemDto;
  active: boolean;
  onSelect: () => void;
}) {
  const mode = modeBadge(item.triggerMode);
  return (
    <button
      type="button"
      className={active ? "queue-item is-active" : "queue-item"}
      aria-current={active}
      onClick={onSelect}
    >
      <p className="queue-item-q">{item.answerPreview}</p>
      <div className="queue-item-meta">
        <Badge tone={mode.tone}>{mode.label}</Badge>
        {item.confidenceScore != null && (
          <Badge tone="red">conf {item.confidenceScore.toFixed(2)}</Badge>
        )}
        {item.latestVerdict != null && (
          <Badge tone={verdictTone(item.latestVerdict)}>{item.latestVerdict}</Badge>
        )}
        <span className="grow" />
        <span className="queue-item-time">{elapsed(item.createdAt)}</span>
      </div>
    </button>
  );
}

/** Check / X / star glyphs for the verdict cards. */
function VerdictIcon({ verdict }: { verdict: ReviewVerdictValue }) {
  const cls =
    verdict === "bad"
      ? "verdict-card-icon is-bad"
      : verdict === "good"
        ? "verdict-card-icon is-good"
        : "verdict-card-icon is-great";
  return (
    <span className={cls} aria-hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {verdict === "bad" && (
          <>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </>
        )}
        {verdict === "good" && <path d="M20 6 9 17l-5-5" />}
        {verdict === "great" && (
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" />
        )}
      </svg>
    </span>
  );
}

const VERDICT_OPTIONS: { verdict: ReviewVerdictValue; name: string; note: string }[] = [
  { verdict: "bad", name: "Bad", note: "Flags the source chunks" },
  { verdict: "good", name: "Good", note: "Deliver as-is" },
  { verdict: "great", name: "Great", note: "→ becomes a voice example" },
];

/** The review detail pane (M13.6.3–13.6.8): question, AI answer, verdict, refined edit, actions. */
function ReviewDetailPane({
  item,
  expertId,
  onResolved,
}: {
  item: ReviewQueueItemDto;
  expertId?: string;
  onResolved: () => void;
}) {
  const { getIdToken } = useAuth();
  const [detail, setDetail] = useState<ReviewQueueDetailDto | null>(null);
  const [verdict, setVerdict] = useState<ReviewVerdictValue>("good");
  const [revised, setRevised] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const respondable = OPEN_STATUSES.has(item.status);
  const mode = modeBadge(item.triggerMode);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDetail(null);
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) {
          if (!cancelled) setError("Please sign in to continue.");
          return;
        }
        const d = await getConciergeReview(token, item.id, expertId);
        if (cancelled) return;
        setDetail(d);
        setRevised(d.answer);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the review.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, item.id, expertId]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      const original = detail?.answer ?? "";
      await respondConciergeReview(
        token,
        item.id,
        {
          verdict,
          revisedAnswer: revised.trim() === "" || revised === original ? null : revised,
          notes: notes.trim() === "" ? null : notes,
        },
        expertId,
      );
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record the verdict.");
    } finally {
      setBusy(false);
    }
  }, [getIdToken, item.id, expertId, verdict, revised, notes, detail, onResolved]);

  const escalate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      await escalateConciergeReview(
        token,
        item.id,
        { consultationTypeKey: null, notes: notes.trim() === "" ? null : notes },
        expertId,
      );
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to escalate the review.");
    } finally {
      setBusy(false);
    }
  }, [getIdToken, item.id, expertId, notes, onResolved]);

  const lowConfidence = item.confidenceScore != null && item.confidenceScore < 0.5;
  const edited = detail != null && revised.trim() !== "" && revised !== detail.answer;

  return (
    <>
      {/* Header row (M13.6.3) — mode / confidence / SLA. Claim is omitted: no claim endpoint exists. */}
      <div className="review-detail-head">
        <Badge tone={mode.tone} dot>
          {mode.label}
        </Badge>
        {item.confidenceScore != null && (
          <Badge tone="red" dot>
            Confidence {item.confidenceScore.toFixed(2)}
          </Badge>
        )}
        {item.slaDueAt != null && (
          <Badge tone="amber" dot>
            SLA {slaLabel(item.slaDueAt)}
          </Badge>
        )}
        <span className="grow" />
        <Badge tone={item.status === "requested" || item.status === "in_review" ? "amber" : "green"}>
          {item.status}
        </Badge>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {detail == null && error == null && <p className="muted">Loading…</p>}

      {detail != null && (
        <>
          {/* User question (M13.6.4) — dark bubble + retrieval/flag context. */}
          <div className="review-section">
            <span className="label">User question</span>
            <div className="dark-card card-pad">
              <p className="review-q">
                {detail.question ?? <span className="muted">— (question not found)</span>}
              </p>
            </div>
            <p className="muted">
              {lowConfidence
                ? `Low retrieval confidence (${item.confidenceScore?.toFixed(2)}).`
                : "Flagged for human review."}{" "}
              {item.visibility === "silent"
                ? "Silent shadow review — the user already saw a hedged answer."
                : "User-visible — the user opted in to a human review."}
            </p>
          </div>

          {/* AI answer (M13.6.5) — what the user saw; editing pushes a refined update. */}
          <div className="review-section">
            <span className="label">AI answer · user saw this</span>
            <div className="panel card-pad col gap2">
              <div className="row gap2">
                <Badge tone="ink">AI rendition</Badge>
                {lowConfidence && <Badge tone="amber">low confidence</Badge>}
              </div>
              <p className="review-answer">{detail.answer}</p>
            </div>
          </div>

          {detail.responses.length > 0 && (
            <div className="review-section">
              <span className="label">Previous responses</span>
              {detail.responses.map((r) => (
                <div key={r.id} className="row gap2">
                  <Badge tone={verdictTone(r.verdict)}>{r.verdict}</Badge>
                  {r.edited && <Badge tone="info">edited</Badge>}
                  {r.deliveredToUser && <Badge tone="green">delivered</Badge>}
                  <span className="muted mono">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {respondable && (
            <>
              {/* Verdict (M13.6.6) — selectable Bad / Good / Great cards. */}
              <div className="review-section">
                <span className="label">Your verdict</span>
                <div className="verdict-grid">
                  {VERDICT_OPTIONS.map((opt) => (
                    <button
                      key={opt.verdict}
                      type="button"
                      className={verdict === opt.verdict ? "verdict-card is-active" : "verdict-card"}
                      aria-pressed={verdict === opt.verdict}
                      disabled={busy}
                      onClick={() => setVerdict(opt.verdict)}
                    >
                      <span className="verdict-card-name">
                        <VerdictIcon verdict={opt.verdict} />
                        {opt.name}
                      </span>
                      <span className="verdict-card-note">{opt.note}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Refined answer (M13.6.7) — pre-filled, editable; editing → visible delivery (M9.3). */}
              <div className="review-section">
                <span className="label">Refined answer</span>
                <Textarea
                  rows={8}
                  value={revised}
                  disabled={busy}
                  onChange={(e) => setRevised(e.target.value)}
                />
                <Field label="Notes (optional)">
                  <Textarea
                    rows={2}
                    value={notes}
                    disabled={busy}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
                <p className="muted review-flywheel">
                  Reviewer-feedback flywheel: <strong>immediate</strong> — injected into this
                  conversation&apos;s context; <strong>global</strong> — great/edited answers feed
                  future retrieval &amp; voice examples.
                </p>
              </div>

              {/* Action bar (M13.6.8). Dismiss is omitted: no dismiss endpoint exists. */}
              <div className="review-actions">
                <Button variant="primary" onClick={() => void submit()} disabled={busy}>
                  {busy ? "Saving…" : edited ? "Push refined update" : "Record verdict"}
                </Button>
                <Button variant="dark" onClick={() => void escalate()} disabled={busy}>
                  Escalate to paid consultation
                </Button>
                <span className="grow" />
                <span className="muted">User notified by email on delivery.</span>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
