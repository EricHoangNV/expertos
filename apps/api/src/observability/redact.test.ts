import { redact } from "./redact";

describe("redact", () => {
  it("passes primitives through unchanged", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it("replaces sensitive keys (case-insensitive, substring match)", () => {
    expect(
      redact({
        email: "a@b.com",
        Authorization: "Bearer x",
        api_key: "k",
        userId: "keep",
      }),
    ).toEqual({
      email: "[redacted]",
      Authorization: "[redacted]",
      api_key: "[redacted]",
      userId: "keep",
    });
  });

  it("redacts recursively through nested objects and arrays", () => {
    expect(
      redact({ a: { password: "p", ok: 1 }, list: [{ token: "t" }] }),
    ).toEqual({ a: { password: "[redacted]", ok: 1 }, list: [{ token: "[redacted]" }] });
  });

  it("breaks cycles", () => {
    const obj: Record<string, unknown> = { ok: 1 };
    obj.self = obj;
    expect(redact(obj)).toEqual({ ok: 1, self: "[circular]" });
  });
});
