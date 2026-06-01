"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@expertos/ui";
import type { FailedQueryDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getFailedQueries } from "../../src/lib/admin-client";

/** Page size for the inspector feed. */
const PAGE_SIZE = 50;

export default function FailedQueriesPage() {
  const { getIdToken } = useAuth();
  const [rows, setRows] = useState<FailedQueryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  /** Fetch one page; `offset === 0` resets the feed, otherwise appends. */
  const loadPage = useCallback(
    async (offset: number) => {
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to continue.");
          return;
        }
        const page = await getFailedQueries(token, { limit: PAGE_SIZE, offset });
        setHasMore(page.length === PAGE_SIZE);
        setRows((prev) => (offset === 0 || prev == null ? page : [...prev, ...page]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load flagged answers.");
      }
    },
    [getIdToken],
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
          <h1 className="h1">Flagged answers</h1>
        </div>
      </div>
      <p className="muted">
        Answers users rated unhelpful, newest first — across all tenants. Triage these to feed
        weak answers back into knowledge.
      </p>

      {error != null && <Badge tone="red">{error}</Badge>}
      {rows != null && rows.length === 0 && (
        <p className="muted">No answers have been flagged unhelpful.</p>
      )}

      {rows != null && rows.length > 0 && (
        <div className="col gap3">
          {rows.map((row) => (
            <Card key={row.feedbackId} pad>
              <div className="row gap2">
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

              {row.reason != null && (
                <>
                  <div className="label">Reason</div>
                  <p className="muted">{row.reason}</p>
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
