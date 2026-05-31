import { ROLES, roleSchema, satisfiesRole } from "./roles";

describe("roles", () => {
  it("exposes the three RBAC roles", () => {
    expect(ROLES).toEqual(["user", "expert", "admin"]);
  });

  it("parses valid roles and rejects invalid ones", () => {
    expect(roleSchema.parse("admin")).toBe("admin");
    expect(() => roleSchema.parse("superuser")).toThrow();
  });

  it("grants access when privilege is equal or higher", () => {
    expect(satisfiesRole("admin", "user")).toBe(true);
    expect(satisfiesRole("expert", "expert")).toBe(true);
    expect(satisfiesRole("user", "user")).toBe(true);
  });

  it("denies access when privilege is lower", () => {
    expect(satisfiesRole("user", "expert")).toBe(false);
    expect(satisfiesRole("expert", "admin")).toBe(false);
  });
});
