import { recommendationRespondSchema } from "./consultation";

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
