-- Concierge async delivery — "refined update" marker (M9.3, PRD §"Concierge Mode" → async delivery).
-- When a human reviewer edits a concierge-flagged answer, the refined answer is delivered back into
-- the conversation as a new assistant message; this column points it at the original answer it
-- refines (a soft provenance link, no FK — the original cascades with the conversation). It also
-- carries the OD#5 visual-indicator signal ("AI-reviewed/edited content") to the read path.
ALTER TABLE "messages" ADD COLUMN "refined_from_message_id" UUID;
