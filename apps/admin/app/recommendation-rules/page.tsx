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

/** Human label + one-line explanation per trigger, for the editor's left column. */
const TRIGGER_META: Record<RecommendationRuleDto["trigger"], { label: string; help: string }> = {
  high_intent: {
    label: "High intent",
    help: "A keyword in the user's question shows they want to engage (book, hire, work with you).",
  },
  topic: {
    label: "High-stakes topic",
    help: "A keyword in the question or answer flags a topic best handled by a human (legal, tax, medical).",
  },
  low_confidence: {
    label: "Low confidence",
    help: "The answer was ungrounded, or cited at most this many sources — offer the human path.",
  },
  depth: {
    label: "Conversation depth",
    help: "The conversation has reached this many assistant turns — an engaged user is a strong candidate.",
  },
};

export default function RecommendationRulesPage() {
  const { getIdToken } = useAuth();
  const [data, setData] = useState<RecommendationRulesDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      setData(await getRecommendationRules(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the recommendation rules.");
    }
  }, [getIdToken]);

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
          <div className="eyebrow">Consultation funnel</div>
          <h1 className="h1">Recommendation rules</h1>
          <p className="muted">
            When to surface an in-chat “book a consultation” prompt. Changes take effect on the next
            chat turn — no deploy. Higher priority wins when several rules fire on one answer.
          </p>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}

      {data != null && (
        <Table>
          <thead>
            <tr>
              <th>Trigger</th>
              <th>Configuration</th>
            </tr>
          </thead>
          <tbody>
            {data.rules.map((rule) => (
              <tr key={rule.trigger}>
                <td>
                  <div className="col gap1">
                    <strong>{TRIGGER_META[rule.trigger].label}</strong>
                    <Badge tone={rule.kind === "keyword" ? "info" : "ink"}>{rule.kind}</Badge>
                    <span className="muted">{TRIGGER_META[rule.trigger].help}</span>
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
      setError("Priority must be a whole number ≥ 0.");
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
        setError("Threshold must be a whole number ≥ 0.");
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
        setError("Please sign in to continue.");
        return;
      }
      onSaved(await updateRecommendationRule(token, rule.trigger, body));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [isKeyword, enabled, keywords, threshold, priority, typeKey, getToken, onSaved, rule.trigger]);

  /** Clear the just-saved confirmation as soon as the admin edits again. */
  const touched = useCallback(() => setSaved(false), []);

  return (
    <div className="col gap1">
      <label className="row gap1">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => {
            setEnabled(e.target.checked);
            touched();
          }}
        />
        Enabled
      </label>

      {isKeyword ? (
        <Field label="Keywords (one per line)">
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
        <Field label="Threshold">
          <Input
            type="number"
            min={0}
            placeholder="none"
            value={threshold}
            disabled={saving}
            onChange={(e) => {
              setThreshold(e.target.value);
              touched();
            }}
          />
        </Field>
      )}

      <Field label="Priority">
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

      <Field label="Recommend">
        <Select
          value={typeKey}
          disabled={saving}
          onChange={(e) => {
            setTypeKey(e.target.value);
            touched();
          }}
        >
          <option value="">default consultation</option>
          {consultationTypes.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
              {!t.active && " (inactive)"}
            </option>
          ))}
        </Select>
      </Field>

      <Button variant="subtle" size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save"}
      </Button>
      {saved && <Badge tone="green">Saved</Badge>}
      {error != null && <Badge tone="red">{error}</Badge>}
    </div>
  );
}
