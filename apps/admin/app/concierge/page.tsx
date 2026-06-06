"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, cx } from "@expertos/ui";
import type { ReviewConfigDto, ReviewConfigUpdateInput } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getConciergeConfig, updateConciergeConfig } from "../../src/lib/admin-client";
import { useT } from "../../src/lib/i18n";

/**
 * The mode selected in the editor's radio cards. Off is the absence of a trigger; the two on-states
 * map to the `trigger_mode` enum. This collapses the `enabled` + `triggerMode` pair into one control
 * so an admin picks a single mode (PRD §"Concierge Mode" → "Off / Mode A / Mode B").
 */
type ConciergeMode = "off" | "user_prompted" | "auto_silent";

/** Static descriptor for each selectable mode card (M19.3.1, screenshot 10). */
interface ModeOption {
  value: ConciergeMode;
  titleKey: string;
  descKey: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: "off", titleKey: "modeOffTitle", descKey: "modeHelp.off" },
  { value: "user_prompted", titleKey: "modeATitle", descKey: "modeHelp.userPrompted" },
  { value: "auto_silent", titleKey: "modeBTitle", descKey: "modeHelp.autoSilent" },
];

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

  // The editor owns the pagehead so the primary Save can live in it (M19.3.1). While loading,
  // render a minimal pagehead without the action.
  if (config != null) {
    return (
      <AdminFrame>
        <ConfigEditor config={config} getToken={getIdToken} onSaved={setConfig} />
      </AdminFrame>
    );
  }

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
    </AdminFrame>
  );
}

interface ConfigEditorProps {
  config: ReviewConfigDto;
  getToken: () => Promise<string | null>;
  onSaved: (config: ReviewConfigDto) => void;
}

/** Render the static metadata badge for a mode card. Mode B's badge is gated on the OD#5 sign-off. */
function modeBadge(
  value: ConciergeMode,
  silentReviewAllowed: boolean,
  t: (key: string) => string,
) {
  if (value === "off") {
    return <Badge tone="ink">{t("badgeNoTrigger")}</Badge>;
  }
  if (value === "user_prompted") {
    return <Badge tone="red">{t("badgeActive")}</Badge>;
  }
  // auto_silent — only flag it while it's still awaiting the legal/brand sign-off.
  return silentReviewAllowed ? null : (
    <Badge tone="amber" dot>
      {t("badgeAwaitingSignoff")}
    </Badge>
  );
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
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("title")}</h1>
          <p className="muted">{t("subtitle")}</p>
        </div>
        <div className="row gap2">
          {saved && <Badge tone="green">{t("saved")}</Badge>}
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}

      <div className="col gap4">
        {/* Trigger mode — three selectable radio cards (M19.3.1). */}
        <div className="card card-pad">
          <span className="label">{t("triggerMode")}</span>
          <div className="col gap2" role="radiogroup" aria-label={t("triggerMode")}>
            {MODE_OPTIONS.map((opt) => {
              const selected = mode === opt.value;
              const disabled =
                saving || (opt.value === "auto_silent" && !config.silentReviewAllowed);
              return (
                <label
                  key={opt.value}
                  className={cx("verdict-card", selected && "is-active")}
                  aria-disabled={disabled}
                >
                  <span className="verdict-card-name">
                    <input
                      type="radio"
                      name="concierge-mode"
                      value={opt.value}
                      aria-label={t(opt.titleKey)}
                      checked={selected}
                      disabled={disabled}
                      style={{ accentColor: "var(--red-600)" }}
                      onChange={() => {
                        setMode(opt.value);
                        touched();
                      }}
                    />
                    <span className="grow">{t(opt.titleKey)}</span>
                    {modeBadge(opt.value, config.silentReviewAllowed, t)}
                  </span>
                  <span className="verdict-card-note">{t(opt.descKey)}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="card card-pad col gap2">
          <Field label={t("confidenceThreshold")} htmlFor="concierge-threshold">
            <Input
              id="concierge-threshold"
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

          <Field label={t("slaHours")} htmlFor="concierge-sla">
            <Input
              id="concierge-sla"
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

          <Field label={t("volumeCap")} htmlFor="concierge-cap">
            <Input
              id="concierge-cap"
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
        </div>
      </div>
    </>
  );
}
