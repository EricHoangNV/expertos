"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Field, Input, Textarea } from "@expertos/ui";
import type { KnowledgeDraftDto, KnowledgeDraftStatusValue } from "@expertos/shared";
import { AdminFrame } from "../../../src/components/AdminFrame";
import { useAuth } from "../../../src/lib/auth-context";
import { draftAction, getDraft, updateDraft, type DraftAction } from "../../../src/lib/admin-client";
import { draftStatusTone } from "../../../src/lib/status-tone";
import { useStatusLabel, useT } from "../../../src/lib/i18n";

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

/** Action → dictionary key (`knowledgeDrafts.actions.*`), resolved via the translator at render. */
const ACTION_LABEL_KEY: Record<DraftAction, string> = {
  submit: "actions.submit",
  publish: "actions.publish",
  "request-changes": "actions.requestChanges",
  reject: "actions.reject",
};

export default function DraftDetailPage() {
  const t = useT("knowledgeDrafts");
  const statusLabel = useStatusLabel();
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
        setError(t("errors.signIn"));
        return;
      }
      apply(await getDraft(token, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.loadDraft"));
    }
  }, [apply, getIdToken, id, t]);

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
          setError(t("errors.signIn"));
          return;
        }
        apply(await fn(token));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errors.action"));
      } finally {
        setBusy(false);
      }
    },
    [apply, getIdToken, t],
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
            <Link href="/knowledge-drafts">{t("detail.back")}</Link>
          </div>
          <h1 className="h1">{draft?.title ?? t("detail.fallbackTitle")}</h1>
          {draft != null && (
            <p className="muted mono">
              {draft.language}
              {draft.conversationId ? t("detail.fromConversation") : ""}
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
          <Field label={t("detail.titleLabel")} htmlFor="draft-title">
            <Input
              id="draft-title"
              value={title}
              disabled={!editable || busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={t("detail.contentLabel")} htmlFor="draft-content">
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
                {t("detail.save")}
              </Button>
            )}
            {actionsFor(draft.status).map((action) => (
              <Button
                key={action}
                variant={action === "publish" ? "primary" : action === "reject" ? "ghost" : "subtle"}
                disabled={busy}
                onClick={() => void act(action)}
              >
                {t(ACTION_LABEL_KEY[action])}
              </Button>
            ))}
          </div>
        </>
      )}
    </AdminFrame>
  );
}
