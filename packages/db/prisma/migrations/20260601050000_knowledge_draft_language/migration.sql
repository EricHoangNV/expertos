-- M8.2 conversation-to-knowledge pipeline: a draft carries the language of its source
-- conversation so that, when published, the resulting knowledge is ingested + retrieval-
-- filtered under the correct language (Vietnamese drafts must not publish as English).
ALTER TABLE "knowledge_drafts" ADD COLUMN "language" "language" NOT NULL DEFAULT 'en';
