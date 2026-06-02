"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Table } from "@expertos/ui";
import type { KnowledgeDocumentDetailDto, KnowledgeVersionDto } from "@expertos/shared";
import { AdminFrame } from "../../../src/components/AdminFrame";
import { useAuth } from "../../../src/lib/auth-context";
import { versionAction, getDocument, type VersionAction } from "../../../src/lib/admin-client";
import { publishStatusTone } from "../../../src/lib/status-tone";
import { useStatusLabel, useT } from "../../../src/lib/i18n";

/** The lifecycle actions offered for a version, given its current status. */
function actionsFor(version: KnowledgeVersionDto): VersionAction[] {
  switch (version.status) {
    case "draft":
      return ["submit"];
    case "expert_review":
      return ["approve", "request-changes"];
    case "published":
      return ["archive"];
    default:
      return [];
  }
}

/** Action → dictionary key (`knowledge.detail.actions.*`), resolved via the translator at render. */
const ACTION_LABEL_KEY: Record<VersionAction, string> = {
  submit: "detail.actions.submit",
  approve: "detail.actions.approve",
  "request-changes": "detail.actions.requestChanges",
  archive: "detail.actions.archive",
};

export default function KnowledgeDetailPage() {
  const t = useT("knowledge");
  const statusLabel = useStatusLabel();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { getIdToken } = useAuth();
  const [doc, setDoc] = useState<KnowledgeDocumentDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("errors.signIn"));
        return;
      }
      setDoc(await getDocument(token, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.loadDocument"));
    }
  }, [getIdToken, id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (versionId: string, action: VersionAction) => {
      setBusy(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError(t("errors.signIn"));
          return;
        }
        await versionAction(token, versionId, action);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errors.action"));
      } finally {
        setBusy(false);
      }
    },
    [getIdToken, load, t],
  );

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            <Link href="/knowledge">{t("detail.back")}</Link>
          </div>
          <h1 className="h1">{doc?.title ?? t("detail.fallbackTitle")}</h1>
          {doc != null && (
            <p className="muted mono">
              {doc.scope} · {doc.language} ·{" "}
              {doc.versionCount === 1
                ? t("detail.versionCountOne", { count: doc.versionCount })
                : t("detail.versionCountMany", { count: doc.versionCount })}
            </p>
          )}
        </div>
        {doc != null && (
          <Badge tone={publishStatusTone(doc.status)}>{statusLabel(doc.status)}</Badge>
        )}
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}

      {doc != null && (
        <Table>
          <thead>
            <tr>
              <th>{t("detail.colVersion")}</th>
              <th>{t("detail.colStatus")}</th>
              <th>{t("detail.colChunks")}</th>
              <th>{t("detail.colChangeSummary")}</th>
              <th>{t("detail.colCreated")}</th>
              <th>{t("detail.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {doc.versions.map((version) => (
              <tr key={version.id}>
                <td className="mono">
                  v{version.versionNumber}
                  {version.isPublished && (
                    <>
                      {" "}
                      <Badge tone="green">{t("detail.live")}</Badge>
                    </>
                  )}
                </td>
                <td>
                  <Badge tone={publishStatusTone(version.status)}>
                    {statusLabel(version.status)}
                  </Badge>
                </td>
                <td>{version.chunkCount}</td>
                <td className="muted">{version.changeSummary ?? t("detail.noSummary")}</td>
                <td className="muted">{new Date(version.createdAt).toLocaleDateString()}</td>
                <td>
                  <div className="row gap1">
                    {actionsFor(version).map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant={action === "approve" ? "primary" : "subtle"}
                        disabled={busy}
                        onClick={() => void act(version.id, action)}
                      >
                        {t(ACTION_LABEL_KEY[action])}
                      </Button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AdminFrame>
  );
}
