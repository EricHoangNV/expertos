"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, avatarInitials, avatarTone } from "@expertos/ui";
import type { PublishStatusValue } from "@expertos/shared";
import { AdminFrame } from "../../../src/components/AdminFrame";
import { useAuth } from "../../../src/lib/auth-context";
import {
  getVoiceProfile,
  voiceProfileAction,
  type VoiceProfileAction,
  type VoiceProfileDetailDto,
} from "../../../src/lib/admin-client";
import { publishStatusTone } from "../../../src/lib/status-tone";
import { useStatusLabel, useT } from "../../../src/lib/i18n";

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

/**
 * Voice-profile sign-off detail view (M13.5). Renders only data the schema actually backs — the
 * free-text guidelines plus the stored voice examples — so the expert can read the voice + its
 * style samples before signing off. The mockup's structured voice dimensions / do-don't rules /
 * fidelity scores are intentionally absent until a schema decision is made.
 */
export default function VoiceProfileDetailPage() {
  const t = useT("voiceProfiles");
  const statusLabel = useStatusLabel();
  const params = useParams<{ id: string }>();
  const profileId = params.id;
  const { getIdToken } = useAuth();

  const [profile, setProfile] = useState<VoiceProfileDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const token = useCallback(async () => {
    const tok = await getIdToken();
    if (!tok) {
      setError(t("signInRequired"));
      return null;
    }
    return tok;
  }, [getIdToken, t]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const tok = await token();
      if (!tok) return;
      setProfile(await getVoiceProfile(tok, profileId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("detail.loadFailed"));
    }
  }, [token, profileId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (action: VoiceProfileAction) => {
      try {
        const tok = await token();
        if (!tok) return;
        await voiceProfileAction(tok, profileId, action);
        setNotice(t("detail.actionDone", { action: t(ACTION_LABEL_KEY[action]) }));
        void load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("detail.actionFailed"));
      }
    },
    [token, profileId, load, t],
  );

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <Link href="/voice-profiles" className="navitem">
            {t("detail.back")}
          </Link>
          <h1 className="h1">{profile?.name ?? t("detail.fallbackTitle")}</h1>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {notice != null && <Badge tone="green">{notice}</Badge>}

      {profile != null && (
        <div className="col gap3">
          <div className="row gap2">
            <span
              className={`avatar avatar-lg tone-${avatarTone(profile.expertName)}`}
              aria-hidden
            >
              {avatarInitials(profile.expertName)}
            </span>
            <div className="col">
              <div className="row gap2">
                <strong>{profile.expertName}</strong>
                <Badge tone={publishStatusTone(profile.status)}>
                  {statusLabel(profile.status)}
                </Badge>
                {profile.status === "expert_review" && (
                  <Badge tone="amber" dot>
                    {t("detail.awaitingSignoff")}
                  </Badge>
                )}
              </div>
              <span className="muted mono">
                {t("detail.metaLang", { lang: profile.language })} ·{" "}
                {t("detail.metaExamples", { count: profile.exampleCount })}
              </span>
            </div>
            <span className="grow" />
            <div className="row gap1">
              {ACTIONS[profile.status].map((action) => (
                <Button
                  key={action}
                  variant={action === "approve" ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => void runAction(action)}
                >
                  {t(ACTION_LABEL_KEY[action])}
                </Button>
              ))}
            </div>
          </div>

          <section className="card card-pad">
            <Badge tone="amber" dot>
              {t("detail.warningTitle")}
            </Badge>
            <p className="muted">{t("detail.warningBody")}</p>
          </section>

          {profile.description != null && profile.description !== "" && (
            <section className="card card-pad">
              <div className="label">{t("detail.descriptionLabel")}</div>
              <p>{profile.description}</p>
            </section>
          )}

          <section className="card card-pad">
            <div className="label">{t("detail.guidelinesLabel")}</div>
            {profile.guidelines != null && profile.guidelines.trim() !== "" ? (
              <p style={{ whiteSpace: "pre-wrap" }}>{profile.guidelines}</p>
            ) : (
              <p className="muted">{t("detail.guidelinesEmpty")}</p>
            )}
            {ACTIONS[profile.status].includes("approve") && (
              <p className="muted">{t("detail.signoffNote")}</p>
            )}
          </section>

          <section className="card card-pad">
            <div className="label">
              {t("detail.examplesLabel")} ·{" "}
              {t("detail.metaExamples", { count: profile.exampleCount })}
            </div>
            {profile.examples.length === 0 ? (
              <p className="muted">{t("detail.examplesEmpty")}</p>
            ) : (
              <div className="col gap2">
                {profile.examples.map((ex) => (
                  <div key={ex.id} className="panel card-pad">
                    {ex.prompt != null && ex.prompt.trim() !== "" && (
                      <div className="muted mono">
                        {t("detail.examplePromptLabel")}: {ex.prompt}
                      </div>
                    )}
                    <p style={{ whiteSpace: "pre-wrap" }}>{ex.content}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </AdminFrame>
  );
}
