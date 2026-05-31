/**
 * Row-Level Security request context.
 *
 * The database enforces tenant/user isolation via policies that read three GUCs
 * (`app.current_tenant_id`, `app.current_user_id`, `app.is_admin`). The API sets
 * them once per transaction with {@link applyRlsContext} so every query inside the
 * transaction is automatically scoped — the isolation guarantee is structural, not
 * dependent on each query remembering to add a `WHERE tenant_id = ...` clause.
 */

/** The well-known GLOBAL tenant. Consumer-MVP data lives here; B2B tenants get their own. */
export const GLOBAL_TENANT_ID = "00000000-0000-0000-0000-000000000000";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RlsContext {
  /** The acting tenant. Required. */
  tenantId: string;
  /** The acting user. Omit for tenant-wide (no user) operations. */
  userId?: string;
  /** Bypass tenant/user scoping (admins + trusted background jobs only). */
  isAdmin?: boolean;
}

/**
 * Minimal executor shape — matches Prisma's `$executeRawUnsafe`. Declared locally so
 * this module stays free of a hard dependency on the generated client (keeps it pure
 * and trivially unit-testable with a fake executor).
 */
export interface SqlExecutor {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
}

function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`applyRlsContext: ${field} is not a valid UUID`);
  }
}

/**
 * Applies an {@link RlsContext} to the current transaction using `set_config(..., true)`
 * (transaction-local). Values are passed as bound parameters — never string-interpolated —
 * and UUIDs are validated as defense in depth (directive §1: sanitize/validate inputs).
 *
 * MUST run inside an interactive transaction (`prisma.$transaction(async (tx) => ...)`),
 * otherwise the `is_local = true` setting is discarded immediately and no scoping applies.
 */
export async function applyRlsContext(
  tx: SqlExecutor,
  ctx: RlsContext,
): Promise<void> {
  assertUuid(ctx.tenantId, "tenantId");
  await tx.$executeRawUnsafe(
    "SELECT set_config('app.current_tenant_id', $1, true)",
    ctx.tenantId,
  );

  if (ctx.userId !== undefined) {
    assertUuid(ctx.userId, "userId");
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.current_user_id', $1, true)",
      ctx.userId,
    );
  }

  await tx.$executeRawUnsafe(
    "SELECT set_config('app.is_admin', $1, true)",
    ctx.isAdmin ? "true" : "false",
  );
}
