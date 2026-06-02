/**
 * Account page tests (M15.1.4). Drives the real `/account` page through the M15.1.1 harness
 * (real Auth + Locale providers over the firebase + manual-`fetch` mocks) to cover the M6.1/M6.3
 * plan & usage surface: the current-plan badge, the metered usage meter (M6.3) and boolean
 * feature rows, the disabled-metered "not included" path, the self-serve upgrade CTA →
 * `POST /billing/checkout` (M6.2), the customer-portal "Manage billing" → `POST /billing/portal`,
 * the signed-out + load-error states, and locale-aware currency rendering (the page reads the
 * active `Locale` to format prices — VI shows comma-decimal currency + a localized interval suffix).
 *
 * Locale-toggle *persistence* and the *sign-out* flow are provider/page mechanisms that the account
 * page itself does not render (the toggle + sign-out live in the chat topbar; persistence lives in
 * `LocaleProvider`), so they are exercised by the i18n / shared-lib suites (M15.1.5 / M15.1.6). Here
 * we cover the account page's own dependence on the locale: price formatting.
 */
import userEvent from "@testing-library/user-event";
import type {
  AvailablePlansDto,
  EntitlementsDto,
  EntitlementView,
} from "@expertos/shared";
import AccountPage from "./page";
import {
  renderWithProviders,
  screen,
  waitFor,
  apiCalls,
  mockApi,
} from "../../test/render";

/** A metered feature row (M6.3 quota meter) — defaults to the question quota, partly consumed. */
function metered(over: Partial<EntitlementView> = {}): EntitlementView {
  return {
    key: "ask_question",
    name: "Questions",
    type: "metered",
    enabled: true,
    limit: 200,
    softLimit: null,
    window: "month",
    used: 5,
    remaining: 195,
    ...over,
  };
}

/** A boolean feature row. */
function boolean(over: Partial<EntitlementView> = {}): EntitlementView {
  return {
    key: "document_upload",
    name: "Document uploads",
    type: "boolean",
    enabled: true,
    ...over,
  };
}

/** An entitlements response on the given plan with the given feature rows. */
function entitlements(
  planName: string,
  features: EntitlementView[],
): EntitlementsDto {
  return { plan: { key: planName.toLowerCase(), name: planName }, features };
}

/** Register the two mount fetches the page issues on load (entitlements + upgrade plans). */
function mockMountFetches(opts: {
  entitlements?: EntitlementsDto;
  plans?: AvailablePlansDto;
} = {}) {
  mockApi("GET", "/me/entitlements", {
    body: opts.entitlements ?? entitlements("Plus", [metered()]),
  });
  mockApi("GET", "/me/plans", {
    body:
      opts.plans ?? {
        currentPlanKey: "plus",
        hasActiveSubscription: false,
        upgrades: [],
      },
  });
}

describe("AccountPage", () => {
  // jsdom doesn't implement navigation, so the billing redirect (`window.location.href = …`)
  // would log "Not implemented" and leave href unchanged. Swap in a writable stub we can assert on.
  const realLocation = window.location;
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...realLocation, href: "" },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  it("shows the sign-in prompt when signed out", async () => {
    renderWithProviders(<AccountPage />, { user: null });
    expect(
      await screen.findByText("Please sign in on the home page to view your plan."),
    ).toBeInTheDocument();
  });

  it("renders the current plan and a metered usage meter", async () => {
    mockMountFetches({
      entitlements: entitlements("Plus", [metered({ used: 40, limit: 200 })]),
    });
    renderWithProviders(<AccountPage />);

    expect(await screen.findByText("Current plan: Plus")).toBeInTheDocument();
    // The M6.3 usage meter draws used vs the hard cap.
    expect(screen.getByText("Questions")).toBeInTheDocument();
    expect(screen.getByText("40 / 200")).toBeInTheDocument();
  });

  it("renders a disabled metered feature as not-included instead of a 0/0 meter", async () => {
    mockMountFetches({
      entitlements: entitlements("Free", [
        metered({ enabled: false, name: "Concierge review" }),
      ]),
    });
    renderWithProviders(<AccountPage />);

    expect(await screen.findByText("Concierge review")).toBeInTheDocument();
    expect(screen.getByText("Not included")).toBeInTheDocument();
    // No meter count rendered for the disabled feature.
    expect(screen.queryByText(/\/ \d/)).not.toBeInTheDocument();
  });

  it("renders boolean features as included / not-included badges", async () => {
    mockMountFetches({
      entitlements: entitlements("Plus", [
        boolean({ name: "Document uploads", enabled: true }),
        boolean({ key: "voice_picker", name: "Expert voices", enabled: false }),
      ]),
    });
    renderWithProviders(<AccountPage />);

    expect(await screen.findByText("Document uploads")).toBeInTheDocument();
    expect(screen.getByText("Included")).toBeInTheDocument();
    expect(screen.getByText("Expert voices")).toBeInTheDocument();
    expect(screen.getByText("Not included")).toBeInTheDocument();
  });

  it("starts a hosted checkout from the upgrade CTA", async () => {
    const user = userEvent.setup();
    mockMountFetches({
      entitlements: entitlements("Free", [metered({ limit: 10, used: 3 })]),
      plans: {
        currentPlanKey: "free",
        hasActiveSubscription: false,
        upgrades: [
          {
            key: "plus",
            name: "Plus",
            prices: [{ interval: "month", amountCents: 499, currency: "USD" }],
          },
        ],
      },
    });
    mockApi("POST", "/billing/checkout", {
      body: { url: "https://checkout.stripe.test/session" },
    });
    renderWithProviders(<AccountPage />);

    await user.click(
      await screen.findByRole("button", { name: "Upgrade to Plus — $4.99/mo" }),
    );

    await waitFor(() => {
      const call = apiCalls().find(
        (c) => c.method === "POST" && c.pathname === "/billing/checkout",
      );
      expect(call).toBeDefined();
      expect(call?.body).toEqual({ planKey: "plus", interval: "month" });
    });
    expect(window.location.href).toBe("https://checkout.stripe.test/session");
  });

  it("opens the customer portal when the user has an active subscription", async () => {
    const user = userEvent.setup();
    mockMountFetches({
      entitlements: entitlements("Plus", [metered()]),
      plans: {
        currentPlanKey: "plus",
        hasActiveSubscription: true,
        upgrades: [],
      },
    });
    mockApi("POST", "/billing/portal", {
      body: { url: "https://portal.stripe.test/session" },
    });
    renderWithProviders(<AccountPage />);

    await user.click(await screen.findByRole("button", { name: "Manage billing" }));

    await waitFor(() => {
      expect(
        apiCalls().some(
          (c) => c.method === "POST" && c.pathname === "/billing/portal",
        ),
      ).toBe(true);
    });
    expect(window.location.href).toBe("https://portal.stripe.test/session");
  });

  it("surfaces an error when the plan fails to load", async () => {
    mockApi("GET", "/me/entitlements", { status: 500 });
    mockApi("GET", "/me/plans", { status: 500 });
    renderWithProviders(<AccountPage />);

    expect(
      await screen.findByText(
        "Couldn't load your plan and usage — please try again.",
      ),
    ).toBeInTheDocument();
  });

  it("renders Vietnamese copy and locale-aware currency when the locale is VI", async () => {
    mockMountFetches({
      entitlements: entitlements("Free", [metered({ limit: 10, used: 3 })]),
      plans: {
        currentPlanKey: "free",
        hasActiveSubscription: false,
        upgrades: [
          {
            key: "premium",
            name: "Premium",
            prices: [{ interval: "month", amountCents: 999, currency: "USD" }],
          },
        ],
      },
    });
    renderWithProviders(<AccountPage />, { locale: "vi" });

    // VI heading + upgrade label from the account dictionary (await the data-dependent
    // upgrade section so we don't race the mount fetches; the heading is always present).
    expect(await screen.findByText("Nâng cấp")).toBeInTheDocument();
    expect(screen.getByText("Gói & mức dùng")).toBeInTheDocument();
    // VI formats the price comma-decimal ("9,99") with a localized interval suffix ("tháng").
    const upgrade = screen.getByRole("button", {
      name: (name) => name.includes("9,99") && name.includes("tháng"),
    });
    expect(upgrade).toBeInTheDocument();
  });
});
