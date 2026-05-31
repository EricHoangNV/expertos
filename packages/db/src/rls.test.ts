import { applyRlsContext, GLOBAL_TENANT_ID, type RlsContext } from "./rls";

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

/** Records every ($1) value set_config was asked to apply, keyed by GUC name. */
function makeExecutor() {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const settings: Record<string, unknown> = {};
  return {
    calls,
    settings,
    async $executeRawUnsafe(query: string, ...values: unknown[]) {
      calls.push({ query, values });
      const match = query.match(/set_config\('([^']+)'/);
      if (match) settings[match[1]] = values[0];
      return 1;
    },
  };
}

describe("applyRlsContext", () => {
  it("sets tenant, user, and is_admin=false for a normal user context", async () => {
    const exec = makeExecutor();
    const ctx: RlsContext = { tenantId: TENANT, userId: USER };
    await applyRlsContext(exec, ctx);

    expect(exec.settings["app.current_tenant_id"]).toBe(TENANT);
    expect(exec.settings["app.current_user_id"]).toBe(USER);
    expect(exec.settings["app.is_admin"]).toBe("false");
    // every value is bound as a parameter, never interpolated into the SQL text
    for (const call of exec.calls) {
      expect(call.query).not.toContain(TENANT);
      expect(call.values.length).toBe(1);
    }
  });

  it("omits the user GUC when no userId is given", async () => {
    const exec = makeExecutor();
    await applyRlsContext(exec, { tenantId: GLOBAL_TENANT_ID });

    expect(exec.settings["app.current_tenant_id"]).toBe(GLOBAL_TENANT_ID);
    expect("app.current_user_id" in exec.settings).toBe(false);
    expect(exec.settings["app.is_admin"]).toBe("false");
  });

  it("sets is_admin=true when the context is admin", async () => {
    const exec = makeExecutor();
    await applyRlsContext(exec, { tenantId: TENANT, isAdmin: true });
    expect(exec.settings["app.is_admin"]).toBe("true");
  });

  it("rejects a non-UUID tenantId before issuing any query", async () => {
    const exec = makeExecutor();
    await expect(
      applyRlsContext(exec, { tenantId: "'; DROP TABLE users; --" }),
    ).rejects.toThrow("tenantId is not a valid UUID");
    expect(exec.calls).toHaveLength(0);
  });

  it("rejects a non-UUID userId", async () => {
    const exec = makeExecutor();
    await expect(
      applyRlsContext(exec, { tenantId: TENANT, userId: "not-a-uuid" }),
    ).rejects.toThrow("userId is not a valid UUID");
  });
});
