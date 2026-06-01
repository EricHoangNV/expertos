"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Table } from "@expertos/ui";
import type { KnowledgeDocumentDetailDto, KnowledgeVersionDto } from "@expertos/shared";
import { AdminFrame } from "../../../src/components/AdminFrame";
import { useAuth } from "../../../src/lib/auth-context";
import { versionAction, getDocument, type VersionAction } from "../../../src/lib/admin-client";
import { publishStatusTone, statusLabel } from "../../../src/lib/status-tone";

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

const ACTION_LABEL: Record<VersionAction, string> = {
  submit: "Submit for review",
  approve: "Approve & publish",
  "request-changes": "Request changes",
  archive: "Archive",
};

export default function KnowledgeDetailPage() {
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
        setError("Please sign in to continue.");
        return;
      }
      setDoc(await getDocument(token, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document.");
    }
  }, [getIdToken, id]);

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
          setError("Please sign in to continue.");
          return;
        }
        await versionAction(token, versionId, action);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed.");
      } finally {
        setBusy(false);
      }
    },
    [getIdToken, load],
  );

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            <Link href="/knowledge">← Knowledge</Link>
          </div>
          <h1 className="h1">{doc?.title ?? "Document"}</h1>
          {doc != null && (
            <p className="muted mono">
              {doc.scope} · {doc.language} · {doc.versionCount} version
              {doc.versionCount === 1 ? "" : "s"}
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
              <th>Version</th>
              <th>Status</th>
              <th>Chunks</th>
              <th>Change summary</th>
              <th>Created</th>
              <th>Actions</th>
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
                      <Badge tone="green">live</Badge>
                    </>
                  )}
                </td>
                <td>
                  <Badge tone={publishStatusTone(version.status)}>
                    {statusLabel(version.status)}
                  </Badge>
                </td>
                <td>{version.chunkCount}</td>
                <td className="muted">{version.changeSummary ?? "—"}</td>
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
                        {ACTION_LABEL[action]}
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
