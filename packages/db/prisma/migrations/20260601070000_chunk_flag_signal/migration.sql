-- Concierge "Bad"-verdict knowledge-gap signal (M9.4, PRD §"Concierge Mode" → reviewer flywheel).
-- When a reviewer rates a concierge answer "bad", the source chunks that grounded the answer are
-- flagged so the failed-query / knowledge-quality inspector (M10.3) can surface weak material for
-- re-authoring. A counter + last-flagged timestamp on the chunk (additive, no backfill needed).
ALTER TABLE "chunks" ADD COLUMN "flag_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "chunks" ADD COLUMN "last_flagged_at" TIMESTAMP(3);
