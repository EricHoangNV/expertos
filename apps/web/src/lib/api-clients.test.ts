/**
 * Tests for the web API client functions (M15.1.6). Each client is a thin `fetch` wrapper
 * over the API: it sends the right method/path/auth header/body and either returns the parsed
 * JSON or throws on a non-2xx status. We assert both the happy path (correct request shape +
 * pass-through of the response) and the error path (throw with the status), exercising the
 * shared `fetch` mock from `test/api-mock`.
 */
import type { ChatStreamEvent } from "@expertos/shared";
import { installFetchMock, mockApi, apiCalls, resetApiMocks } from "../../test/api-mock";
import {
  streamChat,
  respondToRecommendation,
  submitFeedback,
  fetchExperts,
} from "./chat-client";
import {
  fetchEntitlements,
  fetchUpgradePlans,
  startCheckout,
  openBillingPortal,
} from "./account-client";
import {
  listConversations,
  getConversation,
  searchConversations,
  renameConversation,
  listSavedAnswers,
  createSavedAnswer,
  removeSavedAnswer,
} from "./history-client";
import { uploadFile, UploadEntitlementError, UPLOAD_ACCEPT } from "./upload-client";
import { fetchProfileLocale, updateProfileLocale } from "./i18n/profile-client";

const TOKEN = "test-token";

// The clients are also exercised by jest.setup's global hooks, but this suite imports the
// fetch mock directly so it runs standalone without rendering a component.
beforeEach(() => installFetchMock());
afterEach(() => resetApiMocks());

/** Find the single recorded call for `METHOD pathname`. */
function call(method: string, pathname: string) {
  return apiCalls().find((c) => c.method === method && c.pathname === pathname);
}

describe("chat-client", () => {
  describe("streamChat", () => {
    it("parses SSE frames and invokes onEvent for each, sending the request body + auth", async () => {
      const done: ChatStreamEvent = {
        type: "done",
        conversationId: "c1",
        messageId: "m1",
        citations: [],
        insufficientKnowledge: false,
      };
      mockApi("POST", "/chat", {
        sse: [{ type: "delta", text: "Hel" }, { type: "delta", text: "lo" }, done],
      });

      const events: ChatStreamEvent[] = [];
      await streamChat({ text: "hi", language: "en" }, TOKEN, (e) => events.push(e));

      expect(events).toEqual([
        { type: "delta", text: "Hel" },
        { type: "delta", text: "lo" },
        done,
      ]);
      const req = call("POST", "/chat");
      expect(req?.body).toEqual({ text: "hi", language: "en" });
      expect(req?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(req?.headers["content-type"]).toBe("application/json");
    });

    it("throws when the chat response is not ok", async () => {
      mockApi("POST", "/chat", { status: 500 });
      await expect(
        streamChat({ text: "hi" }, TOKEN, () => {}),
      ).rejects.toThrow("chat request failed (500)");
    });
  });

  describe("respondToRecommendation", () => {
    it("posts the response to the recommendation and returns the result", async () => {
      const result = { booking: { tidycalLink: "https://tidycal.test/x" } };
      mockApi("POST", "/consultation-recommendations/rec-1/respond", { body: result });

      const out = await respondToRecommendation("rec-1", "book", TOKEN);
      expect(out).toEqual(result);
      const req = call("POST", "/consultation-recommendations/rec-1/respond");
      expect(req?.body).toEqual({ response: "book" });
      expect(req?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    });

    it("throws on a failed response", async () => {
      mockApi("POST", "/consultation-recommendations/rec-1/respond", { status: 404 });
      await expect(
        respondToRecommendation("rec-1", "book", TOKEN),
      ).rejects.toThrow("recommendation response failed (404)");
    });
  });

  describe("submitFeedback", () => {
    it("includes the optional reason when provided", async () => {
      mockApi("POST", "/answer-feedback", { body: { id: "f1" } });
      await submitFeedback("m1", false, TOKEN, "off-topic");
      expect(call("POST", "/answer-feedback")?.body).toEqual({
        messageId: "m1",
        helpful: false,
        reason: "off-topic",
      });
    });

    it("omits the reason when not provided", async () => {
      mockApi("POST", "/answer-feedback", { body: { id: "f1" } });
      await submitFeedback("m1", true, TOKEN);
      expect(call("POST", "/answer-feedback")?.body).toEqual({
        messageId: "m1",
        helpful: true,
      });
    });

    it("throws on a failed submit", async () => {
      mockApi("POST", "/answer-feedback", { status: 400 });
      await expect(submitFeedback("m1", true, TOKEN)).rejects.toThrow(
        "feedback submit failed (400)",
      );
    });
  });

  describe("fetchExperts", () => {
    it("returns the experts list with the auth header", async () => {
      const experts = [{ expertId: "e1", displayName: "Mai", languages: ["en"] }];
      mockApi("GET", "/experts", { body: experts });
      expect(await fetchExperts(TOKEN)).toEqual(experts);
      expect(call("GET", "/experts")?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    });

    it("throws on a failed request", async () => {
      mockApi("GET", "/experts", { status: 503 });
      await expect(fetchExperts(TOKEN)).rejects.toThrow("experts request failed (503)");
    });
  });
});

describe("account-client", () => {
  it("fetchEntitlements returns the entitlements payload", async () => {
    const body = { plan: { key: "plus" }, features: [] };
    mockApi("GET", "/me/entitlements", { body });
    expect(await fetchEntitlements(TOKEN)).toEqual(body);
  });

  it("fetchEntitlements throws on failure", async () => {
    mockApi("GET", "/me/entitlements", { status: 401 });
    await expect(fetchEntitlements(TOKEN)).rejects.toThrow("entitlements request failed (401)");
  });

  it("fetchUpgradePlans returns the available plans", async () => {
    const body = { hasPaidPlan: false, plans: [] };
    mockApi("GET", "/me/plans", { body });
    expect(await fetchUpgradePlans(TOKEN)).toEqual(body);
  });

  it("fetchUpgradePlans throws on failure", async () => {
    mockApi("GET", "/me/plans", { status: 500 });
    await expect(fetchUpgradePlans(TOKEN)).rejects.toThrow("plans request failed (500)");
  });

  it("startCheckout posts plan + interval and returns the hosted url", async () => {
    mockApi("POST", "/billing/checkout", { body: { url: "https://stripe.test/co" } });
    const url = await startCheckout(TOKEN, "plus", "month");
    expect(url).toBe("https://stripe.test/co");
    expect(call("POST", "/billing/checkout")?.body).toEqual({
      planKey: "plus",
      interval: "month",
    });
  });

  it("startCheckout throws on failure", async () => {
    mockApi("POST", "/billing/checkout", { status: 402 });
    await expect(startCheckout(TOKEN, "plus", "year")).rejects.toThrow(
      "checkout request failed (402)",
    );
  });

  it("openBillingPortal returns the portal url", async () => {
    mockApi("POST", "/billing/portal", { body: { url: "https://stripe.test/portal" } });
    expect(await openBillingPortal(TOKEN)).toBe("https://stripe.test/portal");
  });

  it("openBillingPortal throws on failure", async () => {
    mockApi("POST", "/billing/portal", { status: 500 });
    await expect(openBillingPortal(TOKEN)).rejects.toThrow("portal request failed (500)");
  });
});

describe("history-client", () => {
  const page = { limit: 20, offset: 0 };

  it("listConversations passes the page window and returns the list", async () => {
    const body = [{ id: "c1", title: "First" }];
    mockApi("GET", "/conversations", { body });
    expect(await listConversations(TOKEN, page)).toEqual(body);
    expect(call("GET", "/conversations")?.url).toContain("limit=20&offset=0");
  });

  it("listConversations throws on failure", async () => {
    mockApi("GET", "/conversations", { status: 500 });
    await expect(listConversations(TOKEN, page)).rejects.toThrow(
      "conversations request failed (500)",
    );
  });

  it("getConversation returns the transcript", async () => {
    mockApi("GET", "/conversations/c1", { body: { id: "c1", messages: [] } });
    expect(await getConversation(TOKEN, "c1")).toEqual({ id: "c1", messages: [] });
  });

  it("getConversation throws on failure", async () => {
    mockApi("GET", "/conversations/c1", { status: 404 });
    await expect(getConversation(TOKEN, "c1")).rejects.toThrow(
      "conversation request failed (404)",
    );
  });

  it("searchConversations URL-encodes the query", async () => {
    mockApi("GET", "/conversations/search", { body: [] });
    await searchConversations(TOKEN, "cash flow & tax", page);
    expect(call("GET", "/conversations/search")?.url).toContain(
      "q=cash%20flow%20%26%20tax",
    );
  });

  it("searchConversations throws on failure", async () => {
    mockApi("GET", "/conversations/search", { status: 500 });
    await expect(searchConversations(TOKEN, "x", page)).rejects.toThrow(
      "search request failed (500)",
    );
  });

  it("renameConversation PATCHes the new title", async () => {
    mockApi("PATCH", "/conversations/c1", { body: { id: "c1", title: "Renamed" } });
    const out = await renameConversation(TOKEN, "c1", "Renamed");
    expect(out).toEqual({ id: "c1", title: "Renamed" });
    expect(call("PATCH", "/conversations/c1")?.body).toEqual({ title: "Renamed" });
  });

  it("renameConversation throws on failure", async () => {
    mockApi("PATCH", "/conversations/c1", { status: 403 });
    await expect(renameConversation(TOKEN, "c1", "x")).rejects.toThrow("rename failed (403)");
  });

  it("listSavedAnswers returns the bookmarks", async () => {
    mockApi("GET", "/saved-answers", { body: [{ id: "s1" }] });
    expect(await listSavedAnswers(TOKEN, page)).toEqual([{ id: "s1" }]);
  });

  it("listSavedAnswers throws on failure", async () => {
    mockApi("GET", "/saved-answers", { status: 500 });
    await expect(listSavedAnswers(TOKEN, page)).rejects.toThrow(
      "saved-answers request failed (500)",
    );
  });

  it("createSavedAnswer returns 'saved' and forwards the optional note", async () => {
    mockApi("POST", "/saved-answers", { status: 201, body: { id: "s1" } });
    expect(await createSavedAnswer(TOKEN, "m1", "keep this")).toBe("saved");
    expect(call("POST", "/saved-answers")?.body).toEqual({ messageId: "m1", note: "keep this" });
  });

  it("createSavedAnswer maps a 409 to 'duplicate'", async () => {
    mockApi("POST", "/saved-answers", { status: 409 });
    expect(await createSavedAnswer(TOKEN, "m1")).toBe("duplicate");
  });

  it("createSavedAnswer throws on other failures", async () => {
    mockApi("POST", "/saved-answers", { status: 500 });
    await expect(createSavedAnswer(TOKEN, "m1")).rejects.toThrow("save failed (500)");
  });

  it("removeSavedAnswer resolves on a 204", async () => {
    mockApi("DELETE", "/saved-answers/s1", { status: 204 });
    await expect(removeSavedAnswer(TOKEN, "s1")).resolves.toBeUndefined();
  });

  it("removeSavedAnswer throws on a non-204 failure", async () => {
    mockApi("DELETE", "/saved-answers/s1", { status: 500 });
    await expect(removeSavedAnswer(TOKEN, "s1")).rejects.toThrow("remove failed (500)");
  });
});

describe("upload-client", () => {
  it("UPLOAD_ACCEPT lists the supported types", () => {
    expect(UPLOAD_ACCEPT).toContain(".xlsx");
    expect(UPLOAD_ACCEPT).toContain("application/pdf");
  });

  it("uploadFile posts multipart form-data and returns the uploaded file", async () => {
    mockApi("POST", "/uploads", { body: { id: "u1", filename: "data.csv" } });
    const file = new File(["a,b\n1,2"], "data.csv", { type: "text/csv" });
    const out = await uploadFile(TOKEN, file, "temporary", "conv-1");
    expect(out).toEqual({ id: "u1", filename: "data.csv" });
    const req = call("POST", "/uploads");
    expect(req?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    // Content-Type is intentionally unset so the browser writes the multipart boundary.
    expect(req?.headers["content-type"]).toBeUndefined();
  });

  it("uploadFile surfaces the API's {message} on rejection", async () => {
    mockApi("POST", "/uploads", { status: 415, body: { message: "unsupported file type" } });
    const file = new File(["x"], "evil.exe", { type: "application/octet-stream" });
    await expect(uploadFile(TOKEN, file, "temporary")).rejects.toThrow("unsupported file type");
  });

  it("uploadFile falls back to a status message when the body has no message", async () => {
    mockApi("POST", "/uploads", { status: 413 });
    const file = new File(["x"], "big.pdf", { type: "application/pdf" });
    await expect(uploadFile(TOKEN, file, "persistent")).rejects.toThrow("upload failed (413)");
  });

  it("uploadFile throws a typed UploadEntitlementError on a 402 entitlement-denied payload", async () => {
    // The 402 carries the structured upgrade payload (no user-facing `message`); the UI localizes it
    // into a friendly upgrade prompt rather than surfacing the framework's bare "Http Exception".
    mockApi("POST", "/uploads", {
      status: 402,
      body: {
        reason: "feature_disabled",
        feature: "document_upload",
        currentPlan: "free",
        upgradeOptions: [{ key: "plus", name: "Plus" }],
        remainingQuota: null,
        message: "Http Exception",
      },
    });
    const file = new File(["a,b\n1,2"], "data.csv", { type: "text/csv" });
    await expect(uploadFile(TOKEN, file, "temporary")).rejects.toMatchObject({
      name: "UploadEntitlementError",
      payload: { reason: "feature_disabled", feature: "document_upload" },
    });
    // The typed error exposes the payload so the caller can render the offered upgrade tiers.
    const err = await uploadFile(TOKEN, file, "temporary").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadEntitlementError);
    expect((err as UploadEntitlementError).payload.upgradeOptions).toEqual([
      { key: "plus", name: "Plus" },
    ]);
  });

  it("uploadFile treats a non-entitlement 402 as a plain error", async () => {
    mockApi("POST", "/uploads", { status: 402, body: { message: "payment required" } });
    const file = new File(["x"], "f.pdf", { type: "application/pdf" });
    await expect(uploadFile(TOKEN, file, "temporary")).rejects.toThrow("payment required");
  });
});

describe("i18n profile-client", () => {
  it("fetchProfileLocale reads the persisted locale from GET /me", async () => {
    mockApi("GET", "/me", { body: { locale: "vi" } });
    expect(await fetchProfileLocale(TOKEN)).toBe("vi");
  });

  it("fetchProfileLocale throws on failure", async () => {
    mockApi("GET", "/me", { status: 401 });
    await expect(fetchProfileLocale(TOKEN)).rejects.toThrow("profile request failed (401)");
  });

  it("updateProfileLocale PATCHes the chosen locale", async () => {
    mockApi("PATCH", "/me/locale", { body: { locale: "vi" } });
    const out = await updateProfileLocale(TOKEN, "vi");
    expect(out).toEqual({ locale: "vi" });
    expect(call("PATCH", "/me/locale")?.body).toEqual({ locale: "vi" });
  });

  it("updateProfileLocale throws on failure", async () => {
    mockApi("PATCH", "/me/locale", { status: 422 });
    await expect(updateProfileLocale(TOKEN, "en")).rejects.toThrow("locale update failed (422)");
  });
});
