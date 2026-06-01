"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Select, Table } from "@expertos/ui";
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

export default function EntitlementsPage() {
  const { getIdToken } = useAuth();
  const [matrix, setMatrix] = useState<EntitlementMatrixDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setMatrix(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      setMatrix(await getEntitlementMatrix(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the entitlement matrix.");
    }
  }, [getIdToken]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Fold a freshly saved cell back into the loaded matrix (replace the row or append it). */
  const applyCell = useCallback((saved: EntitlementCellDto) => {
    setMatrix((prev) => {
      if (prev == null) {
        return prev;
      }
      const others = prev.cells.filter(
        (c) => !(c.planId === saved.planId && c.featureId === saved.featureId),
      );
      return { ...prev, cells: [...others, saved] };
    });
  }, []);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Paywall</div>
          <h1 className="h1">Plan entitlements</h1>
          <p className="muted">
            What each plan grants, and the metered quotas. Changes take effect immediately — no
            deploy. A soft limit degrades to a cheaper model instead of blocking.
          </p>
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}

      {matrix != null && (
        <Table>
          <thead>
            <tr>
              <th>Feature</th>
              {matrix.plans.map((plan) => (
                <th key={plan.id}>
                  {plan.name}
                  {!plan.active && " (inactive)"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.features.map((feature) => (
              <tr key={feature.id}>
                <td>
                  <div className="col gap1">
                    <strong>{feature.name}</strong>
                    <Badge tone={feature.type === "metered" ? "info" : "ink"}>
                      {feature.type}
                    </Badge>
                  </div>
                </td>
                {matrix.plans.map((plan) => (
                  <td key={plan.id}>
                    <CellEditor
                      plan={plan}
                      feature={feature}
                      cell={matrix.cells.find(
                        (c) =>
                          cellKey(c.planId, c.featureId) === cellKey(plan.id, feature.id),
                      )}
                      getToken={getIdToken}
                      onSaved={applyCell}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AdminFrame>
  );
}

interface CellEditorProps {
  plan: EntitlementMatrixPlanDto;
  feature: EntitlementMatrixFeatureDto;
  cell: EntitlementCellDto | undefined;
  getToken: () => Promise<string | null>;
  onSaved: (cell: EntitlementCellDto) => void;
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

/**
 * One editable (plan, feature) cell. A boolean feature shows only an enable toggle; a metered feature
 * also shows hard-limit / soft-limit / window controls. Saving posts the whole cell; the server
 * derives type-coherent values and rejects an incoherent metered config (surfaced inline).
 */
function CellEditor({ plan, feature, cell, getToken, onSaved }: CellEditorProps) {
  const metered = feature.type === "metered";
  const [enabled, setEnabled] = useState(cell?.enabled ?? false);
  const [limit, setLimit] = useState(cell?.limit != null ? String(cell.limit) : "");
  const [softLimit, setSoftLimit] = useState(cell?.softLimit != null ? String(cell.softLimit) : "");
  const [window, setWindow] = useState<string>(cell?.window ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setError(null);
    setSaved(false);

    let body: EntitlementUpdateInput;
    if (metered) {
      const parsedLimit = parseQuota(limit);
      const parsedSoft = parseQuota(softLimit);
      if (parsedLimit === undefined || parsedSoft === undefined) {
        setError("Limits must be whole numbers ≥ 0.");
        return;
      }
      body = {
        enabled,
        limit: parsedLimit,
        softLimit: parsedSoft,
        window: window === "" ? null : (window as UsageWindowValue),
      };
    } else {
      body = { enabled, limit: null, softLimit: null, window: null };
    }

    setSaving(true);
    try {
      const token = await getToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      onSaved(await updateEntitlementCell(token, plan.id, feature.id, body));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [metered, enabled, limit, softLimit, window, getToken, onSaved, plan.id, feature.id]);

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

      {metered && (
        <>
          <Field label="Hard limit">
            <Input
              type="number"
              min={0}
              placeholder="∞"
              value={limit}
              disabled={saving}
              onChange={(e) => {
                setLimit(e.target.value);
                touched();
              }}
            />
          </Field>
          <Field label="Soft limit">
            <Input
              type="number"
              min={0}
              placeholder="none"
              value={softLimit}
              disabled={saving}
              onChange={(e) => {
                setSoftLimit(e.target.value);
                touched();
              }}
            />
          </Field>
          <Field label="Window">
            <Select
              value={window}
              disabled={saving}
              onChange={(e) => {
                setWindow(e.target.value);
                touched();
              }}
            >
              <option value="">none</option>
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}

      <Button variant="subtle" size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save"}
      </Button>
      {saved && <Badge tone="green">Saved</Badge>}
      {error != null && <Badge tone="red">{error}</Badge>}
    </div>
  );
}
