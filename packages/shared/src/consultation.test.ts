import { recommendationRespondSchema, bookingReconcileSchema } from "./consultation";

describe("recommendationRespondSchema", () => {
  it.each(["book", "maybe_later", "ask_another"] as const)("accepts the %s response", (response) => {
    expect(recommendationRespondSchema.parse({ response })).toEqual({ response });
  });

  it("rejects the un-chosen 'pending' default (clients can only report a real choice)", () => {
    expect(recommendationRespondSchema.safeParse({ response: "pending" }).success).toBe(false);
  });

  it("rejects an unknown response and a missing response", () => {
    expect(recommendationRespondSchema.safeParse({ response: "later" }).success).toBe(false);
    expect(recommendationRespondSchema.safeParse({}).success).toBe(false);
  });
});

describe("bookingReconcileSchema", () => {
  it("accepts an empty body (since defaults to a server-chosen lookback window)", () => {
    expect(bookingReconcileSchema.parse({})).toEqual({});
  });

  it("coerces an ISO since string to a Date", () => {
    const parsed = bookingReconcileSchema.parse({ since: "2026-06-01T00:00:00.000Z" });
    expect(parsed.since).toEqual(new Date("2026-06-01T00:00:00.000Z"));
  });

  it("rejects an unparseable since", () => {
    expect(bookingReconcileSchema.safeParse({ since: "not-a-date" }).success).toBe(false);
  });
});
