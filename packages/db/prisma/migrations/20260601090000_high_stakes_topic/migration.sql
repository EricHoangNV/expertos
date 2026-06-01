-- High-stakes-topic signal (NT.4, PRD §"Non-Technical Requirements").
-- An answer that touches a financial/legal/medical/tax matter is flagged so the UI can surface the
-- disclaimer on the history read path (messages) and so the interaction is logged for monitoring
-- (usage_logs). Backfills to false for existing rows.
ALTER TABLE "messages" ADD COLUMN "high_stakes" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "usage_logs" ADD COLUMN "high_stakes" BOOLEAN NOT NULL DEFAULT false;
