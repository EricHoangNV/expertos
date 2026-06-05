-- M17.1: runtime answer-tuning settings — a global singleton row (LLM temperature, default chat
-- model, retrieval score floor). Reference/config data like `review_configs`/`recommendation_rules`:
-- NO row-level security (global config, admin-only writes via the M17 Settings page). app_user
-- reads/writes it through the ALTER DEFAULT PRIVILEGES grant set in the RLS migration; the explicit
-- GRANT below is belt-and-suspenders + self-documenting.
CREATE TABLE "app_settings" (
    "id" UUID NOT NULL,
    "llm_temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "default_chat_model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "retrieval_score_floor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

GRANT SELECT, INSERT, UPDATE, DELETE ON "app_settings" TO app_user;
