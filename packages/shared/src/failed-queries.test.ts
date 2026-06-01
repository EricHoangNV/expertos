import { failedQueryListQuerySchema } from "./failed-queries";

describe("failedQueryListQuerySchema", () => {
  it("defaults to the first page of 50", () => {
    expect(failedQueryListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("coerces query-string limit and offset values", () => {
    expect(failedQueryListQuerySchema.parse({ limit: "25", offset: "100" })).toEqual({
      limit: 25,
      offset: 100,
    });
  });

  it("rejects a non-positive or over-cap limit", () => {
    expect(failedQueryListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(failedQueryListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects a negative offset", () => {
    expect(failedQueryListQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("rejects non-integer paging values", () => {
    expect(failedQueryListQuerySchema.safeParse({ limit: 5.5 }).success).toBe(false);
    expect(failedQueryListQuerySchema.safeParse({ offset: 2.5 }).success).toBe(false);
  });
});
