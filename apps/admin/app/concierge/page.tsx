"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Select } from "@expertos/ui";
import type { ReviewConfigDto, ReviewConfigUpdateInput } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getConciergeConfig, updateConciergeConfig } from "../../src/lib/admin-client";

/**
 * The mode shown in the editor's dropdown. Off is the absence of a trigger; the two on-states map to
 * the `trigger_mode` enum. This collapses the `enabled` + `triggerMode` pair into one control so an
 * admin picks a single mode (PRD §"Concierge Mode" → "Off / Mode A / Mode B").
 */
type ConciergeMode = "off" | "user_prompted" | "auto_silent";

const MODE_HELP: Record<ConciergeMode, string> = {
  off: "No human-review trigger. Low-confidence answers are delivered as-is.",
  user_prompted:
    "Mode A — the chat offers “would you like our team to review this?” and the user opts in.",
  auto_silent:
    "Mode B — the user sees a normal AI answer while it is quietly queued for human review.",
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
  const { getIdToken } = useAuth();
  const [config, setConfig] = useState<ReviewConfigDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setConfig(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      setConfig(await getConciergeConfig(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the concierge config.");
    }
  }, [getIdToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Concierge mode</div>
          <h1 className="h1">Human-review trigger</h1>
          <p className="muted">
            When the AI is low-confidence, a human expert can step in. Changes take effect on the next
            chat turn — no deploy.
          </p>
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
      setError("Confidence threshold must be a number between 0 and 1.");
      return;
    }
    const parsedSla = parsePositiveInt(slaHours);
    if (parsedSla === undefined) {
      setError("SLA must be a whole number of hours ≥ 1.");
      return;
    }
    const parsedCap = parsePositiveInt(volumeCap);
    if (parsedCap === undefined) {
      setError("Daily volume cap must be a whole number ≥ 1.");
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
        setError("Please sign in to continue.");
        return;
      }
      onSaved(await updateConciergeConfig(token, body));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [mode, threshold, slaHours, volumeCap, config.triggerMode, getToken, onSaved]);

  return (
    <div className="col gap2">
      <Field label="Trigger mode">
        <Select
          value={mode}
          disabled={saving}
          onChange={(e) => {
            setMode(e.target.value as ConciergeMode);
            touched();
          }}
        >
          <option value="off">Off</option>
          <option value="user_prompted">Mode A — user-prompted</option>
          <option value="auto_silent" disabled={!config.silentReviewAllowed}>
            Mode B — auto-silent
            {!config.silentReviewAllowed && " (pending legal sign-off)"}
          </option>
        </Select>
        <span className="muted">{MODE_HELP[mode]}</span>
      </Field>

      {!config.silentReviewAllowed && (
        <Badge tone="amber">
          Mode B (silent review) is pending the OD#5 legal/brand sign-off and can’t be enabled yet.
        </Badge>
      )}

      <Field label="Confidence threshold (0–1)">
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

      <Field label="SLA (hours)">
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

      <Field label="Daily volume cap">
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
          {saving ? "Saving…" : "Save"}
        </Button>
        {saved && <Badge tone="green">Saved</Badge>}
      </div>
      {error != null && <Badge tone="red">{error}</Badge>}
    </div>
  );
}
