import {
  recommendationRespondSchema,
  bookingReconcileSchema,
  recommendationTriggerSchema,
  recommendationRuleUpdateSchema,
} from "./consultation";

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

describe("recommendationTriggerSchema", () => {
  it.each(["topic", "depth", "low_confidence", "high_intent"] as const)(
    "accepts the %s trigger",
    (trigger) => {
      expect(recommendationTriggerSchema.parse(trigger)).toBe(trigger);
    },
  );

  it("rejects an unknown trigger", () => {
    expect(recommendationTriggerSchema.safeParse("urgency").success).toBe(false);
  });
});

describe("recommendationRuleUpdateSchema", () => {
  it("defaults the optional fields (threshold null, keywords [], priority 0, type null)", () => {
    expect(recommendationRuleUpdateSchema.parse({ enabled: true })).toEqual({
      enabled: true,
      threshold: null,
      keywords: [],
      priority: 0,
      consultationTypeKey: null,
    });
  });

  it("keeps a fully-specified rule and trims keywords + the type key", () => {
    expect(
      recommendationRuleUpdateSchema.parse({
        enabled: true,
        threshold: 4,
        keywords: [" legal ", "tax"],
        priority: 30,
        consultationTypeKey: " intro_call ",
      }),
    ).toEqual({
      enabled: true,
      threshold: 4,
      keywords: ["legal", "tax"],
      priority: 30,
      consultationTypeKey: "intro_call",
    });
  });

  it("requires enabled", () => {
    expect(recommendationRuleUpdateSchema.safeParse({ threshold: 1 }).success).toBe(false);
  });

  it("rejects a negative / non-integer / over-cap threshold and priority", () => {
    expect(recommendationRuleUpdateSchema.safeParse({ enabled: true, threshold: -1 }).success).toBe(false);
    expect(recommendationRuleUpdateSchema.safeParse({ enabled: true, threshold: 1.5 }).success).toBe(false);
    expect(recommendationRuleUpdateSchema.safeParse({ enabled: true, threshold: 100000 }).success).toBe(false);
    expect(recommendationRuleUpdateSchema.safeParse({ enabled: true, priority: -1 }).success).toBe(false);
  });

  it("rejects an empty keyword and an over-cap keyword list", () => {
    expect(recommendationRuleUpdateSchema.safeParse({ enabled: true, keywords: [""] }).success).toBe(false);
    expect(
      recommendationRuleUpdateSchema.safeParse({
        enabled: true,
        keywords: Array.from({ length: 201 }, (_unused, i) => `k${i}`),
      }).success,
    ).toBe(false);
  });
});
