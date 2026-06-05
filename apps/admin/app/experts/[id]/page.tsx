"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Field, Input, Stat, Textarea } from "@expertos/ui";
import type {
  AdminExpertDetailDto,
  ExpertCalendarSettingsDto,
  ExpertCalendarSettingsUpdateInput,
} from "@expertos/shared";
import { AdminFrame } from "../../../src/components/AdminFrame";
import { useAuth } from "../../../src/lib/auth-context";
import {
  getAdminExpertCalendarSettings,
  getExpert,
  getExpertCalendarSettings,
  setExpertActive,
  updateAdminExpertCalendarSettings,
  updateExpert,
  updateExpertCalendarSettings,
} from "../../../src/lib/admin-client";
import { useT } from "../../../src/lib/i18n";

export default function ExpertDetailPage() {
  const t = useT("experts");
  const params = useParams<{ id: string }>();
  const expertId = params.id;
  const { getIdToken, role } = useAuth();
  const isAdmin = role === "admin";

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

          <CalendarEditor
            expertId={expert.id}
            isAdmin={isAdmin}
            getToken={token}
            onSaved={(message) => setNotice(message)}
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

interface CalendarEditorProps {
  expertId: string;
  /** Admins read/write via `/admin/experts/:id/calendar`; an expert is self-scoped to `/expert/...`. */
  isAdmin: boolean;
  getToken: () => Promise<string | null>;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}

/**
 * Per-expert TidyCal calendar / booking settings (M16.5). The API token is write-only: the GET only
 * reports whether one is configured + a non-sensitive last-4 hint, so the input starts empty and a
 * non-empty save sets/replaces it. "Clear token" sends `apiToken: null`. The booking link is the
 * public TidyCal URL. The role-aware data source mirrors the conversions page: an admin targets the
 * `[id]` expert, a non-admin expert is implicitly their own voice — the API enforces the scope.
 */
function CalendarEditor({ expertId, isAdmin, getToken, onSaved, onError }: CalendarEditorProps) {
  const t = useT("experts");
  const [settings, setSettings] = useState<ExpertCalendarSettingsDto | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [tidycalLink, setTidycalLink] = useState("");
  const [saving, setSaving] = useState(false);

  const read = useCallback(
    (tok: string): Promise<ExpertCalendarSettingsDto> =>
      isAdmin
        ? getAdminExpertCalendarSettings(tok, expertId)
        : getExpertCalendarSettings(tok),
    [isAdmin, expertId],
  );

  const write = useCallback(
    (tok: string, body: ExpertCalendarSettingsUpdateInput): Promise<ExpertCalendarSettingsDto> =>
      isAdmin
        ? updateAdminExpertCalendarSettings(tok, expertId, body)
        : updateExpertCalendarSettings(tok, body),
    [isAdmin, expertId],
  );

  const apply = useCallback((next: ExpertCalendarSettingsDto) => {
    setSettings(next);
    setApiToken("");
    setTidycalLink(next.tidycalLink ?? "");
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const tok = await getToken();
        if (!tok) return;
        apply(await read(tok));
      } catch (err) {
        onError(err instanceof Error ? err.message : t("detail.calendar.loadError"));
      }
    })();
  }, [getToken, read, apply, onError, t]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const tok = await getToken();
      if (!tok) return;
      const trimmedToken = apiToken.trim();
      const trimmedLink = tidycalLink.trim();
      const body: ExpertCalendarSettingsUpdateInput = {
        // Omit the token when blank (leave it unchanged); a non-empty value sets/replaces it.
        ...(trimmedToken !== "" ? { apiToken: trimmedToken } : {}),
        // Empty clears the link; otherwise set the URL.
        tidycalLink: trimmedLink === "" ? null : trimmedLink,
      };
      apply(await write(tok, body));
      onSaved(t("detail.calendar.saved"));
    } catch (err) {
      onError(err instanceof Error ? err.message : t("detail.calendar.saveError"));
    } finally {
      setSaving(false);
    }
  }, [getToken, write, apply, apiToken, tidycalLink, onSaved, onError, t]);

  const clearToken = useCallback(async () => {
    setSaving(true);
    try {
      const tok = await getToken();
      if (!tok) return;
      apply(await write(tok, { apiToken: null }));
      onSaved(t("detail.calendar.cleared"));
    } catch (err) {
      onError(err instanceof Error ? err.message : t("detail.calendar.saveError"));
    } finally {
      setSaving(false);
    }
  }, [getToken, write, apply, onSaved, onError, t]);

  return (
    <section className="card card-pad">
      <div className="label">{t("detail.calendar.label")}</div>
      <p className="muted">{t("detail.calendar.intro")}</p>
      <div className="col gap2">
        <Field label={t("detail.calendar.apiTokenLabel")}>
          <Input
            type="password"
            autoComplete="off"
            placeholder={t("detail.calendar.apiTokenPlaceholder")}
            value={apiToken}
            disabled={saving}
            onChange={(e) => setApiToken(e.target.value)}
          />
        </Field>
        <div className="row gap2">
          {settings?.apiTokenConfigured ? (
            <>
              <Badge tone="green">
                {t("detail.calendar.apiTokenConfigured", {
                  last4: settings.apiTokenLast4 ?? "",
                })}
              </Badge>
              <span className="muted">{t("detail.calendar.apiTokenKeepHint")}</span>
              <span className="grow" />
              <Button
                variant="subtle"
                size="sm"
                disabled={saving}
                onClick={() => void clearToken()}
              >
                {t("detail.calendar.clearToken")}
              </Button>
            </>
          ) : (
            <span className="muted">{t("detail.calendar.apiTokenNotConfigured")}</span>
          )}
        </div>
        <Field label={t("detail.calendar.bookingLinkLabel")}>
          <Input
            type="url"
            placeholder={t("detail.calendar.bookingLinkPlaceholder")}
            value={tidycalLink}
            disabled={saving}
            onChange={(e) => setTidycalLink(e.target.value)}
          />
        </Field>
        <p className="muted">{t("detail.calendar.help")}</p>
        <div className="row">
          <Button variant="subtle" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? t("detail.calendar.saving") : t("detail.calendar.save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
