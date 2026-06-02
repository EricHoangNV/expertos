"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Field, Input, Stat, Textarea } from "@expertos/ui";
import type { AdminExpertDetailDto } from "@expertos/shared";
import { AdminFrame } from "../../../src/components/AdminFrame";
import { useAuth } from "../../../src/lib/auth-context";
import { getExpert, setExpertActive, updateExpert } from "../../../src/lib/admin-client";
import { useT } from "../../../src/lib/i18n";

export default function ExpertDetailPage() {
  const t = useT("experts");
  const params = useParams<{ id: string }>();
  const expertId = params.id;
  const { getIdToken } = useAuth();

  const [expert, setExpert] = useState<AdminExpertDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const token = useCallback(async () => {
    const tok = await getIdToken();
    if (!tok) {
      setError(t("signInError"));
      return null;
    }
    return tok;
  }, [getIdToken, t]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const tok = await token();
      if (!tok) return;
      setExpert(await getExpert(tok, expertId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("detail.loadError"));
    }
  }, [token, expertId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = useCallback(async () => {
    if (expert == null) return;
    try {
      const tok = await token();
      if (!tok) return;
      const updated = await setExpertActive(tok, expert.id, !expert.active);
      setExpert(updated);
      setNotice(updated.active ? t("detail.activated") : t("detail.deactivated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("detail.toggleError"));
    }
  }, [expert, token, t]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{expert?.displayName ?? t("detail.fallbackTitle")}</h1>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {notice != null && <Badge tone="green">{notice}</Badge>}

      {expert != null && (
        <div className="col gap3">
          <div className="row gap2">
            <Badge tone={expert.active ? "green" : "ink"}>
              {expert.active ? t("active") : t("inactive")}
            </Badge>
            <span className="muted mono">{expert.slug}</span>
            <span className="grow" />
            <Button variant="subtle" size="sm" onClick={() => void toggleActive()}>
              {expert.active ? t("detail.deactivate") : t("detail.activate")}
            </Button>
          </div>

          <div className="row gap3">
            <Stat label={t("detail.statVoiceProfiles")} value={String(expert.voiceProfileCount)} />
            <Stat label={t("detail.statDocuments")} value={String(expert.documentCount)} />
          </div>

          <ProfileEditor
            expert={expert}
            getToken={token}
            onSaved={(updated) => {
              setExpert(updated);
              setNotice(t("detail.updated"));
            }}
            onError={setError}
          />

          <section className="card card-pad">
            <div className="label">{t("detail.voiceProfiles.label")}</div>
            <p className="muted">
              {expert.voiceProfileCount === 0
                ? t("detail.voiceProfiles.none")
                : t("detail.voiceProfiles.count", { count: expert.voiceProfileCount })}
            </p>
            <Link href={`/voice-profiles?expertId=${expert.id}`} className="navitem">
              {t("detail.voiceProfiles.manage")}
            </Link>
          </section>
        </div>
      )}
    </AdminFrame>
  );
}

interface ProfileEditorProps {
  expert: AdminExpertDetailDto;
  getToken: () => Promise<string | null>;
  onSaved: (updated: AdminExpertDetailDto) => void;
  onError: (message: string) => void;
}

function ProfileEditor({ expert, getToken, onSaved, onError }: ProfileEditorProps) {
  const t = useT("experts");
  const [displayName, setDisplayName] = useState(expert.displayName);
  const [title, setTitle] = useState(expert.title ?? "");
  const [bio, setBio] = useState(expert.bio ?? "");
  const [userId, setUserId] = useState(expert.userId ?? "");
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const tok = await getToken();
      if (!tok) return;
      const trimmedUser = userId.trim();
      const updated = await updateExpert(tok, expert.id, {
        displayName: displayName.trim(),
        title,
        bio,
        userId: trimmedUser === "" ? null : trimmedUser,
      });
      onSaved(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : t("detail.editor.saveError"));
    } finally {
      setSaving(false);
    }
  }, [getToken, expert.id, displayName, title, bio, userId, onSaved, onError, t]);

  return (
    <section className="card card-pad">
      <div className="label">{t("detail.editor.label")}</div>
      <div className="col gap2">
        <div className="row gap2">
          <Field label={t("detail.editor.displayNameLabel")}>
            <Input
              value={displayName}
              disabled={saving}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label={t("detail.editor.titleLabel")}>
            <Input value={title} disabled={saving} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <Field label={t("detail.editor.bioLabel")}>
          <Textarea rows={3} value={bio} disabled={saving} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <Field label={t("detail.editor.operatorLabel")}>
          <Input
            placeholder={t("detail.editor.operatorPlaceholder")}
            value={userId}
            disabled={saving}
            onChange={(e) => setUserId(e.target.value)}
          />
        </Field>
        {expert.linkedUserEmail != null && (
          <span className="muted mono">
            {t("detail.editor.operatorCurrent", { email: expert.linkedUserEmail })}
          </span>
        )}
        <div className="row">
          <Button
            variant="subtle"
            size="sm"
            disabled={saving || displayName.trim() === ""}
            onClick={() => void save()}
          >
            {saving ? t("detail.editor.saving") : t("detail.editor.save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
