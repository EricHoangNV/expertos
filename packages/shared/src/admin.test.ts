import {
  adminAuditListQuerySchema,
  adminUserListQuerySchema,
  adminUserRoleUpdateSchema,
  fairUseFlagCreateSchema,
  fairUseFlagUpdateSchema,
} from "./admin";

describe("adminAuditListQuerySchema", () => {
  it("defaults limit 50 / offset 0 with no filters", () => {
    expect(adminAuditListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("coerces query-string pagination and trims filters", () => {
    expect(
      adminAuditListQuerySchema.parse({
        limit: "10",
        offset: "5",
        action: " user.role_changed ",
        targetType: " user ",
      }),
    ).toEqual({ limit: 10, offset: 5, action: "user.role_changed", targetType: "user" });
  });

  it("rejects a non-positive / over-cap limit and a negative offset", () => {
    expect(adminAuditListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(adminAuditListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(adminAuditListQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe("adminUserListQuerySchema", () => {
  it("defaults pagination and omits the optional filters", () => {
    expect(adminUserListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("keeps a valid role and trims the search term", () => {
    expect(adminUserListQuerySchema.parse({ role: "expert", search: "  ali  " })).toEqual({
      limit: 50,
      offset: 0,
      role: "expert",
      search: "ali",
    });
  });

  it("rejects an unknown role", () => {
    expect(adminUserListQuerySchema.safeParse({ role: "superuser" }).success).toBe(false);
  });
});

describe("adminUserRoleUpdateSchema", () => {
  it("accepts each known role", () => {
    for (const role of ["user", "expert", "admin"] as const) {
      expect(adminUserRoleUpdateSchema.parse({ role }).role).toBe(role);
    }
  });

  it("rejects an unknown / missing role", () => {
    expect(adminUserRoleUpdateSchema.safeParse({ role: "owner" }).success).toBe(false);
    expect(adminUserRoleUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("fairUseFlagCreateSchema", () => {
  it("trims a reason", () => {
    expect(fairUseFlagCreateSchema.parse({ reason: "  account sharing  " })).toEqual({
      reason: "account sharing",
    });
  });

  it("rejects an empty or over-long reason", () => {
    expect(fairUseFlagCreateSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(fairUseFlagCreateSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("fairUseFlagUpdateSchema", () => {
  it("accepts each known status", () => {
    for (const status of ["open", "reviewed", "throttled", "cleared"] as const) {
      expect(fairUseFlagUpdateSchema.parse({ status }).status).toBe(status);
    }
  });

  it("rejects an unknown status", () => {
    expect(fairUseFlagUpdateSchema.safeParse({ status: "banned" }).success).toBe(false);
  });
});
