import { reviewConfigUpdateSchema, reviewTriggerModeSchema } from "./concierge";

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
