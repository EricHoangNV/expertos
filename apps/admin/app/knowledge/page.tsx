"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Field, Select, Table } from "@expertos/ui";
import {
  PUBLISH_STATUSES,
  type KnowledgeDocumentDto,
  type PublishStatusValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { listDocuments } from "../../src/lib/admin-client";
import { publishStatusTone, statusLabel } from "../../src/lib/status-tone";

export default function KnowledgeQueuePage() {
  const { getIdToken } = useAuth();
  const [status, setStatus] = useState<PublishStatusValue | "">("");
  const [docs, setDocs] = useState<KnowledgeDocumentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setDocs(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      setDocs(await listDocuments(token, status || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents.");
    }
  }, [getIdToken, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Knowledge</div>
          <h1 className="h1">Review queue</h1>
        </div>
        <Field label="Status">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as PublishStatusValue | "")}
          >
            <option value="">All</option>
            {PUBLISH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {docs != null && docs.length === 0 && <p className="muted">No documents in this view.</p>}
      {docs != null && docs.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Scope</th>
              <th>Lang</th>
              <th>Status</th>
              <th>Versions</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td>
                  <Link href={`/knowledge/${doc.id}`}>{doc.title}</Link>
                </td>
                <td className="mono">{doc.scope}</td>
                <td className="mono">{doc.language}</td>
                <td>
                  <Badge tone={publishStatusTone(doc.status)}>{statusLabel(doc.status)}</Badge>
                </td>
                <td>{doc.versionCount}</td>
                <td className="muted">{new Date(doc.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AdminFrame>
  );
}
