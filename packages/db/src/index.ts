export { getDatabaseUrl } from "./config";
export { prisma } from "./client";
export { applyRlsContext, GLOBAL_TENANT_ID } from "./rls";
export type { RlsContext, SqlExecutor } from "./rls";
// Re-export Prisma's generated client + model types/enums as the package's public API.
export * from "../generated/client";
