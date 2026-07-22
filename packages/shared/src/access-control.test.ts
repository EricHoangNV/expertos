import {
  allowedEmailRoleSchema,
  portalRoleSchema,
  allowedEmailCreateSchema,
  allowedEmailUpdateSchema,
} from "./access-control";

describe("allowedEmailRoleSchema", () => {
  it("accepts all three grantable roles (user = consumer-beta invite)", () => {
    expect(allowedEmailRoleSchema.parse("user")).toBe("user");
    expect(allowedEmailRoleSchema.parse("expert")).toBe("expert");
    expect(allowedEmailRoleSchema.parse("admin")).toBe("admin");
  });

  it("rejects unknown values", () => {
    expect(allowedEmailRoleSchema.safeParse("owner").success).toBe(false);
  });
});

describe("portalRoleSchema", () => {
  it("accepts the two portal roles", () => {
    expect(portalRoleSchema.parse("expert")).toBe("expert");
    expect(portalRoleSchema.parse("admin")).toBe("admin");
  });

  it("rejects the base user role — a beta invite never authorizes the portal", () => {
    expect(portalRoleSchema.safeParse("user").success).toBe(false);
  });
});

describe("allowedEmailCreateSchema", () => {
  it("trims and lowercases the email", () => {
    expect(
      allowedEmailCreateSchema.parse({ email: "  Expert@Example.COM ", role: "expert" }),
    ).toEqual({ email: "expert@example.com", role: "expert" });
  });

  it("accepts a user-role beta invite", () => {
    expect(allowedEmailCreateSchema.parse({ email: "beta@example.com", role: "user" })).toEqual({
      email: "beta@example.com",
      role: "user",
    });
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

  it("rejects an unknown role", () => {
    expect(
      allowedEmailCreateSchema.safeParse({ email: "a@b.com", role: "owner" }).success,
    ).toBe(false);
  });
});

describe("allowedEmailUpdateSchema", () => {
  it("accepts any grantable role", () => {
    expect(allowedEmailUpdateSchema.parse({ role: "admin" })).toEqual({ role: "admin" });
    expect(allowedEmailUpdateSchema.parse({ role: "user" })).toEqual({ role: "user" });
  });

  it("rejects an unknown role", () => {
    expect(allowedEmailUpdateSchema.safeParse({ role: "owner" }).success).toBe(false);
  });
});
