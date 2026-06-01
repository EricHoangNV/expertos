import {
  conciergeQueueListQuerySchema,
  reviewConfigUpdateSchema,
  reviewEscalateSchema,
  reviewResponseCreateSchema,
  reviewTriggerModeSchema,
  reviewVerdictSchema,
} from "./concierge";

describe("reviewTriggerModeSchema", () => {
  it("accepts the two on-modes", () => {
    expect(reviewTriggerModeSchema.parse("user_prompted")).toBe("user_prompted");
    expect(reviewTriggerModeSchema.parse("auto_silent")).toBe("auto_silent");
  });

  it("rejects an unknown mode (e.g. 'off', which is the absence of a trigger, not a mode)", () => {
    expect(reviewTriggerModeSchema.safeParse("off").success).toBe(false);
    expect(reviewTriggerModeSchema.safeParse("bogus").success).toBe(false);
  });
});

describe("reviewConfigUpdateSchema", () => {
  const valid = {
    enabled: true,
    triggerMode: "user_prompted" as const,
    confidenceThreshold: 0.5,
    slaHours: 24,
    volumeCapPerDay: 50,
  };

  it("accepts a fully-specified config", () => {
    expect(reviewConfigUpdateSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a confidence threshold outside 0–1", () => {
    expect(reviewConfigUpdateSchema.safeParse({ ...valid, confidenceThreshold: -0.1 }).success).toBe(
      false,
    );
    expect(reviewConfigUpdateSchema.safeParse({ ...valid, confidenceThreshold: 1.5 }).success).toBe(
      false,
    );
  });

  it("rejects a non-positive or over-cap SLA", () => {
    expect(reviewConfigUpdateSchema.safeParse({ ...valid, slaHours: 0 }).success).toBe(false);
    expect(reviewConfigUpdateSchema.safeParse({ ...valid, slaHours: 721 }).success).toBe(false);
  });

  it("rejects a non-integer SLA / volume cap", () => {
    expect(reviewConfigUpdateSchema.safeParse({ ...valid, slaHours: 1.5 }).success).toBe(false);
    expect(reviewConfigUpdateSchema.safeParse({ ...valid, volumeCapPerDay: 2.5 }).success).toBe(false);
  });

  it("rejects a non-positive or over-cap volume cap", () => {
    expect(reviewConfigUpdateSchema.safeParse({ ...valid, volumeCapPerDay: 0 }).success).toBe(false);
    expect(reviewConfigUpdateSchema.safeParse({ ...valid, volumeCapPerDay: 100_001 }).success).toBe(
      false,
    );
  });

  it("requires every field (no partial save — the whole config is posted)", () => {
    expect(reviewConfigUpdateSchema.safeParse({ enabled: true }).success).toBe(false);
  });
});

describe("reviewVerdictSchema", () => {
  it("accepts the three verdicts", () => {
    expect(reviewVerdictSchema.parse("good")).toBe("good");
    expect(reviewVerdictSchema.parse("bad")).toBe("bad");
    expect(reviewVerdictSchema.parse("great")).toBe("great");
  });

  it("rejects an unknown verdict", () => {
    expect(reviewVerdictSchema.safeParse("ok").success).toBe(false);
  });
});

describe("conciergeQueueListQuerySchema", () => {
  it("defaults limit to 50 and offset to 0", () => {
    expect(conciergeQueueListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("coerces query-string numbers and keeps a valid status filter", () => {
    expect(conciergeQueueListQuerySchema.parse({ status: "requested", limit: "10", offset: "20" })).toEqual({
      status: "requested",
      limit: 10,
      offset: 20,
    });
  });

  it("rejects a non-positive / over-cap limit", () => {
    expect(conciergeQueueListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(conciergeQueueListQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it("rejects a negative offset and an unknown status", () => {
    expect(conciergeQueueListQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(conciergeQueueListQuerySchema.safeParse({ status: "bogus" }).success).toBe(false);
  });
});

describe("reviewResponseCreateSchema", () => {
  it("defaults revisedAnswer and notes to null (verdict-only response)", () => {
    expect(reviewResponseCreateSchema.parse({ verdict: "good" })).toEqual({
      verdict: "good",
      revisedAnswer: null,
      notes: null,
    });
  });

  it("trims a revision + notes and keeps them", () => {
    expect(
      reviewResponseCreateSchema.parse({ verdict: "great", revisedAnswer: "  better  ", notes: "  ok  " }),
    ).toEqual({ verdict: "great", revisedAnswer: "better", notes: "ok" });
  });

  it("requires a verdict and rejects an empty revision", () => {
    expect(reviewResponseCreateSchema.safeParse({}).success).toBe(false);
    expect(reviewResponseCreateSchema.safeParse({ verdict: "good", revisedAnswer: "   " }).success).toBe(
      false,
    );
  });
});

describe("reviewEscalateSchema", () => {
  it("defaults consultationTypeKey and notes to null", () => {
    expect(reviewEscalateSchema.parse({})).toEqual({ consultationTypeKey: null, notes: null });
  });

  it("trims and keeps a supplied type key + notes", () => {
    expect(
      reviewEscalateSchema.parse({ consultationTypeKey: "  deep-dive  ", notes: "  needs depth  " }),
    ).toEqual({ consultationTypeKey: "deep-dive", notes: "needs depth" });
  });

  it("rejects an empty type key", () => {
    expect(reviewEscalateSchema.safeParse({ consultationTypeKey: "   " }).success).toBe(false);
  });
});
