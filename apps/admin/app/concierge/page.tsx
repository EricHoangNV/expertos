"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Select } from "@expertos/ui";
import type { ReviewConfigDto, ReviewConfigUpdateInput } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getConciergeConfig, updateConciergeConfig } from "../../src/lib/admin-client";
import { useT } from "../../src/lib/i18n";

/**
 * The mode shown in the editor's dropdown. Off is the absence of a trigger; the two on-states map to
 * the `trigger_mode` enum. This collapses the `enabled` + `triggerMode` pair into one control so an
 * admin picks a single mode (PRD §"Concierge Mode" → "Off / Mode A / Mode B").
 */
type ConciergeMode = "off" | "user_prompted" | "auto_silent";

/** Maps each editor mode to its `modeHelp` dictionary key. */
const MODE_HELP_KEY: Record<ConciergeMode, string> = {
  off: "modeHelp.off",
  user_prompted: "modeHelp.userPrompted",
  auto_silent: "modeHelp.autoSilent",
};

/** Collapse the DTO's enabled+triggerMode into the single editor mode. */
function modeOf(config: ReviewConfigDto): ConciergeMode {
  return config.enabled ? config.triggerMode : "off";
}

/** Parse a positive-integer input: a whole number ≥ 1 → that number; else `undefined` (invalid). */
function parsePositiveInt(raw: string): number | undefined {
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

/** Parse a 0–1 confidence threshold; out-of-range or non-numeric → `undefined` (invalid). */
function parseThreshold(raw: string): number | undefined {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return undefined;
  }
  return value;
}

export default function ConciergePage() {
  const t = useT("concierge");
  const { getIdToken } = useAuth();
  const [config, setConfig] = useState<ReviewConfigDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setConfig(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("signInRequired"));
        return;
      }
      setConfig(await getConciergeConfig(token));
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

      {config != null && (
        <ConfigEditor config={config} getToken={getIdToken} onSaved={setConfig} />
      )}
    </AdminFrame>
  );
}

interface ConfigEditorProps {
  config: ReviewConfigDto;
  getToken: () => Promise<string | null>;
  onSaved: (config: ReviewConfigDto) => void;
}

/**
 * The single concierge config form. Mode B (silent review) is disabled until the OD#5 legal/brand
 * sign-off flips `silentReviewAllowed` on the server (the server rejects it too — this is just a UX
 * gate). Saving posts the whole config; range errors are surfaced inline.
 */
function ConfigEditor({ config, getToken, onSaved }: ConfigEditorProps) {
  const t = useT("concierge");
  const [mode, setMode] = useState<ConciergeMode>(modeOf(config));
  const [threshold, setThreshold] = useState(String(config.confidenceThreshold));
  const [slaHours, setSlaHours] = useState(String(config.slaHours));
  const [volumeCap, setVolumeCap] = useState(String(config.volumeCapPerDay));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const touched = useCallback(() => setSaved(false), []);

  const save = useCallback(async () => {
    setError(null);
    setSaved(false);

    const parsedThreshold = parseThreshold(threshold);
    if (parsedThreshold === undefined) {
      setError(t("thresholdInvalid"));
      return;
    }
    const parsedSla = parsePositiveInt(slaHours);
    if (parsedSla === undefined) {
      setError(t("slaInvalid"));
      return;
    }
    const parsedCap = parsePositiveInt(volumeCap);
    if (parsedCap === undefined) {
      setError(t("capInvalid"));
      return;
    }

    // Off keeps the last on-mode as the stored triggerMode (it is inert while disabled).
    const body: ReviewConfigUpdateInput = {
      enabled: mode !== "off",
      triggerMode: mode === "off" ? config.triggerMode : mode,
      confidenceThreshold: parsedThreshold,
      slaHours: parsedSla,
      volumeCapPerDay: parsedCap,
    };

    setSaving(true);
    try {
      const token = await getToken();
      if (!token) {
        setError(t("signInRequired"));
        return;
      }
      onSaved(await updateConciergeConfig(token, body));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [mode, threshold, slaHours, volumeCap, config.triggerMode, getToken, onSaved, t]);

  return (
    <div className="col gap2">
      <Field label={t("triggerMode")}>
        <Select
          value={mode}
          disabled={saving}
          onChange={(e) => {
            setMode(e.target.value as ConciergeMode);
            touched();
          }}
        >
          <option value="off">{t("modeOff")}</option>
          <option value="user_prompted">{t("modeUserPrompted")}</option>
          <option value="auto_silent" disabled={!config.silentReviewAllowed}>
            {t("modeAutoSilent")}
            {!config.silentReviewAllowed && t("modeAutoSilentPending")}
          </option>
        </Select>
        <span className="muted">{t(MODE_HELP_KEY[mode])}</span>
      </Field>

      {!config.silentReviewAllowed && (
        <Badge tone="amber">{t("silentReviewPending")}</Badge>
      )}

      <Field label={t("confidenceThreshold")}>
        <Input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={threshold}
          disabled={saving}
          onChange={(e) => {
            setThreshold(e.target.value);
            touched();
          }}
        />
      </Field>

      <Field label={t("slaHours")}>
        <Input
          type="number"
          min={1}
          value={slaHours}
          disabled={saving}
          onChange={(e) => {
            setSlaHours(e.target.value);
            touched();
          }}
        />
      </Field>

      <Field label={t("volumeCap")}>
        <Input
          type="number"
          min={1}
          value={volumeCap}
          disabled={saving}
          onChange={(e) => {
            setVolumeCap(e.target.value);
            touched();
          }}
        />
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
