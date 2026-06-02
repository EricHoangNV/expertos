// Admin plan-entitlement matrix tests (M15.2.5) — the `app/entitlements/page.tsx` editor (M13.4).
// Covers the matrix render (plan column headers + real pricing + premium emphasis, feature rows +
// type badges, boolean/metered cell rendering), the staged-edit model (toggle → "Unsaved" badge +
// "Publish N changes", publish → per-cell PATCH + note, discard → revert), metered limit validation,
// and the load + per-cell save error paths. Renders through the real Auth + Locale providers
// (M15.2.1 harness), so the `POST /me/admin-session` admin-role resolution + the matrix fetch run.
//
// Note on settling (LEARNINGS #19): the page double-loads on mount — the auth context recreates
// `getIdToken` when the admin-session resolves the role, re-firing the page's `load` (and a second
// `seedDrafts`). Before staging an edit, `ready()` waits until the matrix endpoint has been hit
// twice and the table has rendered, so the staged edit isn't wiped by a trailing re-seed.
import {
  renderWithProviders,
  screen,
  waitFor,
  within,
  fireEvent,
  mockApi,
  apiCalls,
} from "../../test/render";
import type {
  EntitlementCellDto,
  EntitlementMatrixDto,
  EntitlementMatrixFeatureDto,
  EntitlementMatrixPlanDto,
} from "@expertos/shared";
import EntitlementsPage from "./page";

// ── Mock DTO factories ───────────────────────────────────────────────────────

function plan(over: Partial<EntitlementMatrixPlanDto> = {}): EntitlementMatrixPlanDto {
  return { id: "p_x", key: "x", name: "Plan", sortOrder: 0, active: true, prices: [], ...over };
}

function feature(over: Partial<EntitlementMatrixFeatureDto> = {}): EntitlementMatrixFeatureDto {
  return { id: "f_x", key: "x", name: "Feature", type: "boolean", ...over };
}

function cell(over: Partial<EntitlementCellDto> & Pick<EntitlementCellDto, "planId" | "featureId">): EntitlementCellDto {
  return { enabled: false, limit: null, softLimit: null, window: null, ...over };
}

const FREE = plan({ id: "p_free", key: "free", name: "Free", sortOrder: 0, prices: [] });
const PLUS = plan({
  id: "p_plus",
  key: "plus",
  name: "Plus",
  sortOrder: 1,
  prices: [{ interval: "month", amountCents: 499, currency: "usd" }],
});
const PREMIUM = plan({
  id: "p_prem",
  key: "premium",
  name: "Premium",
  sortOrder: 2,
  prices: [
    { interval: "month", amountCents: 999, currency: "usd" },
    { interval: "year", amountCents: 6999, currency: "usd" },
  ],
});
const ASK = feature({ id: "f_ask", key: "ask_question", name: "Ask questions", type: "metered" });
const SAVED = feature({ id: "f_saved", key: "saved_answers", name: "Saved answers", type: "boolean" });

function matrix(over: Partial<EntitlementMatrixDto> = {}): EntitlementMatrixDto {
  return {
    plans: [FREE, PLUS, PREMIUM],
    features: [ASK, SAVED],
    cells: [
      cell({ planId: "p_free", featureId: "f_ask", enabled: true, limit: 10, window: "month" }),
      cell({ planId: "p_plus", featureId: "f_ask", enabled: true, limit: 200, window: "month" }),
      cell({ planId: "p_prem", featureId: "f_ask", enabled: true, limit: null, softLimit: 500, window: "month" }),
      cell({ planId: "p_free", featureId: "f_saved", enabled: false }),
      cell({ planId: "p_plus", featureId: "f_saved", enabled: true }),
      cell({ planId: "p_prem", featureId: "f_saved", enabled: true }),
    ],
    ...over,
  };
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

const PLAN_ORDER = ["Free", "Plus", "Premium"];

/** The `<td>` for a (feature, plan) cell. td[0] is the feature label; td[i+1] is the i-th plan. */
function planCell(featureName: string, planName: string): HTMLElement {
  const rows = Array.from(document.querySelectorAll("tbody tr"));
  const row = rows.find(
    (r) => r.querySelector(".matrix-feature-name")?.textContent === featureName,
  );
  if (row == null) throw new Error(`no row for feature "${featureName}"`);
  const tds = row.querySelectorAll("td");
  return tds[PLAN_ORDER.indexOf(planName) + 1] as HTMLElement;
}

/** Count of matrix loads issued so far. */
function matrixGets(): number {
  return apiCalls().filter((c) => c.pathname === "/admin/entitlements").length;
}

/**
 * Wait until the matrix has rendered AND no further re-load has fired for two consecutive polls.
 *
 * The page issues several matrix loads on mount (LEARNINGS #19, amplified here: the harness sets the
 * mock `currentUser` before render, so the page's first effect already has a token — load fires on
 * mount, then again when the admin-session resolves the role). Each load re-seeds the editable
 * drafts, which would wipe a staged edit. Gating on *quiescence* (load count stable) — rather than a
 * fixed count — makes the staged-edit tests robust to that load fan-out without a magic number.
 */
async function settle(): Promise<void> {
  let prev = -1;
  let stable = 0;
  await waitFor(() => {
    expect(screen.queryByText("Ask questions")).not.toBeNull();
    const n = matrixGets();
    stable = n === prev ? stable + 1 : 0;
    prev = n;
    expect(stable).toBeGreaterThanOrEqual(2);
  });
}

/** Resolve a cell's `.switch` checkbox once the table has settled (see {@link settle}). */
async function checkbox(featureName: string, planName: string): Promise<HTMLInputElement> {
  await settle();
  return planCell(featureName, planName).querySelector('input[type="checkbox"]') as HTMLInputElement;
}

/** Resolve a metered cell's hard-limit input once the table has settled (see {@link settle}). */
async function hardLimit(featureName: string, planName: string): Promise<HTMLInputElement> {
  await settle();
  return within(planCell(featureName, planName)).getByLabelText(
    `${featureName} hard limit`,
  ) as HTMLInputElement;
}

describe("EntitlementsPage — matrix render", () => {
  it("renders plan column headers with real pricing + premium emphasis", async () => {
    mockApi("GET", "/admin/entitlements", { body: matrix() });
    renderWithProviders(<EntitlementsPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByText("$0")).toBeInTheDocument();
      expect(screen.getByText("$4.99/mo")).toBeInTheDocument();
      expect(screen.getByText("$9.99/mo · $69.99/yr")).toBeInTheDocument();
      // The top tier (highest sortOrder) header carries the crimson-tinted emphasis class.
      expect(screen.getByText("Premium").closest("th")).toHaveClass("matrix-col-premium");
      expect(screen.getByText("Free").closest("th")).not.toHaveClass("matrix-col-premium");
    });
  });

  it("renders a feature row per feature with its type badge", async () => {
    mockApi("GET", "/admin/entitlements", { body: matrix() });
    renderWithProviders(<EntitlementsPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByText("Ask questions")).toBeInTheDocument();
      expect(screen.getByText("Saved answers")).toBeInTheDocument();
      expect(screen.getByText("metered")).toBeInTheDocument();
      expect(screen.getByText("boolean")).toBeInTheDocument();
    });
  });

  it("renders a disabled boolean cell as an em-dash and a metered cell as a quota input", async () => {
    mockApi("GET", "/admin/entitlements", { body: matrix() });
    renderWithProviders(<EntitlementsPage />, { role: "admin" });

    await waitFor(() => {
      // saved_answers × Free is off → em-dash + "Off".
      const savedFree = planCell("Saved answers", "Free");
      expect(within(savedFree).getByText("—")).toBeInTheDocument();
      expect(within(savedFree).getByText("Off")).toBeInTheDocument();
      // Every ask_question cell is an enabled metered cell → a hard-limit input each (3 plans).
      expect(screen.getAllByLabelText("Ask questions hard limit")).toHaveLength(3);
      // The Plus hard limit reflects the stored cap.
      const askPlus = planCell("Ask questions", "Plus");
      expect((within(askPlus).getByLabelText("Ask questions hard limit") as HTMLInputElement).value).toBe("200");
    });
  });
});

describe("EntitlementsPage — staged publish", () => {
  it("marks a toggled boolean cell dirty (Unsaved badge + Publish 1 change)", async () => {
    mockApi("GET", "/admin/entitlements", { body: matrix() });
    renderWithProviders(<EntitlementsPage />, { role: "admin" });

    fireEvent.click(await checkbox("Saved answers", "Free"));

    expect(within(planCell("Saved answers", "Free")).getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish 1 change" })).toBeEnabled();
  });

  it("publishes a dirty cell via the per-cell PATCH and shows the published note", async () => {
    mockApi("GET", "/admin/entitlements", { body: matrix() });
    mockApi("PATCH", "/admin/entitlements/p_free/features/f_saved", {
      body: cell({ planId: "p_free", featureId: "f_saved", enabled: true }),
    });
    renderWithProviders(<EntitlementsPage />, { role: "admin" });

    fireEvent.click(await checkbox("Saved answers", "Free"));
    fireEvent.click(screen.getByRole("button", { name: "Publish 1 change" }));

    await waitFor(() => {
      const patch = apiCalls().find(
        (c) => c.method === "PATCH" && c.pathname === "/admin/entitlements/p_free/features/f_saved",
      );
      expect(patch).toBeDefined();
      // A boolean feature forces the metered fields to null.
      expect(patch!.body).toEqual({ enabled: true, limit: null, softLimit: null, window: null });
    });
    await screen.findByText("Published 1 change.");
  });

  it("discards staged edits, reverting the dirty cell", async () => {
    mockApi("GET", "/admin/entitlements", { body: matrix() });
    renderWithProviders(<EntitlementsPage />, { role: "admin" });

    fireEvent.click(await checkbox("Saved answers", "Free"));
    expect(within(planCell("Saved answers", "Free")).getByText("Unsaved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    await waitFor(() => {
      expect(within(planCell("Saved answers", "Free")).queryByText("Unsaved")).toBeNull();
      expect(screen.getByRole("button", { name: "Publish changes" })).toBeDisabled();
    });
  });
});

describe("EntitlementsPage — metered validation", () => {
  it("blocks publish and surfaces the limits error for a non-integer hard limit", async () => {
    mockApi("GET", "/admin/entitlements", { body: matrix() });
    renderWithProviders(<EntitlementsPage />, { role: "admin" });

    fireEvent.change(await hardLimit("Ask questions", "Plus"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish 1 change" }));

    // The whole publish aborts on the client-side validation — no PATCH is sent.
    await within(planCell("Ask questions", "Plus")).findByText("Limits must be whole numbers ≥ 0.");
    expect(apiCalls().some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("EntitlementsPage — error states", () => {
  it("surfaces a load error when the matrix endpoint fails", async () => {
    // Leave GET unmocked → 404 → the page renders the error badge, no table.
    renderWithProviders(<EntitlementsPage />, { role: "admin" });

    await screen.findByText("Request failed (404)");
    expect(document.querySelector(".matrix-table")).toBeNull();
  });

  it("surfaces a per-cell save error from a failed PATCH", async () => {
    mockApi("GET", "/admin/entitlements", { body: matrix() });
    mockApi("PATCH", "/admin/entitlements/p_free/features/f_saved", {
      status: 500,
      body: { message: "Nope" },
    });
    renderWithProviders(<EntitlementsPage />, { role: "admin" });

    fireEvent.click(await checkbox("Saved answers", "Free"));
    fireEvent.click(screen.getByRole("button", { name: "Publish 1 change" }));

    // The client surfaces the API `{ message }` body inline on the cell; no success note.
    await within(planCell("Saved answers", "Free")).findByText("Nope");
    expect(screen.queryByText(/Published/)).toBeNull();
  });
});
