"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Select } from "@expertos/ui";
import type { AdminExpertSummaryDto, ExpertAnswerReviewDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getExpertAnswers, listExperts } from "../../src/lib/admin-client";

/** Page size for the answer-review feed. */
const PAGE_SIZE = 25;

/**
 * Expert AI-answer review feed (M8.5). The answers rendered in the expert's voice, newest first,
 * each with the prompting question and the user's feedback verdict — so the expert can spot weak
 * answers and route them into the knowledge / draft pipelines. An admin reviews a chosen expert.
 */
export default function AnswersPage() {
  const { getIdToken, role } = useAuth();
  const isAdmin = role === "admin";
  const [experts, setExperts] = useState<AdminExpertSummaryDto[]>([]);
  const [expertId, setExpertId] = useState("");
  const [rows, setRows] = useState<ExpertAnswerReviewDto[] | null>(null);
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
        /* a roster failure surfaces on the feed load below */
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
        const page = await getExpertAnswers(token, {
          expertId: isAdmin ? expertId : undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setHasMore(page.length === PAGE_SIZE);
        setRows((prev) => (offset === 0 || prev == null ? page : [...prev, ...page]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load answers.");
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

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Quality</div>
          <h1 className="h1">AI answers</h1>
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
        Answers generated in this expert&rsquo;s voice, newest first — review them for fidelity and feed
        weak ones back into knowledge.
      </p>

      {error != null && <Badge tone="red">{error}</Badge>}
      {isAdmin && expertId === "" && <p className="muted">Select an expert to review their answers.</p>}
      {rows != null && rows.length === 0 && (
        <p className="muted">No answers have been generated in this voice yet.</p>
      )}

      {rows != null && rows.length > 0 && (
        <div className="col gap3">
          {rows.map((row) => (
            <Card key={row.messageId} pad>
              <div className="row gap2">
                {row.helpful === true && <Badge tone="green">Helpful</Badge>}
                {row.helpful === false && <Badge tone="red">Unhelpful</Badge>}
                {row.insufficientKnowledge && <Badge tone="amber">Insufficient knowledge</Badge>}
                {row.model != null && <Badge tone="info">{row.model}</Badge>}
                {row.confidence != null && (
                  <Badge tone="ink">confidence {row.confidence.toFixed(2)}</Badge>
                )}
                <span className="grow" />
                <span className="muted mono">{new Date(row.createdAt).toLocaleString()}</span>
              </div>

              <div className="label">Question</div>
              <p>{row.question ?? <span className="muted">— (question not found)</span>}</p>

              <div className="label">Answer</div>
              <p>{row.answer}</p>

              {row.feedbackReason != null && (
                <>
                  <div className="label">Feedback</div>
                  <p className="muted">{row.feedbackReason}</p>
                </>
              )}
            </Card>
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
