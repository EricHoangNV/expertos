"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Bar, Button, Table, cx, type BadgeTone } from "@expertos/ui";
import type {
  KnowledgeDocumentDto,
  KnowledgeDraftSummaryDto,
  KnowledgePipelineDto,
  PublishStatusValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import {
  getKnowledgePipeline,
  listDocuments,
  listDrafts,
  versionAction,
} from "../../src/lib/admin-client";
import { draftStatusTone, statusLabel } from "../../src/lib/status-tone";

/**
 * Knowledge approval — kanban board (M13.3, PRD §"Admin & Expert portals" / ui-reference-spec
 * "Screen 2"). Replaces the flat review-queue table with the approved mockup: a numbered status
 * pipeline (Draft → AI Processing → Expert Review → Published, Expert Review the active stage) over
 * a 4-column `.kanban` board, then a Conversation → Knowledge table below.
 *
 * Wiring: per-column cards come from the existing `/knowledge/documents?status=` list (M8.1); the
 * accurate column count badges come from `/admin/analytics/knowledge-pipeline` (M13.2.6) — the list
 * is `take:50`-bounded so it can't be trusted for a live count (Published can exceed 50). The
 * Expert Review column's "Approve & publish" drives the same `/knowledge/versions/:id/approve`
 * transition the detail page uses; "Diff" opens the version-history detail.
 *
 * Deviation notes (honest data, per the M13.2.x precedent — the DTO carries no field for these):
 *   • File-type / expert-name chips from the mockup are omitted — `KnowledgeDocumentDto` has neither;
 *     `scope`/`language` stand in as the available provenance.
 *   • Published "N answers cite this" citation count is omitted — not tracked per document.
 *   • AI Processing "progress" is approximated from `chunkCount` (chunks embedded ⇒ further along),
 *     the only real signal of pipeline progress.
 *   • The "Upload (MD / PDF / XLSX)" header action is omitted — admin knowledge ingestion is
 *     seed/CLI (M1.1); there is no browser-upload endpoint in the admin API. "+ New note" routes to
 *     the conversation-to-knowledge draft pipeline, which is the real authoring path.
 */

/** The four lifecycle columns of the board, in pipeline order, with their badge tone. */
const COLUMNS: { status: PublishStatusValue; label: string; tone: BadgeTone }[] = [
  { status: "draft", label: "Draft", tone: "ink" },
  { status: "ai_processing", label: "AI Processing", tone: "info" },
  { status: "expert_review", label: "Expert Review", tone: "amber" },
  { status: "published", label: "Published", tone: "green" },
];

/** The status-pipeline steps, in pipeline order. The active highlight and the click-to-filter
 *  behaviour are computed at render from live data (M13.3.2), so the highlight tracks where the
 *  work actually is rather than a hardcoded stage. */
const STEPS = COLUMNS.map((c) => ({ status: c.status, label: c.label }));

interface BoardData {
  pipeline: KnowledgePipelineDto;
  docs: Record<PublishStatusValue, KnowledgeDocumentDto[]>;
  drafts: KnowledgeDraftSummaryDto[];
}

/** One kanban card. The body varies by column (progress / approve actions / live badge). */
function DocCard({
  doc,
  status,
  active,
  busy,
  onApprove,
}: {
  doc: KnowledgeDocumentDto;
  status: PublishStatusValue;
  active: boolean;
  busy: boolean;
  onApprove: (versionId: string) => void;
}) {
  const version = doc.latestVersion;
  return (
    <div className={cx("kanban-card", active && "is-active")}>
      <Link href={`/knowledge/${doc.id}`} className="kanban-card-title">
        {doc.title}
      </Link>
      <div className="kanban-card-meta">
        <span className="mono muted">{doc.scope}</span>
        <span className="mono muted">· {doc.language}</span>
        {version != null && <span className="mono muted">· v{version.versionNumber}</span>}
      </div>

      {status === "ai_processing" && (
        <>
          <p className="kanban-card-summary mono">parse → chunk → embed</p>
          <Bar
            className="kanban-card-progress"
            value={version != null && version.chunkCount > 0 ? 66 : 33}
            aria-label="Processing progress"
          />
        </>
      )}

      {status === "expert_review" && (
        <>
          {version?.changeSummary != null && (
            <p className="kanban-card-summary">{version.changeSummary}</p>
          )}
          <div className="kanban-card-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || version == null}
              onClick={() => version != null && onApprove(version.id)}
            >
              Approve &amp; publish
            </Button>
            <Link href={`/knowledge/${doc.id}`} className="btn btn-ghost btn-sm">
              Diff
            </Link>
          </div>
        </>
      )}

      {status === "published" && version != null && (
        <p className="kanban-card-summary muted">
          <Badge tone="green">v{version.versionNumber} live</Badge>{" "}
          {version.approvedAt != null
            ? `approved · ${new Date(version.approvedAt).toLocaleDateString()}`
            : "published"}
        </p>
      )}

      {status === "draft" && (
        <p className="kanban-card-summary muted">
          {version?.changeSummary ?? "Awaiting submission for review."}
        </p>
      )}
    </div>
  );
}

export default function KnowledgeApprovalPage() {
  const { getIdToken } = useAuth();
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** null = show all columns; a status = filter the board to that column. */
  const [focused, setFocused] = useState<PublishStatusValue | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      const [pipeline, draft, ai, review, published, drafts] = await Promise.all([
        getKnowledgePipeline(token),
        listDocuments(token, "draft"),
        listDocuments(token, "ai_processing"),
        listDocuments(token, "expert_review"),
        listDocuments(token, "published"),
        listDrafts(token),
      ]);
      setData({
        pipeline,
        docs: {
          draft,
          ai_processing: ai,
          expert_review: review,
          published,
          archived: [],
        },
        drafts,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge board.");
    }
  }, [getIdToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = useCallback(
    async (versionId: string) => {
      setBusy(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to continue.");
          return;
        }
        await versionAction(token, versionId, "approve");
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Approve failed.");
      } finally {
        setBusy(false);
      }
    },
    [getIdToken, load],
  );

  // The highlighted step tracks where the work is: the selected filter, or — when nothing is
  // filtered — the first column that actually has documents (so an all-Draft board lights Draft,
  // not a hardcoded stage). Falls back to "draft" before data loads.
  const counts = data?.pipeline.byStatus;
  const firstNonEmpty =
    COLUMNS.find((c) => (counts?.[c.status] ?? 0) > 0)?.status ?? "draft";
  const activeStatus: PublishStatusValue = focused ?? firstNonEmpty;
  const visibleColumns = focused == null ? COLUMNS : COLUMNS.filter((c) => c.status === focused);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Versioned · Expert-reviewed</div>
          <h1 className="h1">Knowledge approval</h1>
        </div>
        <Link href="/knowledge-drafts" className="btn btn-ghost">
          + New note
        </Link>
      </div>

      {/* M13.3.2 — status pipeline step indicator. Each step is a filter toggle: click to show
          only that column, click again to show all. The highlight tracks the active filter, or
          the first non-empty stage when nothing is filtered. */}
      <div className="kanban-steps">
        {STEPS.map((s) => (
          <button
            key={s.status}
            type="button"
            className={cx("kanban-step", s.status === activeStatus && "is-active")}
            aria-pressed={focused === s.status}
            title={focused === s.status ? "Show all columns" : `Show only ${s.label}`}
            onClick={() => setFocused((f) => (f === s.status ? null : s.status))}
          >
            {s.label}
          </button>
        ))}
        <span className="kanban-step-note">
          → Archived / Deprecated · every answer records which published version produced it
        </span>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}

      {/* M13.3.3 / M13.3.4 — kanban board */}
      {data != null && (
        <div className="kanban">
          {visibleColumns.map((col) => {
            const docs = data.docs[col.status];
            return (
              <div className="kanban-col" key={col.status}>
                <div className="kanban-col-head">
                  <div className="label">{col.label}</div>
                  <Badge tone={col.tone}>{data.pipeline.byStatus[col.status]}</Badge>
                </div>
                <div className="kanban-col-body">
                  {docs.length === 0 ? (
                    <p className="muted kanban-empty">Nothing here.</p>
                  ) : (
                    docs.map((doc, i) => (
                      <DocCard
                        key={doc.id}
                        doc={doc}
                        status={col.status}
                        active={col.status === "expert_review" && i === 0}
                        busy={busy}
                        onApprove={approve}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* M13.3.5 — Conversation → Knowledge */}
      {data != null && (
        <section className="convknow">
          <div className="convknow-head">
            <div>
              <div className="eyebrow">Conversation → Knowledge</div>
              <h2 className="h2">Grow the knowledge base from real usage</h2>
            </div>
            <div className="convknow-pills">
              {["Conversation", "Mark valuable", "Draft", "Expert review", "Publish"].map(
                (p, i, arr) => (
                  <span key={p} className="convknow-pill">
                    {p}
                    {i < arr.length - 1 && <span className="convknow-pill-sep"> · </span>}
                  </span>
                ),
              )}
            </div>
          </div>

          {data.drafts.length === 0 ? (
            <p className="muted">No conversation-sourced drafts yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Recurring question</th>
                  <th>Status</th>
                  <th>From chat</th>
                  <th>Lang</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.drafts.map((draft) => (
                  <tr key={draft.id}>
                    <td>
                      <Link href={`/knowledge-drafts/${draft.id}`}>{draft.title}</Link>
                    </td>
                    <td>
                      <Badge tone={draftStatusTone(draft.status)}>
                        {statusLabel(draft.status)}
                      </Badge>
                    </td>
                    <td className="muted">{draft.conversationId ? "yes" : "—"}</td>
                    <td className="mono">{draft.language}</td>
                    <td>
                      <Link href={`/knowledge-drafts/${draft.id}`} className="btn btn-primary btn-sm">
                        Draft
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      )}
    </AdminFrame>
  );
}
