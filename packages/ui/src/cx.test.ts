import { cx } from "./cx";

describe("cx", () => {
  it("joins truthy fragments", () => {
    expect(cx("btn", "btn-primary")).toBe("btn btn-primary");
  });

  it("drops falsy fragments", () => {
    expect(cx("btn", false, null, undefined, "lg")).toBe("btn lg");
  });

  it("returns an empty string when nothing is truthy", () => {
    expect(cx(false, null, undefined)).toBe("");
  });
});
