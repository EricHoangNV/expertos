"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Field, Select, Table } from "@expertos/ui";
import {
  KNOWLEDGE_DRAFT_STATUSES,
  type KnowledgeDraftStatusValue,
  type KnowledgeDraftSummaryDto,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { listDrafts } from "../../src/lib/admin-client";
import { draftStatusTone } from "../../src/lib/status-tone";
import { useStatusLabel, useT } from "../../src/lib/i18n";

export default function DraftQueuePage() {
  const t = useT("knowledgeDrafts");
  const statusLabel = useStatusLabel();
  const { getIdToken } = useAuth();
  const [status, setStatus] = useState<KnowledgeDraftStatusValue | "">("");
  const [drafts, setDrafts] = useState<KnowledgeDraftSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setDrafts(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("errors.signIn"));
        return;
      }
      setDrafts(await listDrafts(token, status || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.loadDrafts"));
    }
  }, [getIdToken, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("title")}</h1>
          <p className="lede">{t("lede")}</p>
        </div>
        <Field label={t("statusFilter")}>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as KnowledgeDraftStatusValue | "")}
          >
            <option value="">{t("statusAll")}</option>
            {KNOWLEDGE_DRAFT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {drafts != null && drafts.length === 0 && <p className="muted">{t("empty")}</p>}
      {drafts != null && drafts.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>{t("colTitle")}</th>
              <th>{t("colStatus")}</th>
              <th>{t("colLang")}</th>
              <th>{t("colFromChat")}</th>
              <th>{t("colUpdated")}</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => (
              <tr key={draft.id}>
                <td>
                  <Link href={`/knowledge-drafts/${draft.id}`}>{draft.title}</Link>
                </td>
                <td>
                  <Badge tone={draftStatusTone(draft.status)}>{statusLabel(draft.status)}</Badge>
                </td>
                <td className="mono">{draft.language}</td>
                <td className="muted">
                  {draft.conversationId ? t("fromChatYes") : t("fromChatNo")}
                </td>
                <td className="muted">{new Date(draft.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AdminFrame>
  );
}
