"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Stat } from "@expertos/ui";
import type {
  BookingReconcileResultDto,
  UnmatchedBookingEventDto,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getUnmatchedBookings, reconcileBookings } from "../../src/lib/admin-client";

/** Page size for the unmatched-booking feed. */
const PAGE_SIZE = 50;

/**
 * Admin TidyCal reconciliation surface (M7.3, resolves Open Decision #10 end-to-end). Booking
 * confirmations normally arrive by webhook; a dropped webhook leaves a booking uncorrelated. This
 * page lets an admin (1) re-poll TidyCal for missed events ("Run reconcile") and (2) see the events
 * the system couldn't tie to a user (`matched = false`) so nothing silently vanishes.
 */
export default function ReconcilePage() {
  const { getIdToken } = useAuth();
  const [rows, setRows] = useState<UnmatchedBookingEventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [since, setSince] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BookingReconcileResultDto | null>(null);

  /** Fetch one page of unmatched events; `offset === 0` resets the feed, otherwise appends. */
  const loadPage = useCallback(
    async (offset: number) => {
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to continue.");
          return;
        }
        const page = await getUnmatchedBookings(token, { limit: PAGE_SIZE, offset });
        setHasMore(page.length === PAGE_SIZE);
        setRows((prev) => (offset === 0 || prev == null ? page : [...prev, ...page]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load unmatched bookings.");
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

  /** Trigger a reconcile poll, then refresh the unmatched feed (recovery may have matched some). */
  const runReconcile = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      const summary = await reconcileBookings(token, since.trim());
      setResult(summary);
      await loadPage(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconcile failed.");
    } finally {
      setRunning(false);
    }
  }, [getIdToken, since, loadPage]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Consultations</div>
          <h1 className="h1">Bookings</h1>
        </div>
      </div>
      <p className="muted">
        Booking confirmations arrive by webhook. Re-poll TidyCal to recover any the webhook missed,
        and review bookings that couldn&apos;t be tied to a user — kept here so none silently vanish.
      </p>

      <Card pad>
        <div className="label">Run reconcile</div>
        <div className="row gap2">
          <Field label="Since (optional)" htmlFor="since">
            <Input
              id="since"
              type="datetime-local"
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
          </Field>
          <Button variant="primary" onClick={() => void runReconcile()} disabled={running}>
            {running ? "Reconciling…" : "Run reconcile"}
          </Button>
        </div>
        {result != null && (
          <div className="row gap1">
            <Stat label="Polled" value={result.polled} />
            <Stat label="Applied" value={result.applied} />
            <Stat label="Matched" value={result.matched} />
            <Stat label="Already seen" value={result.skipped} />
          </div>
        )}
      </Card>

      {error != null && <Badge tone="red">{error}</Badge>}

      <h2 className="h2">Unmatched bookings</h2>
      {rows != null && rows.length === 0 && (
        <p className="muted">No unmatched bookings — every booking has been correlated.</p>
      )}

      {rows != null && rows.length > 0 && (
        <div className="col gap3">
          {rows.map((row) => (
            <Card key={row.id} pad>
              <div className="row gap2">
                <Badge tone="amber">Unmatched</Badge>
                <Badge tone="info">{row.eventType}</Badge>
                <Badge tone="ink">{row.provider}</Badge>
                <span className="grow" />
                <span className="muted mono">{new Date(row.receivedAt).toLocaleString()}</span>
              </div>

              <div className="label">Booking reference</div>
              <p className="mono">{row.bookingRef ?? <span className="muted">— (none)</span>}</p>

              <div className="label">Contact email</div>
              <p>{row.email ?? <span className="muted">— (none)</span>}</p>

              {row.scheduledAt != null && (
                <>
                  <div className="label">Scheduled</div>
                  <p>{new Date(row.scheduledAt).toLocaleString()}</p>
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
