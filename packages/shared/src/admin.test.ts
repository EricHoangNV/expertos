import {
  adminAuditListQuerySchema,
  adminUserListQuerySchema,
  adminUserRoleUpdateSchema,
  fairUseFlagCreateSchema,
  fairUseFlagUpdateSchema,
  adminExpertListQuerySchema,
  adminExpertCreateSchema,
  adminExpertUpdateSchema,
  adminExpertActiveUpdateSchema,
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

describe("adminExpertListQuerySchema", () => {
  it("defaults pagination and omits the optional filters", () => {
    expect(adminExpertListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("coerces the query-string active flag and trims the search term", () => {
    expect(adminExpertListQuerySchema.parse({ active: "false", search: "  lan  " })).toEqual({
      limit: 50,
      offset: 0,
      active: false,
      search: "lan",
    });
    expect(adminExpertListQuerySchema.parse({ active: "true" }).active).toBe(true);
  });

  it("accepts a real boolean active flag (in-process callers)", () => {
    expect(adminExpertListQuerySchema.parse({ active: true }).active).toBe(true);
  });

  it("rejects a non-boolean-ish active value", () => {
    expect(adminExpertListQuerySchema.safeParse({ active: "yes" }).success).toBe(false);
  });
});

describe("adminExpertCreateSchema", () => {
  it("trims/normalizes fields and omits absent optionals", () => {
    expect(
      adminExpertCreateSchema.parse({ slug: "dr-lan", displayName: "  Dr. Lan  " }),
    ).toEqual({ slug: "dr-lan", displayName: "Dr. Lan" });
  });

  it("keeps a linked operator uuid and the optional title/bio", () => {
    const userId = "44444444-4444-4444-4444-444444444444";
    expect(
      adminExpertCreateSchema.parse({
        slug: "dr-lan",
        displayName: "Dr. Lan",
        title: "Cardiologist",
        bio: "Bio",
        userId,
      }),
    ).toEqual({ slug: "dr-lan", displayName: "Dr. Lan", title: "Cardiologist", bio: "Bio", userId });
  });

  it("rejects a non-url-safe slug, an empty name, and a non-uuid operator", () => {
    expect(adminExpertCreateSchema.safeParse({ slug: "Dr Lan", displayName: "x" }).success).toBe(
      false,
    );
    expect(adminExpertCreateSchema.safeParse({ slug: "dr-lan", displayName: "  " }).success).toBe(
      false,
    );
    expect(
      adminExpertCreateSchema.safeParse({ slug: "dr-lan", displayName: "x", userId: "nope" })
        .success,
    ).toBe(false);
  });
});

describe("adminExpertUpdateSchema", () => {
  it("accepts a partial patch and a null userId (unlink)", () => {
    expect(adminExpertUpdateSchema.parse({ title: "New title" })).toEqual({ title: "New title" });
    expect(adminExpertUpdateSchema.parse({ userId: null })).toEqual({ userId: null });
  });

  it("accepts an empty string to clear title/bio", () => {
    expect(adminExpertUpdateSchema.parse({ bio: "" })).toEqual({ bio: "" });
  });

  it("rejects an empty patch", () => {
    expect(adminExpertUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("adminExpertActiveUpdateSchema", () => {
  it("accepts a boolean", () => {
    expect(adminExpertActiveUpdateSchema.parse({ active: false })).toEqual({ active: false });
  });

  it("rejects a missing / non-boolean active", () => {
    expect(adminExpertActiveUpdateSchema.safeParse({}).success).toBe(false);
    expect(adminExpertActiveUpdateSchema.safeParse({ active: "true" }).success).toBe(false);
  });
});
