"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Select, Table, Textarea } from "@expertos/ui";
import type {
  RecommendationConsultationTypeDto,
  RecommendationRuleDto,
  RecommendationRuleUpdateInput,
  RecommendationRulesDto,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getRecommendationRules, updateRecommendationRule } from "../../src/lib/admin-client";
import { useT } from "../../src/lib/i18n";

/** Maps each trigger to its dictionary key fragment, for the editor's left column. */
const TRIGGER_KEY: Record<RecommendationRuleDto["trigger"], string> = {
  high_intent: "highIntent",
  topic: "topic",
  low_confidence: "lowConfidence",
  depth: "depth",
};

export default function RecommendationRulesPage() {
  const t = useT("recommendationRules");
  const { getIdToken } = useAuth();
  const [data, setData] = useState<RecommendationRulesDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("signInError"));
        return;
      }
      setData(await getRecommendationRules(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadError"));
    }
  }, [getIdToken, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Fold a freshly saved rule back into the loaded list (replace it in place). */
  const applyRule = useCallback((saved: RecommendationRuleDto) => {
    setData((prev) =>
      prev == null
        ? prev
        : { ...prev, rules: prev.rules.map((r) => (r.trigger === saved.trigger ? saved : r)) },
    );
  }, []);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("title")}</h1>
          <p className="lede">{t("subtitle")}</p>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}

      {data != null && (
        <Table>
          <thead>
            <tr>
              <th>{t("col.trigger")}</th>
              <th>{t("col.configuration")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rules.map((rule) => (
              <tr key={rule.trigger}>
                <td>
                  <div className="col gap1">
                    <strong>{t(`trigger.${TRIGGER_KEY[rule.trigger]}.label`)}</strong>
                    <span className="chip">{rule.kind.toUpperCase()}</span>
                    <span className="muted">{t(`trigger.${TRIGGER_KEY[rule.trigger]}.help`)}</span>
                  </div>
                </td>
                <td>
                  <RuleEditor
                    rule={rule}
                    consultationTypes={data.consultationTypes}
                    getToken={getIdToken}
                    onSaved={applyRule}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AdminFrame>
  );
}

interface RuleEditorProps {
  rule: RecommendationRuleDto;
  consultationTypes: RecommendationConsultationTypeDto[];
  getToken: () => Promise<string | null>;
  onSaved: (rule: RecommendationRuleDto) => void;
}

/** Keywords are edited one-per-line; split on newlines/commas, trim, and drop blanks. */
function parseKeywords(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/** Parse a threshold input: blank → null (none); a non-negative integer → that number; else `undefined`. */
function parseThreshold(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * One editable rule. A keyword trigger (`topic`/`high_intent`) shows a keyword list; a threshold
 * trigger (`depth`/`low_confidence`) shows a numeric threshold. Both show the enable toggle, priority,
 * and the consultation-type dropdown. Saving posts the whole rule; the server forces the irrelevant
 * field and rejects an enabled rule that could never fire (surfaced inline).
 */
function RuleEditor({ rule, consultationTypes, getToken, onSaved }: RuleEditorProps) {
  const t = useT("recommendationRules");
  const isKeyword = rule.kind === "keyword";
  const [enabled, setEnabled] = useState(rule.enabled);
  const [keywords, setKeywords] = useState(rule.keywords.join("\n"));
  const [threshold, setThreshold] = useState(rule.threshold != null ? String(rule.threshold) : "");
  const [priority, setPriority] = useState(String(rule.priority));
  const [typeKey, setTypeKey] = useState<string>(rule.consultationTypeKey ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setError(null);
    setSaved(false);

    const parsedPriority = parseThreshold(priority);
    if (parsedPriority === undefined || parsedPriority === null) {
      setError(t("priorityError"));
      return;
    }

    let body: RecommendationRuleUpdateInput;
    if (isKeyword) {
      body = {
        enabled,
        threshold: null,
        keywords: parseKeywords(keywords),
        priority: parsedPriority,
        consultationTypeKey: typeKey === "" ? null : typeKey,
      };
    } else {
      const parsedThreshold = parseThreshold(threshold);
      if (parsedThreshold === undefined) {
        setError(t("thresholdError"));
        return;
      }
      body = {
        enabled,
        threshold: parsedThreshold,
        keywords: [],
        priority: parsedPriority,
        consultationTypeKey: typeKey === "" ? null : typeKey,
      };
    }

    setSaving(true);
    try {
      const token = await getToken();
      if (!token) {
        setError(t("signInError"));
        return;
      }
      onSaved(await updateRecommendationRule(token, rule.trigger, body));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [isKeyword, enabled, keywords, threshold, priority, typeKey, getToken, onSaved, rule.trigger, t]);

  /** Clear the just-saved confirmation as soon as the admin edits again. */
  const touched = useCallback(() => setSaved(false), []);

  return (
    <div className="col gap1">
      <label className="row gap2">
        <span className="switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => {
              setEnabled(e.target.checked);
              touched();
            }}
          />
          <span className="track" />
        </span>
        {t("enabled")}
      </label>

      {isKeyword ? (
        <Field label={t("keywordsLabel")}>
          <Textarea
            rows={4}
            placeholder="legal&#10;tax&#10;contract"
            value={keywords}
            disabled={saving}
            onChange={(e) => {
              setKeywords(e.target.value);
              touched();
            }}
          />
        </Field>
      ) : (
        <Field label={t("thresholdLabel")}>
          <Input
            type="number"
            min={0}
            placeholder={t("thresholdPlaceholder")}
            value={threshold}
            disabled={saving}
            onChange={(e) => {
              setThreshold(e.target.value);
              touched();
            }}
          />
        </Field>
      )}

      <Field label={t("priorityLabel")}>
        <Input
          type="number"
          min={0}
          value={priority}
          disabled={saving}
          onChange={(e) => {
            setPriority(e.target.value);
            touched();
          }}
        />
      </Field>

      <Field label={t("recommendLabel")}>
        <Select
          value={typeKey}
          disabled={saving}
          onChange={(e) => {
            setTypeKey(e.target.value);
            touched();
          }}
        >
          <option value="">{t("defaultConsultation")}</option>
          {consultationTypes.map((ct) => (
            <option key={ct.key} value={ct.key}>
              {ct.name}
              {!ct.active && t("inactiveSuffix")}
            </option>
          ))}
        </Select>
      </Field>

      <Button variant="subtle" size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? t("saving") : t("save")}
      </Button>
      {saved && <Badge tone="green">{t("saved")}</Badge>}
      {error != null && <Badge tone="red">{error}</Badge>}
    </div>
  );
}
