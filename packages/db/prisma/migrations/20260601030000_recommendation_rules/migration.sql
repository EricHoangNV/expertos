-- M7.1: admin-configurable consultation-recommendation rules (one row per trigger).
-- Reference/config data like `plan_entitlements` — NO row-level security (global config, admin-only
-- writes via the M8.3 portal). app_user reads/writes it through the ALTER DEFAULT PRIVILEGES grant
-- set in the RLS migration; the explicit GRANT below is belt-and-suspenders + self-documenting.
CREATE TABLE "recommendation_rules" (
    "id" UUID NOT NULL,
    "trigger" "recommendation_trigger" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "threshold" INTEGER,
    "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "consultation_type_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recommendation_rules_trigger_key" ON "recommendation_rules"("trigger");

GRANT SELECT, INSERT, UPDATE, DELETE ON "recommendation_rules" TO app_user;
