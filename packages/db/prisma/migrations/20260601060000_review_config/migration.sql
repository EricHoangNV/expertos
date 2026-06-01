-- M9.1: admin-configurable concierge (human-review) trigger config — a global singleton row.
-- Reference/config data like `recommendation_rules`: NO row-level security (global config, admin-only
-- writes via the M9.1 portal). app_user reads/writes it through the ALTER DEFAULT PRIVILEGES grant
-- set in the RLS migration; the explicit GRANT below is belt-and-suspenders + self-documenting.
-- The `review_trigger_mode` enum already exists (created with `human_review_requests`).
CREATE TABLE "review_configs" (
    "id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trigger_mode" "review_trigger_mode" NOT NULL DEFAULT 'user_prompted',
    "confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sla_hours" INTEGER NOT NULL DEFAULT 24,
    "volume_cap_per_day" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_configs_pkey" PRIMARY KEY ("id")
);

GRANT SELECT, INSERT, UPDATE, DELETE ON "review_configs" TO app_user;
