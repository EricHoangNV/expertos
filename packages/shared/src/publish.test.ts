import { PUBLISH_STATUSES, publishStatusSchema } from "./publish";

describe("publishStatusSchema", () => {
  it("accepts every lifecycle status", () => {
    for (const status of PUBLISH_STATUSES) {
      expect(publishStatusSchema.parse(status)).toBe(status);
    }
  });

  it("rejects an unknown status", () => {
    expect(() => publishStatusSchema.parse("retired")).toThrow();
  });
});
