"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Stat } from "@expertos/ui";
import type { RetentionPreviewDto, RetentionSweepResultDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getRetentionPreview, runRetentionSweep } from "../../src/lib/admin-client";

/**
 * Admin data-retention surface (NT.3, PRD §"Non-Technical Requirements" → "Data Retention &
 * Deletion Policy"). The published policy promises several data classes are auto-deleted past their
 * retention window; this page exposes the sweeper that enforces it. "Preview" is a non-destructive
 * dry run (counts only); "Run sweep" deletes the expired rows and is audited. In production a Cloud
 * Scheduler job hits the same `sweep` endpoint on a cadence — this page is the manual/observation
 * surface (PRD §"No full infra Day 1": no in-app cron).
 */
export default function RetentionPage() {
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
        setError("Please sign in to continue.");
        return;
      }
      setPreview(await getRetentionPreview(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the retention preview.");
    }
  }, [getIdToken]);

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
        setError("Please sign in to continue.");
        return;
      }
      setResult(await runRetentionSweep(token));
      await loadPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retention sweep failed.");
    } finally {
      setRunning(false);
    }
  }, [getIdToken, loadPreview]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Compliance</div>
          <h1 className="h1">Data retention</h1>
        </div>
      </div>
      <p className="muted">
        Enforces the published retention policy: expired temporary uploads, conversation history past
        its window, and aged usage logs are deleted. Preview is non-destructive; running the sweep
        deletes the rows and is recorded in the audit log. Consultation transcripts and concierge
        records are handled separately (anonymized, not deleted).
      </p>

      <Card pad>
        <div className="label">Eligible for deletion now</div>
        {preview != null ? (
          <div className="row gap1">
            <Stat label="Temporary uploads" value={preview.temporaryUploads} />
            <Stat label="Idle conversations" value={preview.expiredConversations} />
            <Stat label="Old usage logs" value={preview.oldUsageLogs} />
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
        <div className="row gap2">
          <Button variant="ghost" onClick={() => void loadPreview()} disabled={running}>
            Refresh preview
          </Button>
          <Button variant="primary" onClick={() => void runSweep()} disabled={running}>
            {running ? "Sweeping…" : "Run sweep"}
          </Button>
        </div>
      </Card>

      {error != null && <Badge tone="red">{error}</Badge>}

      {result != null && (
        <Card pad>
          <div className="row gap2">
            <Badge tone="green">Sweep complete</Badge>
            <span className="muted mono">{new Date(result.sweptAt).toLocaleString()}</span>
          </div>
          <div className="row gap1">
            <Stat label="Uploads deleted" value={result.temporaryUploads} />
            <Stat label="Conversations deleted" value={result.expiredConversations} />
            <Stat label="Usage logs deleted" value={result.oldUsageLogs} />
          </div>
        </Card>
      )}
    </AdminFrame>
  );
}
