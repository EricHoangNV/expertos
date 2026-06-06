"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@expertos/ui";
import type { FailedQueryDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getFailedQueries } from "../../src/lib/admin-client";
import { useT } from "../../src/lib/i18n";

/** Page size for the inspector feed. */
const PAGE_SIZE = 50;

export default function FailedQueriesPage() {
  const t = useT("failedQueries");
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
          setError(t("errors.signIn"));
          return;
        }
        const page = await getFailedQueries(token, { limit: PAGE_SIZE, offset });
        setHasMore(page.length === PAGE_SIZE);
        setRows((prev) => (offset === 0 || prev == null ? page : [...prev, ...page]));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errors.load"));
      }
    },
    [getIdToken, t],
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
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("title")}</h1>
        </div>
      </div>
      <p className="lede">{t("intro")}</p>

      {error != null && <Badge tone="red">{error}</Badge>}
      {rows != null && rows.length === 0 && <p className="muted">{t("emptyFlagged")}</p>}

      {rows != null && rows.length > 0 && (
        <div className="col gap3">
          {rows.map((row) => (
            <Card key={row.feedbackId} pad>
              <div className="row gap2">
                {row.insufficientKnowledge && (
                  <Badge tone="amber">{t("insufficientKnowledge")}</Badge>
                )}
                {row.model != null && <Badge tone="info">{row.model}</Badge>}
                {row.confidence != null && (
                  <Badge tone="ink">{t("confidence", { value: row.confidence.toFixed(2) })}</Badge>
                )}
                <span className="grow" />
                <span className="muted mono">{new Date(row.createdAt).toLocaleString()}</span>
              </div>

              <div className="label">{t("question")}</div>
              <p>{row.question ?? <span className="muted">{t("questionMissing")}</span>}</p>

              <div className="label">{t("answer")}</div>
              <p>{row.answer}</p>

              {row.reason != null && (
                <>
                  <div className="label">{t("reason")}</div>
                  <p className="muted">{row.reason}</p>
                </>
              )}

              <div className="row">
                <Link href="/knowledge-drafts" className="btn btn-primary btn-sm">
                  {t("draftKnowledge")}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {hasMore && (
        <Button variant="ghost" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? t("loading") : t("loadMore")}
        </Button>
      )}
    </AdminFrame>
  );
}
