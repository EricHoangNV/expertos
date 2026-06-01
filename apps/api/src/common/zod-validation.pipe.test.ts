import { BadRequestException } from "@nestjs/common";
import { ZodValidationPipe } from "./zod-validation.pipe";

/** Minimal stand-ins for a Zod schema's `safeParse` — `apps/api` does not depend on zod. */
const okSchema = {
  safeParse: (value: unknown) => ({ success: true as const, data: { ...(value as object), defaulted: 1 } }),
};
const failSchema = {
  safeParse: () => ({
    success: false as const,
    error: { issues: [{ path: ["name", 0], message: "Required" }] },
  }),
};

describe("ZodValidationPipe", () => {
  it("returns the parsed (transformed) value on success", () => {
    const pipe = new ZodValidationPipe(okSchema);
    expect(pipe.transform({ name: "hi" })).toEqual({ name: "hi", defaulted: 1 });
  });

  it("throws a 400 with joined field-level issue paths on failure", () => {
    const pipe = new ZodValidationPipe(failSchema);
    try {
      pipe.transform({});
      throw new Error("expected the pipe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as { message: unknown };
      expect(response.message).toEqual([{ path: "name.0", message: "Required" }]);
    }
  });
});
