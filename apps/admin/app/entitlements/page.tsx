"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input, Select, Table } from "@expertos/ui";
import type {
  EntitlementCellDto,
  EntitlementMatrixDto,
  EntitlementMatrixFeatureDto,
  EntitlementMatrixPlanDto,
  EntitlementUpdateInput,
  UsageWindowValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getEntitlementMatrix, updateEntitlementCell } from "../../src/lib/admin-client";

const WINDOWS: UsageWindowValue[] = ["day", "week", "month"];

/** Map key for a (plan, feature) cell. */
function cellKey(planId: string, featureId: string): string {
  return `${planId}:${featureId}`;
}

/** The editable draft of one cell — string-typed so a partially-typed quota survives a re-render. */
interface CellDraft {
  enabled: boolean;
  limit: string;
  softLimit: string;
  window: string;
}

/** Project a server cell (or an unpopulated pair) into its editable draft. */
function toDraft(cell: EntitlementCellDto | undefined): CellDraft {
  return {
    enabled: cell?.enabled ?? false,
    limit: cell?.limit != null ? String(cell.limit) : "",
    softLimit: cell?.softLimit != null ? String(cell.softLimit) : "",
    window: cell?.window ?? "",
  };
}

function draftsEqual(a: CellDraft, b: CellDraft): boolean {
  return (
    a.enabled === b.enabled &&
    a.limit === b.limit &&
    a.softLimit === b.softLimit &&
    a.window === b.window
  );
}

/** Parse a quota input: blank → null (no cap); a non-negative integer → that number; else `undefined`. */
function parseQuota(raw: string): number | null | undefined {
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

/** Build the PATCH body for a draft, given the feature type. Returns a string error if invalid. */
function buildBody(
  feature: EntitlementMatrixFeatureDto,
  draft: CellDraft,
): EntitlementUpdateInput | string {
  if (feature.type !== "metered") {
    return { enabled: draft.enabled, limit: null, softLimit: null, window: null };
  }
  const limit = parseQuota(draft.limit);
  const softLimit = parseQuota(draft.softLimit);
  if (limit === undefined || softLimit === undefined) {
    return "Limits must be whole numbers ≥ 0.";
  }
  return {
    enabled: draft.enabled,
    limit,
    softLimit,
    window: draft.window === "" ? null : (draft.window as UsageWindowValue),
  };
}

/** Format a plan's configured prices for the column header (e.g. "$4.99/mo · $69.99/yr", or "$0"). */
function priceLabel(plan: EntitlementMatrixPlanDto): string {
  if (plan.prices.length === 0) {
    return "$0";
  }
  const order: Record<string, number> = { month: 0, year: 1 };
  return [...plan.prices]
    .sort((a, b) => (order[a.interval] ?? 9) - (order[b.interval] ?? 9))
    .map((p) => {
      const amount = (p.amountCents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: (p.currency || "usd").toUpperCase(),
        minimumFractionDigits: 2,
      });
      return `${amount}/${p.interval === "year" ? "yr" : "mo"}`;
    })
    .join(" · ");
}

const WINDOW_UNIT: Record<UsageWindowValue, string> = {
  day: "/day",
  week: "/week",
  month: "/month",
};

export default function EntitlementsPage() {
  const { getIdToken } = useAuth();
  const [matrix, setMatrix] = useState<EntitlementMatrixDto | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CellDraft>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);

  /** Seed drafts for every plan × feature pair from the server matrix. */
  const seedDrafts = useCallback((m: EntitlementMatrixDto) => {
    const next: Record<string, CellDraft> = {};
    for (const plan of m.plans) {
      for (const feature of m.features) {
        const key = cellKey(plan.id, feature.id);
        const cell = m.cells.find((c) => cellKey(c.planId, c.featureId) === key);
        next[key] = toDraft(cell);
      }
    }
    setDrafts(next);
    setCellErrors({});
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setPublishNote(null);
    setMatrix(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      const m = await getEntitlementMatrix(token);
      setMatrix(m);
      seedDrafts(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the entitlement matrix.");
    }
  }, [getIdToken, seedDrafts]);

  useEffect(() => {
    void load();
  }, [load]);

  /** A lookup of server cells, to detect which drafts diverge. */
  const serverDrafts = useMemo(() => {
    const map: Record<string, CellDraft> = {};
    if (matrix == null) {
      return map;
    }
    for (const plan of matrix.plans) {
      for (const feature of matrix.features) {
        const key = cellKey(plan.id, feature.id);
        const cell = matrix.cells.find((c) => cellKey(c.planId, c.featureId) === key);
        map[key] = toDraft(cell);
      }
    }
    return map;
  }, [matrix]);

  const dirtyKeys = useMemo(() => {
    return Object.keys(drafts).filter((key) => {
      const server = serverDrafts[key];
      return server != null && !draftsEqual(drafts[key], server);
    });
  }, [drafts, serverDrafts]);

  const setCell = useCallback((key: string, patch: Partial<CellDraft>) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setPublishNote(null);
    setCellErrors((prev) => {
      if (prev[key] == null) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /** Discard unsaved edits, reverting every draft to the last-loaded server state. */
  const discard = useCallback(() => {
    if (matrix != null) {
      seedDrafts(matrix);
      setPublishNote(null);
    }
  }, [matrix, seedDrafts]);

  /** Publish every dirty cell via the per-cell PATCH (effective immediately — no deploy). */
  const publish = useCallback(async () => {
    if (matrix == null || dirtyKeys.length === 0) {
      return;
    }
    setError(null);
    setPublishNote(null);
    const featureById = new Map(matrix.features.map((f) => [f.id, f]));

    // Validate every dirty cell up-front; abort the whole publish on a client-side error.
    const jobs: { key: string; planId: string; featureId: string; body: EntitlementUpdateInput }[] = [];
    const nextErrors: Record<string, string> = {};
    for (const key of dirtyKeys) {
      const [planId, featureId] = key.split(":");
      const feature = featureById.get(featureId);
      if (feature == null) {
        continue;
      }
      const built = buildBody(feature, drafts[key]);
      if (typeof built === "string") {
        nextErrors[key] = built;
      } else {
        jobs.push({ key, planId, featureId, body: built });
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setCellErrors(nextErrors);
      return;
    }

    setPublishing(true);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      const saved: EntitlementCellDto[] = [];
      const errors: Record<string, string> = {};
      for (const job of jobs) {
        try {
          saved.push(await updateEntitlementCell(token, job.planId, job.featureId, job.body));
        } catch (err) {
          errors[job.key] = err instanceof Error ? err.message : "Save failed.";
        }
      }

      // Fold every successfully-saved cell back into the matrix (the new server truth).
      if (saved.length > 0) {
        setMatrix((prev) => {
          if (prev == null) {
            return prev;
          }
          const bySaved = new Set(saved.map((c) => cellKey(c.planId, c.featureId)));
          const others = prev.cells.filter((c) => !bySaved.has(cellKey(c.planId, c.featureId)));
          return { ...prev, cells: [...others, ...saved] };
        });
      }
      setCellErrors(errors);
      if (Object.keys(errors).length === 0) {
        setPublishNote(`Published ${saved.length} change${saved.length === 1 ? "" : "s"}.`);
      }
    } finally {
      setPublishing(false);
    }
  }, [matrix, dirtyKeys, drafts, getIdToken]);

  // The top tier (highest sortOrder) is the visually-emphasized "Premium" column.
  const premiumPlanId = useMemo(() => {
    if (matrix == null || matrix.plans.length === 0) {
      return null;
    }
    return matrix.plans.reduce((top, p) => (p.sortOrder > top.sortOrder ? p : top)).id;
  }, [matrix]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Configuration, not code</div>
          <h1 className="h1">Plan &amp; entitlement matrix</h1>
          <p className="lede">
            This table is the free-vs-paid definition. Edit a cell, hit publish — no deploy. One
            guard (<code>@RequiresEntitlement</code>) reads it everywhere.
          </p>
        </div>
        <div className="row gap2">
          <Button
            variant="ghost"
            disabled={publishing || dirtyKeys.length === 0}
            onClick={discard}
          >
            Discard changes
          </Button>
          <Button
            variant="primary"
            disabled={publishing || dirtyKeys.length === 0}
            onClick={() => void publish()}
          >
            {publishing
              ? "Publishing…"
              : dirtyKeys.length > 0
                ? `Publish ${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"}`
                : "Publish changes"}
          </Button>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}
      {publishNote != null && <Badge tone="green">{publishNote}</Badge>}

      {matrix != null && (
        <Card pad>
          <Table className="matrix-table">
            <thead>
              <tr>
                <th>Feature</th>
                {matrix.plans.map((plan) => (
                  <th
                    key={plan.id}
                    className={plan.id === premiumPlanId ? "matrix-col-premium" : undefined}
                  >
                    <span className="matrix-plan">
                      <span className="matrix-plan-name">
                        {plan.name}
                        {!plan.active && " (inactive)"}
                      </span>
                      <span className="matrix-plan-price">{priceLabel(plan)}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.features.map((feature) => (
                <tr key={feature.id}>
                  <td>
                    <div className="col gap1">
                      <span className="matrix-feature-name">{feature.name}</span>
                      <Badge tone={feature.type === "metered" ? "info" : "ink"}>
                        {feature.type}
                      </Badge>
                    </div>
                  </td>
                  {matrix.plans.map((plan) => {
                    const key = cellKey(plan.id, feature.id);
                    return (
                      <td
                        key={plan.id}
                        className={plan.id === premiumPlanId ? "matrix-col-premium" : undefined}
                      >
                        <MatrixCell
                          feature={feature}
                          draft={drafts[key] ?? toDraft(undefined)}
                          dirty={dirtyKeys.includes(key)}
                          error={cellErrors[key]}
                          disabled={publishing}
                          onChange={(patch) => setCell(key, patch)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="matrix-foot">
        <Card pad>
          <Badge tone="amber">Fair use</Badge>
          <h3 className="h3 matrix-foot-title">Premium never hard-stops</h3>
          <p className="muted">
            Past the soft cap, the guard returns the answer on a lighter model instead of a 402 —
            degrade, don&apos;t block. A hard limit is the only true wall.
          </p>
        </Card>
        <Card pad>
          <Badge tone="info">Quota cells</Badge>
          <h3 className="h3 matrix-foot-title">Numbers calibrated to unit economics</h3>
          <p className="muted">
            Open Decision #4 set cost-per-answer vs price before these quotas locked (M6.5). A
            metered cell needs a window; a soft limit must sit below the hard limit to fire.
          </p>
        </Card>
      </div>
    </AdminFrame>
  );
}

interface MatrixCellProps {
  feature: EntitlementMatrixFeatureDto;
  draft: CellDraft;
  dirty: boolean;
  error: string | undefined;
  disabled: boolean;
  onChange: (patch: Partial<CellDraft>) => void;
}

/**
 * One editable matrix cell. A boolean feature renders a single `.switch` (granted vs not). A metered
 * feature adds an editable hard-limit input + window unit ("UNLIMITED" when both are blank) and a
 * soft-limit input below. Edits are staged locally; the parent publishes dirty cells in a batch.
 */
function MatrixCell({ feature, draft, dirty, error, disabled, onChange }: MatrixCellProps) {
  const metered = feature.type === "metered";
  const unit =
    draft.window !== "" ? WINDOW_UNIT[draft.window as UsageWindowValue] : "";

  return (
    <div className="matrix-cell">
      <label className="matrix-toggle">
        <span className="switch">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={disabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <span className="track" />
        </span>
        {metered ? "Granted" : draft.enabled ? "Included" : "Off"}
      </label>

      {metered && draft.enabled && (
        <>
          <div className="matrix-quota">
            <Input
              type="number"
              min={0}
              aria-label={`${feature.name} hard limit`}
              placeholder="∞"
              value={draft.limit}
              disabled={disabled}
              onChange={(e) => onChange({ limit: e.target.value })}
            />
            {draft.limit.trim() === "" && draft.softLimit.trim() === "" ? (
              <span className="matrix-unlimited">Unlimited</span>
            ) : (
              <Select
                aria-label={`${feature.name} window`}
                value={draft.window}
                disabled={disabled}
                onChange={(e) => onChange({ window: e.target.value })}
              >
                <option value="">window…</option>
                {WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {WINDOW_UNIT[w]}
                  </option>
                ))}
              </Select>
            )}
            {unit !== "" && draft.limit.trim() !== "" && (
              <span className="matrix-quota-unit">{unit}</span>
            )}
          </div>
          <label className="matrix-quota-soft">
            soft
            <Input
              type="number"
              min={0}
              aria-label={`${feature.name} soft limit`}
              placeholder="none"
              value={draft.softLimit}
              disabled={disabled}
              onChange={(e) => onChange({ softLimit: e.target.value })}
            />
          </label>
        </>
      )}

      {!metered && !draft.enabled && <span className="matrix-disabled">—</span>}

      {dirty && error == null && <Badge tone="amber">Unsaved</Badge>}
      {error != null && <span className="matrix-cell-err">{error}</span>}
    </div>
  );
}
