"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@expertos/ui";
import type {
  AdminExpertSummaryDto,
  ReviewQueueDetailDto,
  ReviewQueueItemDto,
  ReviewVerdictValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import {
  getConciergeReview,
  getConciergeReviews,
  listExperts,
  respondConciergeReview,
} from "../../src/lib/admin-client";

/** Page size for the review queue. */
const PAGE_SIZE = 25;

/** A queue request a reviewer can still act on. */
const RESPONDABLE = new Set(["requested", "in_review"]);

/**
 * Concierge review queue (M9.2, PRD §"Expert portal" → "Concierge review queue"). The answers a
 * low-confidence Mode-B turn flagged for human review, scoped to the reviewer's voice. A reviewer
 * opens an item to see the prompting question + full answer, then records a verdict (Good / Bad /
 * Great) with an optional edited answer. An admin reviews a chosen expert's queue.
 */
export default function ConciergeReviewsPage() {
  const { getIdToken, role } = useAuth();
  const isAdmin = role === "admin";
  const [experts, setExperts] = useState<AdminExpertSummaryDto[]>([]);
  const [expertId, setExpertId] = useState("");
  const [rows, setRows] = useState<ReviewQueueItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) {
          return;
        }
        setExperts(await listExperts(token, { active: true }));
      } catch {
        /* a roster failure surfaces on the queue load below */
      }
    })();
  }, [isAdmin, getIdToken]);

  const loadPage = useCallback(
    async (offset: number) => {
      if (role === null) {
        return;
      }
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
    void loadPage(0);
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    await loadPage(rows?.length ?? 0);
    setLoadingMore(false);
  }, [loadPage, rows]);

  const onAnswered = useCallback(() => {
    void loadPage(0);
  }, [loadPage]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Concierge</div>
          <h1 className="h1">Review queue</h1>
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
      <p className="muted">
        Answers flagged for human review, most-urgent first. Open one to see the question and full
        answer, then record a verdict and an optional edited answer.
      </p>

      {error != null && <Badge tone="red">{error}</Badge>}
      {isAdmin && expertId === "" && (
        <p className="muted">Select an expert to review their queue.</p>
      )}
      {rows != null && rows.length === 0 && (
        <p className="muted">Nothing awaiting review in this voice.</p>
      )}

      {rows != null && rows.length > 0 && (
        <div className="col gap3">
          {rows.map((row) => (
            <ReviewItem
              key={row.id}
              item={row}
              expertId={isAdmin ? expertId : undefined}
              onAnswered={onAnswered}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <Button variant="ghost" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </AdminFrame>
  );
}

/** A verdict's badge tone. */
function verdictTone(verdict: ReviewVerdictValue): "green" | "red" | "info" {
  if (verdict === "great") return "green";
  if (verdict === "bad") return "red";
  return "info";
}

/** One queue item — expandable to the detail + respond form. */
function ReviewItem({
  item,
  expertId,
  onAnswered,
}: {
  item: ReviewQueueItemDto;
  expertId?: string;
  onAnswered: () => void;
}) {
  const { getIdToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ReviewQueueDetailDto | null>(null);
  const [verdict, setVerdict] = useState<ReviewVerdictValue>("good");
  const [revised, setRevised] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const respondable = RESPONDABLE.has(item.status);

  const expand = useCallback(async () => {
    setOpen(true);
    if (detail != null) {
      return;
    }
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      const d = await getConciergeReview(token, item.id, expertId);
      setDetail(d);
      setRevised(d.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the review.");
    }
  }, [detail, getIdToken, item.id, expertId]);

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
      onAnswered();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record the verdict.");
    } finally {
      setBusy(false);
    }
  }, [getIdToken, item.id, expertId, verdict, revised, notes, detail, onAnswered]);

  return (
    <Card pad>
      <div className="row gap2">
        <Badge tone={item.status === "answered" ? "green" : "amber"}>{item.status}</Badge>
        {item.visibility === "silent" && <Badge tone="ink">silent</Badge>}
        {item.confidenceScore != null && (
          <Badge tone="info">confidence {item.confidenceScore.toFixed(2)}</Badge>
        )}
        {item.latestVerdict != null && (
          <Badge tone={verdictTone(item.latestVerdict)}>{item.latestVerdict}</Badge>
        )}
        <span className="grow" />
        {item.slaDueAt != null && (
          <span className="muted mono">due {new Date(item.slaDueAt).toLocaleString()}</span>
        )}
      </div>

      <div className="label">Answer</div>
      <p>{item.answerPreview}</p>

      {!open && (
        <Button variant="ghost" onClick={() => void expand()}>
          {respondable ? "Review" : "View"}
        </Button>
      )}

      {open && (
        <div className="col gap2">
          {error != null && <Badge tone="red">{error}</Badge>}
          {detail == null && error == null && <p className="muted">Loading…</p>}
          {detail != null && (
            <>
              <div className="label">Question</div>
              <p>{detail.question ?? <span className="muted">— (question not found)</span>}</p>

              <div className="label">Full answer</div>
              <p>{detail.answer}</p>

              {detail.responses.length > 0 && (
                <>
                  <div className="label">Previous responses</div>
                  {detail.responses.map((r) => (
                    <div key={r.id} className="row gap2">
                      <Badge tone={verdictTone(r.verdict)}>{r.verdict}</Badge>
                      {r.edited && <Badge tone="info">edited</Badge>}
                      <span className="muted mono">{new Date(r.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </>
              )}

              {respondable && (
                <>
                  <Field label="Verdict">
                    <Select
                      value={verdict}
                      onChange={(e) => setVerdict(e.target.value as ReviewVerdictValue)}
                    >
                      <option value="good">Good</option>
                      <option value="great">Great</option>
                      <option value="bad">Bad</option>
                    </Select>
                  </Field>
                  <Field label="Edited answer (optional — leave unchanged to keep the original)">
                    <Textarea rows={6} value={revised} onChange={(e) => setRevised(e.target.value)} />
                  </Field>
                  <Field label="Notes (optional)">
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                  <div className="row gap2">
                    <Button onClick={() => void submit()} disabled={busy}>
                      {busy ? "Saving…" : "Record verdict"}
                    </Button>
                    <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
              {!respondable && (
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
