import {
  allowedEmailRoleSchema,
  allowedEmailCreateSchema,
  allowedEmailUpdateSchema,
} from "./access-control";

describe("allowedEmailRoleSchema", () => {
  it("accepts the two portal roles", () => {
    expect(allowedEmailRoleSchema.parse("expert")).toBe("expert");
    expect(allowedEmailRoleSchema.parse("admin")).toBe("admin");
  });

  it("rejects the base user role and unknown values", () => {
    expect(allowedEmailRoleSchema.safeParse("user").success).toBe(false);
    expect(allowedEmailRoleSchema.safeParse("owner").success).toBe(false);
  });
});

describe("allowedEmailCreateSchema", () => {
  it("trims and lowercases the email", () => {
    expect(
      allowedEmailCreateSchema.parse({ email: "  Expert@Example.COM ", role: "expert" }),
    ).toEqual({ email: "expert@example.com", role: "expert" });
  });

  it("rejects a malformed email", () => {
    expect(allowedEmailCreateSchema.safeParse({ email: "not-an-email", role: "admin" }).success).toBe(
      false,
    );
  });

  it("rejects an over-length email", () => {
    const long = `${"a".repeat(320)}@example.com`;
    expect(allowedEmailCreateSchema.safeParse({ email: long, role: "admin" }).success).toBe(false);
  });

  it("rejects a non-portal role", () => {
    expect(
      allowedEmailCreateSchema.safeParse({ email: "a@b.com", role: "user" }).success,
    ).toBe(false);
  });
});

describe("allowedEmailUpdateSchema", () => {
  it("accepts a portal role", () => {
    expect(allowedEmailUpdateSchema.parse({ role: "admin" })).toEqual({ role: "admin" });
  });

  it("rejects an unknown role", () => {
    expect(allowedEmailUpdateSchema.safeParse({ role: "user" }).success).toBe(false);
  });
});
