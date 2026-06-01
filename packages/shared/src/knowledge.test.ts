import { knowledgeListQuerySchema } from "./knowledge";

describe("knowledgeListQuerySchema", () => {
  it("defaults limit to 50 when omitted", () => {
    const parsed = knowledgeListQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.status).toBeUndefined();
    expect(parsed.scope).toBeUndefined();
  });

  it("coerces a numeric-string limit and keeps status/scope filters", () => {
    const parsed = knowledgeListQuerySchema.parse({
      status: "expert_review",
      scope: "global_expert",
      limit: "25",
    });
    expect(parsed).toEqual({
      status: "expert_review",
      scope: "global_expert",
      limit: 25,
    });
  });

  it("rejects a limit above the cap", () => {
    expect(() => knowledgeListQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() => knowledgeListQuerySchema.parse({ status: "retired" })).toThrow();
  });
});
