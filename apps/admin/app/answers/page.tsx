"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Select } from "@expertos/ui";
import type { AdminExpertSummaryDto, ExpertAnswerReviewDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getExpertAnswers, listExperts } from "../../src/lib/admin-client";
import { useT } from "../../src/lib/i18n";

/** Page size for the answer-review feed. */
const PAGE_SIZE = 25;

/**
 * Expert AI-answer review feed (M8.5). The answers rendered in the expert's voice, newest first,
 * each with the prompting question and the user's feedback verdict — so the expert can spot weak
 * answers and route them into the knowledge / draft pipelines. An admin reviews a chosen expert.
 */
export default function AnswersPage() {
  const { getIdToken, role } = useAuth();
  const t = useT("answers");
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
          setError(t("signIn"));
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
        setError(err instanceof Error ? err.message : t("loadError"));
      }
    },
    [getIdToken, role, isAdmin, expertId, t],
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
          <h1 className="h1">{t("heading")}</h1>
        </div>
        {isAdmin && (
          <Field label={t("expertLabel")}>
            <Select value={expertId} onChange={(e) => setExpertId(e.target.value)}>
              <option value="">{t("selectExpert")}</option>
              {experts.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.displayName}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <p className="muted">{t("intro")}</p>

      {error != null && <Badge tone="red">{error}</Badge>}
      {isAdmin && expertId === "" && <p className="muted">{t("selectExpertPrompt")}</p>}
      {rows != null && rows.length === 0 && <p className="muted">{t("noAnswers")}</p>}

      {rows != null && rows.length > 0 && (
        <div className="col gap3">
          {rows.map((row) => (
            <Card key={row.messageId} pad>
              <div className="row gap2">
                {row.helpful === true && <Badge tone="green">{t("helpful")}</Badge>}
                {row.helpful === false && <Badge tone="red">{t("unhelpful")}</Badge>}
                {row.insufficientKnowledge && <Badge tone="amber">{t("insufficient")}</Badge>}
                {row.model != null && <Badge tone="info">{row.model}</Badge>}
                {row.confidence != null && (
                  <Badge tone="ink">{t("confidence", { value: row.confidence.toFixed(2) })}</Badge>
                )}
                <span className="grow" />
                <span className="muted mono">{new Date(row.createdAt).toLocaleString()}</span>
              </div>

              <div className="label">{t("question")}</div>
              <p>{row.question ?? <span className="muted">{t("questionNotFound")}</span>}</p>

              <div className="label">{t("answer")}</div>
              <p>{row.answer}</p>

              {row.feedbackReason != null && (
                <>
                  <div className="label">{t("feedback")}</div>
                  <p className="muted">{row.feedbackReason}</p>
                </>
              )}
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
