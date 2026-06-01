import { revenueReportQuerySchema } from "./revenue";

describe("revenueReportQuerySchema", () => {
  it("defaults to a trailing 12-month window", () => {
    expect(revenueReportQuerySchema.parse({})).toEqual({ months: 12 });
  });

  it("coerces a query-string months value", () => {
    expect(revenueReportQuerySchema.parse({ months: "6" })).toEqual({ months: 6 });
  });

  it("rejects a non-positive or over-cap window", () => {
    expect(revenueReportQuerySchema.safeParse({ months: 0 }).success).toBe(false);
    expect(revenueReportQuerySchema.safeParse({ months: 37 }).success).toBe(false);
  });

  it("rejects a non-integer window", () => {
    expect(revenueReportQuerySchema.safeParse({ months: 1.5 }).success).toBe(false);
  });
});
