"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Select, Table, Textarea } from "@expertos/ui";
import {
  LANGUAGES,
  PUBLISH_STATUSES,
  type LanguageValue,
  type PublishStatusValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import {
  createVoiceProfile,
  listVoiceProfiles,
  updateVoiceProfile,
  voiceProfileAction,
  type VoiceProfileAction,
  type VoiceProfileAdminDto,
} from "../../src/lib/admin-client";
import { publishStatusTone } from "../../src/lib/status-tone";
import { useStatusLabel, useT } from "../../src/lib/i18n";

/** Actions offered for each lifecycle status (M2.3 sign-off state machine). */
const ACTIONS: Record<PublishStatusValue, VoiceProfileAction[]> = {
  draft: ["submit"],
  ai_processing: [],
  expert_review: ["approve", "request-changes"],
  published: [],
  archived: [],
};

/** Maps each lifecycle action to its `actions` dictionary key. */
const ACTION_LABEL_KEY: Record<VoiceProfileAction, string> = {
  submit: "actions.submit",
  approve: "actions.approve",
  "request-changes": "actions.requestChanges",
};

export default function VoiceProfilesPage() {
  const t = useT("voiceProfiles");
  const statusLabel = useStatusLabel();
  const { getIdToken } = useAuth();
  const [rows, setRows] = useState<VoiceProfileAdminDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<PublishStatusValue | "">("");
  const [expertId, setExpertId] = useState("");
  const [editing, setEditing] = useState<VoiceProfileAdminDto | null>(null);

  // Seed the expert filter from a `?expertId=` deep link (e.g. from the expert detail page)
  // without `useSearchParams`, which would force a Suspense boundary at build time.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("expertId");
    if (param) setExpertId(param);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("signInRequired"));
        return;
      }
      setRows(
        await listVoiceProfiles(token, {
          status: status === "" ? undefined : status,
          expertId: expertId.trim() === "" ? undefined : expertId.trim(),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [getIdToken, status, expertId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (id: string, action: VoiceProfileAction) => {
      try {
        const token = await getIdToken();
        if (!token) return;
        await voiceProfileAction(token, id, action);
        setNotice(t("actionDone", { action: t(ACTION_LABEL_KEY[action]) }));
        void load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("actionFailed"));
      }
    },
    [getIdToken, load, t],
  );

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
      {notice != null && <Badge tone="green">{notice}</Badge>}

      <CreateVoiceProfile
        defaultExpertId={expertId}
        getToken={getIdToken}
        onCreated={() => {
          setNotice(t("draftCreated"));
          void load();
        }}
        onError={setError}
      />

      {editing != null && (
        <EditVoiceProfile
          profile={editing}
          getToken={getIdToken}
          onSaved={() => {
            setEditing(null);
            setNotice(t("profileUpdated"));
            void load();
          }}
          onCancel={() => setEditing(null)}
          onError={setError}
        />
      )}

      <div className="row gap2">
        <Field label={t("filterStatus")}>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as PublishStatusValue | "")}
          >
            <option value="">{t("filterStatusAny")}</option>
            {PUBLISH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("filterExpertId")}>
          <Input
            placeholder={t("filterExpertIdPlaceholder")}
            value={expertId}
            onChange={(e) => setExpertId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
          />
        </Field>
        <Button variant="subtle" size="sm" onClick={() => void load()}>
          {t("apply")}
        </Button>
      </div>

      {rows != null && rows.length === 0 && <p className="muted">{t("empty")}</p>}

      {rows != null && rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>{t("colProfile")}</th>
              <th>{t("colExpert")}</th>
              <th>{t("colLang")}</th>
              <th>{t("colStatus")}</th>
              <th>{t("colUpdated")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.expertName}</td>
                <td className="mono">{p.language}</td>
                <td>
                  <Badge tone={publishStatusTone(p.status)}>{statusLabel(p.status)}</Badge>
                </td>
                <td className="muted mono">{new Date(p.updatedAt).toLocaleDateString()}</td>
                <td>
                  <div className="row gap1">
                    <Link href={`/voice-profiles/${p.id}`} className="navitem">
                      {t("view")}
                    </Link>
                    {p.status === "draft" && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        {t("edit")}
                      </Button>
                    )}
                    {ACTIONS[p.status].map((action) => (
                      <Button
                        key={action}
                        variant="ghost"
                        size="sm"
                        onClick={() => void runAction(p.id, action)}
                      >
                        {t(ACTION_LABEL_KEY[action])}
                      </Button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AdminFrame>
  );
}

interface EditVoiceProfileProps {
  profile: VoiceProfileAdminDto;
  getToken: () => Promise<string | null>;
  onSaved: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

function EditVoiceProfile({ profile, getToken, onSaved, onCancel, onError }: EditVoiceProfileProps) {
  const t = useT("voiceProfiles");
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description ?? "");
  const [guidelines, setGuidelines] = useState(profile.guidelines ?? "");
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    if (name.trim() === "") return;
    setBusy(true);
    try {
      const t = await getToken();
      if (!t) return;
      await updateVoiceProfile(t, profile.id, {
        name: name.trim(),
        description,
        guidelines,
      });
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("updateFailed"));
    } finally {
      setBusy(false);
    }
  }, [name, description, guidelines, getToken, profile.id, onSaved, onError, t]);

  return (
    <section className="card card-pad">
      <div className="label">{t("editHeading", { expert: profile.expertName })}</div>
      <div className="col gap2">
        <Field label={t("fieldName")}>
          <Input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("fieldDescriptionClear")}>
          <Input
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label={t("fieldGuidelinesClear")}>
          <Textarea
            rows={4}
            value={guidelines}
            disabled={busy}
            onChange={(e) => setGuidelines(e.target.value)}
          />
        </Field>
        <div className="row gap2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || name.trim() === ""}
            onClick={() => void save()}
          >
            {busy ? t("saving") : t("save")}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    </section>
  );
}

interface CreateVoiceProfileProps {
  defaultExpertId: string;
  getToken: () => Promise<string | null>;
  onCreated: () => void;
  onError: (message: string) => void;
}

function CreateVoiceProfile({ defaultExpertId, getToken, onCreated, onError }: CreateVoiceProfileProps) {
  const t = useT("voiceProfiles");
  const [open, setOpen] = useState(false);
  const [expertId, setExpertId] = useState(defaultExpertId);
  const [language, setLanguage] = useState<LanguageValue>("en");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [busy, setBusy] = useState(false);

  // Keep the create form's expert id in step with a `?expertId=` deep link.
  useEffect(() => {
    if (defaultExpertId) setExpertId(defaultExpertId);
  }, [defaultExpertId]);

  const submit = useCallback(async () => {
    if (expertId.trim() === "" || name.trim() === "") return;
    setBusy(true);
    try {
      const t = await getToken();
      if (!t) return;
      await createVoiceProfile(t, {
        expertId: expertId.trim(),
        language,
        name: name.trim(),
        description: description.trim() === "" ? undefined : description.trim(),
        guidelines: guidelines.trim() === "" ? undefined : guidelines.trim(),
      });
      setName("");
      setDescription("");
      setGuidelines("");
      setOpen(false);
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }, [expertId, language, name, description, guidelines, getToken, onCreated, onError, t]);

  if (!open) {
    return (
      <div className="row">
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          {t("newButton")}
        </Button>
      </div>
    );
  }

  return (
    <section className="card card-pad">
      <div className="label">{t("newHeading")}</div>
      <div className="col gap2">
        <div className="row gap2">
          <Field label={t("fieldExpertId")}>
            <Input
              placeholder={t("fieldExpertIdPlaceholder")}
              value={expertId}
              disabled={busy}
              onChange={(e) => setExpertId(e.target.value)}
            />
          </Field>
          <Field label={t("fieldLanguage")}>
            <Select
              value={language}
              disabled={busy}
              onChange={(e) => setLanguage(e.target.value as LanguageValue)}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fieldName")}>
            <Input
              placeholder={t("fieldNamePlaceholder")}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("fieldDescriptionOptional")}>
          <Input
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label={t("fieldGuidelinesOptional")}>
          <Textarea
            rows={4}
            value={guidelines}
            disabled={busy}
            onChange={(e) => setGuidelines(e.target.value)}
          />
        </Field>
        <div className="row gap2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || expertId.trim() === "" || name.trim() === ""}
            onClick={() => void submit()}
          >
            {busy ? t("creating") : t("createDraft")}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    </section>
  );
}
