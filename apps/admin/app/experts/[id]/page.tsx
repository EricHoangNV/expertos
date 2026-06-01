"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Field, Input, Stat, Textarea } from "@expertos/ui";
import type { AdminExpertDetailDto } from "@expertos/shared";
import { AdminFrame } from "../../../src/components/AdminFrame";
import { useAuth } from "../../../src/lib/auth-context";
import { getExpert, setExpertActive, updateExpert } from "../../../src/lib/admin-client";

export default function ExpertDetailPage() {
  const params = useParams<{ id: string }>();
  const expertId = params.id;
  const { getIdToken } = useAuth();

  const [expert, setExpert] = useState<AdminExpertDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const token = useCallback(async () => {
    const t = await getIdToken();
    if (!t) {
      setError("Please sign in to continue.");
      return null;
    }
    return t;
  }, [getIdToken]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const t = await token();
      if (!t) return;
      setExpert(await getExpert(t, expertId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the expert.");
    }
  }, [token, expertId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = useCallback(async () => {
    if (expert == null) return;
    try {
      const t = await token();
      if (!t) return;
      const updated = await setExpertActive(t, expert.id, !expert.active);
      setExpert(updated);
      setNotice(updated.active ? "Expert activated." : "Expert deactivated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change active state.");
    }
  }, [expert, token]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Roster</div>
          <h1 className="h1">{expert?.displayName ?? "Expert"}</h1>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {notice != null && <Badge tone="green">{notice}</Badge>}

      {expert != null && (
        <div className="col gap3">
          <div className="row gap2">
            <Badge tone={expert.active ? "green" : "ink"}>
              {expert.active ? "active" : "inactive"}
            </Badge>
            <span className="muted mono">{expert.slug}</span>
            <span className="grow" />
            <Button variant="subtle" size="sm" onClick={() => void toggleActive()}>
              {expert.active ? "Deactivate" : "Activate"}
            </Button>
          </div>

          <div className="row gap3">
            <Stat label="Voice profiles" value={String(expert.voiceProfileCount)} />
            <Stat label="Documents" value={String(expert.documentCount)} />
          </div>

          <ProfileEditor
            expert={expert}
            getToken={token}
            onSaved={(updated) => {
              setExpert(updated);
              setNotice("Expert updated.");
            }}
            onError={setError}
          />

          <section className="card card-pad">
            <div className="label">Voice profiles</div>
            <p className="muted">
              {expert.voiceProfileCount === 0
                ? "No voice profiles yet."
                : `${expert.voiceProfileCount} voice profile(s) authored.`}
            </p>
            <Link href={`/voice-profiles?expertId=${expert.id}`} className="navitem">
              Manage voice profiles →
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
  const [displayName, setDisplayName] = useState(expert.displayName);
  const [title, setTitle] = useState(expert.title ?? "");
  const [bio, setBio] = useState(expert.bio ?? "");
  const [userId, setUserId] = useState(expert.userId ?? "");
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const t = await getToken();
      if (!t) return;
      const trimmedUser = userId.trim();
      const updated = await updateExpert(t, expert.id, {
        displayName: displayName.trim(),
        title,
        bio,
        userId: trimmedUser === "" ? null : trimmedUser,
      });
      onSaved(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update expert.");
    } finally {
      setSaving(false);
    }
  }, [getToken, expert.id, displayName, title, bio, userId, onSaved, onError]);

  return (
    <section className="card card-pad">
      <div className="label">Details</div>
      <div className="col gap2">
        <div className="row gap2">
          <Field label="Display name">
            <Input
              value={displayName}
              disabled={saving}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label="Title">
            <Input value={title} disabled={saving} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <Field label="Bio">
          <Textarea rows={3} value={bio} disabled={saving} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <Field label="Linked operator user id (blank to unlink)">
          <Input
            placeholder="user uuid"
            value={userId}
            disabled={saving}
            onChange={(e) => setUserId(e.target.value)}
          />
        </Field>
        {expert.linkedUserEmail != null && (
          <span className="muted mono">operator: {expert.linkedUserEmail}</span>
        )}
        <div className="row">
          <Button
            variant="subtle"
            size="sm"
            disabled={saving || displayName.trim() === ""}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save details"}
          </Button>
        </div>
      </div>
    </section>
  );
}
