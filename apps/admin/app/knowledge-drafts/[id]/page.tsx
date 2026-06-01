"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Field, Input, Textarea } from "@expertos/ui";
import type { KnowledgeDraftDto, KnowledgeDraftStatusValue } from "@expertos/shared";
import { AdminFrame } from "../../../src/components/AdminFrame";
import { useAuth } from "../../../src/lib/auth-context";
import { draftAction, getDraft, updateDraft, type DraftAction } from "../../../src/lib/admin-client";
import { draftStatusTone, statusLabel } from "../../../src/lib/status-tone";

/** The lifecycle actions offered for a draft, given its current status. */
function actionsFor(status: KnowledgeDraftStatusValue): DraftAction[] {
  switch (status) {
    case "draft":
      return ["submit", "reject"];
    case "expert_review":
      return ["publish", "request-changes", "reject"];
    default:
      return [];
  }
}

const ACTION_LABEL: Record<DraftAction, string> = {
  submit: "Submit for review",
  publish: "Publish",
  "request-changes": "Request changes",
  reject: "Reject",
};

export default function DraftDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { getIdToken } = useAuth();
  const [draft, setDraft] = useState<KnowledgeDraftDto | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: KnowledgeDraftDto) => {
    setDraft(next);
    setTitle(next.title);
    setContent(next.content);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      apply(await getDraft(token, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load draft.");
    }
  }, [apply, getIdToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const withToken = useCallback(
    async (fn: (token: string) => Promise<KnowledgeDraftDto>) => {
      setBusy(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to continue.");
          return;
        }
        apply(await fn(token));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed.");
      } finally {
        setBusy(false);
      }
    },
    [apply, getIdToken],
  );

  const save = useCallback(
    () => withToken((token) => updateDraft(token, id, { title, content })),
    [withToken, id, title, content],
  );

  const act = useCallback(
    (action: DraftAction) => withToken((token) => draftAction(token, id, action)),
    [withToken, id],
  );

  const editable = draft?.status === "draft";
  const dirty = draft != null && (title !== draft.title || content !== draft.content);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            <Link href="/knowledge-drafts">← Drafts</Link>
          </div>
          <h1 className="h1">{draft?.title ?? "Draft"}</h1>
          {draft != null && (
            <p className="muted mono">
              {draft.language}
              {draft.conversationId ? " · from conversation" : ""}
            </p>
          )}
        </div>
        {draft != null && (
          <Badge tone={draftStatusTone(draft.status)}>{statusLabel(draft.status)}</Badge>
        )}
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}

      {draft != null && (
        <>
          <Field label="Title" htmlFor="draft-title">
            <Input
              id="draft-title"
              value={title}
              disabled={!editable || busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Content" htmlFor="draft-content">
            <Textarea
              id="draft-content"
              rows={14}
              value={content}
              disabled={!editable || busy}
              onChange={(e) => setContent(e.target.value)}
            />
          </Field>

          <div className="row gap1">
            {editable && (
              <Button variant="subtle" disabled={busy || !dirty} onClick={() => void save()}>
                Save changes
              </Button>
            )}
            {actionsFor(draft.status).map((action) => (
              <Button
                key={action}
                variant={action === "publish" ? "primary" : action === "reject" ? "ghost" : "subtle"}
                disabled={busy}
                onClick={() => void act(action)}
              >
                {ACTION_LABEL[action]}
              </Button>
            ))}
          </div>
        </>
      )}
    </AdminFrame>
  );
}
