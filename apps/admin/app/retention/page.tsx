"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Stat } from "@expertos/ui";
import type { RetentionPreviewDto, RetentionSweepResultDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getRetentionPreview, runRetentionSweep } from "../../src/lib/admin-client";
import { useT } from "../../src/lib/i18n";

/**
 * Admin data-retention surface (NT.3, PRD §"Non-Technical Requirements" → "Data Retention &
 * Deletion Policy"). The published policy promises several data classes are auto-deleted past their
 * retention window; this page exposes the sweeper that enforces it. "Preview" is a non-destructive
 * dry run (counts only); "Run sweep" deletes the expired rows and is audited. In production a Cloud
 * Scheduler job hits the same `sweep` endpoint on a cadence — this page is the manual/observation
 * surface (PRD §"No full infra Day 1": no in-app cron).
 */
export default function RetentionPage() {
  const t = useT("retention");
  const { getIdToken } = useAuth();
  const [preview, setPreview] = useState<RetentionPreviewDto | null>(null);
  const [result, setResult] = useState<RetentionSweepResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadPreview = useCallback(async () => {
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("signInError"));
        return;
      }
      setPreview(await getRetentionPreview(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("previewError"));
    }
  }, [getIdToken, t]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  /** Run the destructive sweep, then refresh the preview (should drop to zero for what was purged). */
  const runSweep = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("signInError"));
        return;
      }
      setResult(await runRetentionSweep(token));
      await loadPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sweepError"));
    } finally {
      setRunning(false);
    }
  }, [getIdToken, loadPreview, t]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("title")}</h1>
        </div>
      </div>
      <p className="muted">{t("intro")}</p>

      <Card pad>
        <div className="label">{t("eligibleNow")}</div>
        {preview != null ? (
          <div className="row gap1">
            <Stat
              label={t("preview.temporaryUploads")}
              value={preview.temporaryUploads.toLocaleString()}
            />
            <Stat
              label={t("preview.expiredConversations")}
              value={preview.expiredConversations.toLocaleString()}
            />
            <Stat label={t("preview.oldUsageLogs")} value={preview.oldUsageLogs.toLocaleString()} />
            <Stat
              label={t("preview.consultationTranscripts")}
              value={preview.consultationTranscripts.toLocaleString()}
            />
            <Stat
              label={t("preview.conciergeRecords")}
              value={preview.conciergeRecords.toLocaleString()}
            />
          </div>
        ) : (
          <p className="muted">{t("loading")}</p>
        )}
        <div className="row gap2">
          <Button variant="ghost" onClick={() => void loadPreview()} disabled={running}>
            {t("refreshPreview")}
          </Button>
          <Button variant="primary" onClick={() => void runSweep()} disabled={running}>
            {running ? t("sweeping") : t("runSweep")}
          </Button>
          <span className="muted">{t("cronNote")}</span>
        </div>
      </Card>

      {error != null && <Badge tone="red">{error}</Badge>}

      {result != null && (
        <Card pad>
          <div className="row gap2">
            <Badge tone="green">{t("sweepComplete")}</Badge>
            <span className="muted mono">{new Date(result.sweptAt).toLocaleString()}</span>
          </div>
          <div className="row gap1">
            <Stat
              label={t("result.temporaryUploads")}
              value={result.temporaryUploads.toLocaleString()}
            />
            <Stat
              label={t("result.expiredConversations")}
              value={result.expiredConversations.toLocaleString()}
            />
            <Stat label={t("result.oldUsageLogs")} value={result.oldUsageLogs.toLocaleString()} />
            <Stat
              label={t("result.consultationTranscripts")}
              value={result.consultationTranscripts.toLocaleString()}
            />
            <Stat
              label={t("result.conciergeRecords")}
              value={result.conciergeRecords.toLocaleString()}
            />
          </div>
        </Card>
      )}
    </AdminFrame>
  );
}
