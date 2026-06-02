-- M14: invite-only admin-portal whitelist (`allowed_emails`).
--
-- A pre-authorized email + the role it is granted on admin-portal sign-in (M14.2.1). Tenant-scoped
-- (GLOBAL today), so it joins the `tenant_only` RLS family alongside `users` / `admin_audit_logs`:
-- the policy lets the admin RLS context (the `is_admin` GUC) read/write across tenants, which is how
-- both the sign-in check (AdminSessionService, run under the system/admin context like resolveUser)
-- and the admin CRUD (AccessControlService, `@Roles("admin")`) reach it.
--
-- NOTE: the Prisma-generated diff also wanted to DROP the four pgvector indexes
-- (chunks/semantic_cache/upload_chunks/voice_examples `_embedding_idx`); those are created in raw SQL
-- the Prisma schema doesn't model, so the diff is spurious drift — the DROP statements are removed
-- here so this migration never drops the vector indexes.

-- CreateTable
CREATE TABLE "allowed_emails" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "email" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "allowed_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allowed_emails_tenant_id_idx" ON "allowed_emails"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "allowed_emails_tenant_id_email_key" ON "allowed_emails"("tenant_id", "email");

-- AddForeignKey
ALTER TABLE "allowed_emails" ADD CONSTRAINT "allowed_emails_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_emails" ADD CONSTRAINT "allowed_emails_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security: tenant_only family (same policy shape as `users` / `admin_audit_logs`).
-- app_user is non-superuser + the table is FORCE RLS, so the policy is the real boundary; the
-- `is_admin` GUC is what lets the admin sign-in check + CRUD operate across tenants.
ALTER TABLE "allowed_emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allowed_emails" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "allowed_emails" FOR ALL
  USING (app.is_admin() OR tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_admin() OR tenant_id = app.current_tenant_id());

-- app_user already inherits CRUD via ALTER DEFAULT PRIVILEGES (RLS migration); the explicit GRANT is
-- belt-and-suspenders + self-documenting, matching the `review_configs` precedent.
GRANT SELECT, INSERT, UPDATE, DELETE ON "allowed_emails" TO app_user;
