-- Row-Level Security + pgvector index migration (P0.2).
--
-- Written now even though the MVP is single-tenant, so the isolation guarantee is
-- STRUCTURAL (enforced by Postgres) rather than application-only (PRD §"Data Model").
--
-- Enforcement model:
--   * Three GUCs carry request context, set per transaction with SET LOCAL / set_config:
--       app.current_tenant_id  (uuid)   — the acting tenant
--       app.current_user_id    (uuid)   — the acting user
--       app.is_admin           (bool)   — true to bypass tenant/user scoping (admin + trusted jobs)
--   * The application MUST connect as the non-superuser role `app_user`. Superusers and
--     the table owner bypass RLS; FORCE ROW LEVEL SECURITY closes the owner path, and
--     `app_user` (no BYPASSRLS) closes the rest. Migrations/seeds run as the owner/superuser.
--   * Policies are PERMISSIVE and OR-combined per command.

-- ───────────────────────── context helpers ─────────────────────────
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('app.is_admin', true), ''), 'false')::boolean
$$;

-- ───────────────────────── application role ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA app TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- ───────────────────────── RLS policies ─────────────────────────
DO $$
DECLARE
  t text;
  -- tenant_id only — scope by tenant (children of user data, knowledge metadata, config-ish)
  tenant_only text[] := ARRAY[
    'users','experts','voice_profiles','voice_examples',
    'messages','citations','review_responses','consultation_notes','upload_chunks',
    'knowledge_drafts','semantic_cache','admin_audit_logs'
  ];
  -- tenant_id + user_id — only the owning user (or admin) may see/write the row
  user_scoped text[] := ARRAY[
    'subscriptions','usage_counters','usage_logs','transactions',
    'conversations','saved_answers','answer_feedback','uploaded_files',
    'consultations','consultation_recommendations','human_review_requests',
    'data_deletion_requests','fair_use_flags'
  ];
  -- versioned knowledge — own tenant writes; own tenant + GLOBAL tenant reads
  knowledge text[] := ARRAY['documents','document_versions','chunks','topics'];
BEGIN
  FOREACH t IN ARRAY tenant_only LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I FOR ALL
        USING (app.is_admin() OR tenant_id = app.current_tenant_id())
        WITH CHECK (app.is_admin() OR tenant_id = app.current_tenant_id())
    $f$, t);
  END LOOP;

  FOREACH t IN ARRAY user_scoped LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_user_isolation ON %I FOR ALL
        USING (app.is_admin() OR (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id()))
        WITH CHECK (app.is_admin() OR (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id()))
    $f$, t);
  END LOOP;

  FOREACH t IN ARRAY knowledge LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_write ON %I FOR ALL
        USING (app.is_admin() OR tenant_id = app.current_tenant_id())
        WITH CHECK (app.is_admin() OR tenant_id = app.current_tenant_id())
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY global_read ON %I FOR SELECT
        USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid)
    $f$, t);
  END LOOP;
END $$;

-- document_topics is a pure join (no tenant_id) — scope it through its parent document.
ALTER TABLE "document_topics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_topics" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_topics" FOR ALL
  USING (
    app.is_admin() OR EXISTS (
      SELECT 1 FROM "documents" d
      WHERE d.id = document_id
        AND (d.tenant_id = app.current_tenant_id()
             OR d.tenant_id = '00000000-0000-0000-0000-000000000000'::uuid)
    )
  )
  WITH CHECK (
    app.is_admin() OR EXISTS (
      SELECT 1 FROM "documents" d
      WHERE d.id = document_id AND d.tenant_id = app.current_tenant_id()
    )
  );

-- ───────────────────────── pgvector indexes ─────────────────────────
-- HNSW + cosine distance — Prisma cannot index Unsupported("vector") columns.
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "upload_chunks_embedding_idx" ON "upload_chunks" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "voice_examples_embedding_idx" ON "voice_examples" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "semantic_cache_embedding_idx" ON "semantic_cache" USING hnsw ("embedding" vector_cosine_ops);
