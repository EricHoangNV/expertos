"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Table } from "@expertos/ui";
import type { AdminAuditLogDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getAuditLogs } from "../../src/lib/admin-client";
import { useT } from "../../src/lib/i18n";

const PAGE_SIZE = 50;

/** Render a metadata object compactly (`key=value · …`); null → an em dash. */
function renderMetadata(metadata: Record<string, unknown> | null): string {
  if (metadata == null) return "—";
  return Object.entries(metadata)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" · ");
}

export default function AuditPage() {
  const t = useT("audit");
  const { getIdToken } = useAuth();
  const [rows, setRows] = useState<AdminAuditLogDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(
    async (offset: number) => {
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError(t("signInError"));
          return;
        }
        const page = await getAuditLogs(token, { limit: PAGE_SIZE, offset });
        setHasMore(page.length === PAGE_SIZE);
        setRows((prev) => (offset === 0 || prev == null ? page : [...prev, ...page]));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadError"));
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
          <p className="muted">{t("subtitle")}</p>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {rows != null && rows.length === 0 && <p className="muted">{t("empty")}</p>}

      {rows != null && rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>{t("col.when")}</th>
              <th>{t("col.actor")}</th>
              <th>{t("col.action")}</th>
              <th>{t("col.target")}</th>
              <th>{t("col.detail")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="muted mono">{new Date(row.createdAt).toLocaleString()}</td>
                <td>{row.actorEmail ?? <span className="muted">{t("actorDeleted")}</span>}</td>
                <td>
                  <Badge tone="ink">{row.action}</Badge>
                </td>
                <td className="muted mono">
                  {row.targetType != null ? `${row.targetType}:${row.targetId ?? "—"}` : "—"}
                </td>
                <td className="muted">{renderMetadata(row.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {hasMore && (
        <Button variant="ghost" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? t("loading") : t("loadMore")}
        </Button>
      )}
    </AdminFrame>
  );
}
