import { entitlementUpdateSchema, usageWindowSchema } from "./entitlements";

describe("usageWindowSchema", () => {
  it.each(["day", "week", "month"])("accepts %s", (window) => {
    expect(usageWindowSchema.parse(window)).toBe(window);
  });

  it("rejects an unknown window", () => {
    expect(usageWindowSchema.safeParse("year").success).toBe(false);
  });
});

describe("entitlementUpdateSchema", () => {
  it("defaults the metered fields to null when only `enabled` is given", () => {
    expect(entitlementUpdateSchema.parse({ enabled: true })).toEqual({
      enabled: true,
      limit: null,
      softLimit: null,
      window: null,
    });
  });

  it("keeps a fully-specified metered cell", () => {
    expect(
      entitlementUpdateSchema.parse({
        enabled: true,
        limit: 200,
        softLimit: 150,
        window: "month",
      }),
    ).toEqual({ enabled: true, limit: 200, softLimit: 150, window: "month" });
  });

  it("accepts an explicit null limit (no hard cap)", () => {
    const parsed = entitlementUpdateSchema.parse({
      enabled: true,
      limit: null,
      softLimit: 500,
      window: "month",
    });
    expect(parsed.limit).toBeNull();
    expect(parsed.softLimit).toBe(500);
  });

  it("requires `enabled`", () => {
    expect(entitlementUpdateSchema.safeParse({ limit: 10, window: "day" }).success).toBe(false);
  });

  it("rejects a negative limit", () => {
    expect(
      entitlementUpdateSchema.safeParse({ enabled: true, limit: -1, window: "day" }).success,
    ).toBe(false);
  });

  it("rejects a non-integer limit", () => {
    expect(
      entitlementUpdateSchema.safeParse({ enabled: true, limit: 1.5, window: "day" }).success,
    ).toBe(false);
  });

  it("rejects a limit over the guard cap", () => {
    expect(
      entitlementUpdateSchema.safeParse({ enabled: true, limit: 1_000_001, window: "day" }).success,
    ).toBe(false);
  });

  it("rejects an unknown window", () => {
    expect(
      entitlementUpdateSchema.safeParse({ enabled: true, window: "year" }).success,
    ).toBe(false);
  });
});
