import { funnelAnalyticsQuerySchema, usageAnalyticsQuerySchema } from "./analytics";

describe("usageAnalyticsQuerySchema", () => {
  it("defaults to a trailing 30-day window", () => {
    expect(usageAnalyticsQuerySchema.parse({})).toEqual({ days: 30 });
  });

  it("coerces a query-string days value", () => {
    expect(usageAnalyticsQuerySchema.parse({ days: "7" })).toEqual({ days: 7 });
  });

  it("rejects a non-positive or over-cap window", () => {
    expect(usageAnalyticsQuerySchema.safeParse({ days: 0 }).success).toBe(false);
    expect(usageAnalyticsQuerySchema.safeParse({ days: 366 }).success).toBe(false);
  });

  it("rejects a non-integer window", () => {
    expect(usageAnalyticsQuerySchema.safeParse({ days: 1.5 }).success).toBe(false);
  });
});

describe("funnelAnalyticsQuerySchema", () => {
  it("defaults to a trailing 30-day window", () => {
    expect(funnelAnalyticsQuerySchema.parse({})).toEqual({ days: 30 });
  });

  it("coerces a query-string days value", () => {
    expect(funnelAnalyticsQuerySchema.parse({ days: "90" })).toEqual({ days: 90 });
  });

  it("rejects a non-positive or over-cap window", () => {
    expect(funnelAnalyticsQuerySchema.safeParse({ days: 0 }).success).toBe(false);
    expect(funnelAnalyticsQuerySchema.safeParse({ days: 366 }).success).toBe(false);
  });

  it("rejects a non-integer window", () => {
    expect(funnelAnalyticsQuerySchema.safeParse({ days: 2.5 }).success).toBe(false);
  });
});
