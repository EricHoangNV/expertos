import { expertAnswerListQuerySchema } from "./expert";

describe("expertAnswerListQuerySchema", () => {
  it("defaults to the first page of 50", () => {
    expect(expertAnswerListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("coerces query-string limit and offset values", () => {
    expect(expertAnswerListQuerySchema.parse({ limit: "25", offset: "100" })).toEqual({
      limit: 25,
      offset: 100,
    });
  });

  it("rejects a non-positive or over-cap limit", () => {
    expect(expertAnswerListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(expertAnswerListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects a negative offset", () => {
    expect(expertAnswerListQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("rejects non-integer paging values", () => {
    expect(expertAnswerListQuerySchema.safeParse({ limit: 5.5 }).success).toBe(false);
    expect(expertAnswerListQuerySchema.safeParse({ offset: 2.5 }).success).toBe(false);
  });
});
