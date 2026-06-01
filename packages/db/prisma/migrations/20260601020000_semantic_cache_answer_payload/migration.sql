-- M6.4: persistent answer cache backed by semantic_cache.
-- Store the resolved citations verbatim so a cache hit rebuilds the answer faithfully
-- (the existing uuid[] columns can't carry citation ordinal / content).
ALTER TABLE "semantic_cache" ADD COLUMN "citations" JSONB;

-- Exact-match lookup key for the persistent answer cache (within tenant, per model tier).
CREATE INDEX "semantic_cache_tenant_id_normalized_question_model_idx"
  ON "semantic_cache" ("tenant_id", "normalized_question", "model");
