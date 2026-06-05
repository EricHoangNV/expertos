"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Select, Tooltip } from "@expertos/ui";
import {
  chatModelSchema,
  type AppSettingsDto,
  type AppSettingsUpdateInput,
  type ChatModelValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getAppSettings, updateAppSettings } from "../../src/lib/admin-client";
import { useT } from "../../src/lib/i18n";

/** Parse a bounded float input; out-of-range or non-numeric → `undefined` (invalid). */
function parseBounded(raw: string, min: number, max: number): number | undefined {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < min || value > max) {
    return undefined;
  }
  return value;
}

export default function SettingsPage() {
  const t = useT("settings");
  const { getIdToken } = useAuth();
  const [settings, setSettings] = useState<AppSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setSettings(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("signInRequired"));
        return;
      }
      setSettings(await getAppSettings(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [getIdToken, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

      {settings != null && (
        <SettingsEditor settings={settings} getToken={getIdToken} onSaved={setSettings} />
      )}
    </AdminFrame>
  );
}

interface SettingsEditorProps {
  settings: AppSettingsDto;
  getToken: () => Promise<string | null>;
  onSaved: (settings: AppSettingsDto) => void;
}

/**
 * The runtime answer-tuning form (M17.5). Temperature + default chat model + retrieval score floor
 * are real-time (the `SettingsService` 30s TTL cache picks them up on the next turn). The embedding
 * provider is read-only: switching embedders invalidates existing vectors, so it is env + restart
 * only — surfaced here purely as context with a "restart required" note.
 */
function SettingsEditor({ settings, getToken, onSaved }: SettingsEditorProps) {
  const t = useT("settings");
  const [temperature, setTemperature] = useState(String(settings.llmTemperature));
  const [model, setModel] = useState<ChatModelValue>(settings.defaultChatModel);
  const [scoreFloor, setScoreFloor] = useState(String(settings.retrievalScoreFloor));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const touched = useCallback(() => setSaved(false), []);

  const save = useCallback(async () => {
    setError(null);
    setSaved(false);

    const parsedTemp = parseBounded(temperature, 0, 2);
    if (parsedTemp === undefined) {
      setError(t("temperatureInvalid"));
      return;
    }
    const parsedFloor = parseBounded(scoreFloor, 0, 1);
    if (parsedFloor === undefined) {
      setError(t("scoreFloorInvalid"));
      return;
    }

    const body: AppSettingsUpdateInput = {
      llmTemperature: parsedTemp,
      defaultChatModel: model,
      retrievalScoreFloor: parsedFloor,
    };

    setSaving(true);
    try {
      const token = await getToken();
      if (!token) {
        setError(t("signInRequired"));
        return;
      }
      onSaved(await updateAppSettings(token, body));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [temperature, scoreFloor, model, getToken, onSaved, t]);

  return (
    <div className="col gap2">
      <Field label={t("temperature")} htmlFor="settings-temperature">
        <Input
          id="settings-temperature"
          type="number"
          min={0}
          max={2}
          step={0.05}
          value={temperature}
          disabled={saving}
          onChange={(e) => {
            setTemperature(e.target.value);
            touched();
          }}
        />
        <span className="muted">{t("temperatureHelp")}</span>
      </Field>

      <Field label={t("defaultChatModel")} htmlFor="settings-model">
        <Select
          id="settings-model"
          value={model}
          disabled={saving}
          onChange={(e) => {
            setModel(chatModelSchema.parse(e.target.value));
            touched();
          }}
        >
          <option value="gpt-4o-mini">{t("modelMini")}</option>
          <option value="gpt-4o">{t("modelFull")}</option>
        </Select>
        <span className="muted">{t("defaultChatModelHelp")}</span>
      </Field>

      <Field
        label={
          <>
            {t("scoreFloor")}
            <Tooltip label={t("scoreFloorTipAria")}>
              <span className="tooltip-title">{t("scoreFloorTipTitle")}</span>
              {t("scoreFloorTipIntro")}
              <table>
                <thead>
                  <tr>
                    <th>{t("scoreFloorTipColFloor")}</th>
                    <th>{t("scoreFloorTipColEffect")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>0</code>
                    </td>
                    <td>{t("scoreFloorTipOff")}</td>
                  </tr>
                  <tr>
                    <td>
                      <code>~0.015</code>
                    </td>
                    <td>{t("scoreFloorTipGentle")}</td>
                  </tr>
                  <tr>
                    <td>
                      <code>~0.018–0.020</code>
                    </td>
                    <td>{t("scoreFloorTipStrict")}</td>
                  </tr>
                  <tr>
                    <td>
                      <code>&gt; 0.033</code>
                    </td>
                    <td>{t("scoreFloorTipKill")}</td>
                  </tr>
                </tbody>
              </table>
              <span className="tooltip-foot">{t("scoreFloorTipFoot")}</span>
            </Tooltip>
          </>
        }
        htmlFor="settings-score-floor"
      >
        <Input
          id="settings-score-floor"
          type="number"
          min={0}
          max={1}
          step={0.005}
          value={scoreFloor}
          disabled={saving}
          onChange={(e) => {
            setScoreFloor(e.target.value);
            touched();
          }}
        />
        <span className="muted">{t("scoreFloorHelp")}</span>
      </Field>

      <Field label={t("embeddingProvider")} htmlFor="settings-embedding-provider">
        <Input
          id="settings-embedding-provider"
          type="text"
          value={settings.embeddingProvider}
          readOnly
          disabled
        />
        <span className="muted">{t("embeddingProviderNote")}</span>
      </Field>

      <div className="row gap1">
        <Button variant="subtle" size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? t("saving") : t("save")}
        </Button>
        {saved && <Badge tone="green">{t("saved")}</Badge>}
      </div>
      {error != null && <Badge tone="red">{error}</Badge>}
    </div>
  );
}
