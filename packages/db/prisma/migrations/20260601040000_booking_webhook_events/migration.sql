-- M7.3 (resolves Open Decision #10): TidyCal booking-webhook ledger.
-- Records every verified booking event (webhook-delivered or reconcile-recovered), mirroring the
-- M6.2 Stripe `transactions` idempotency discipline. Reference/system data like `recommendation_rules`
-- — NO row-level security (written only in the system RLS context of the @Public() webhook / admin
-- reconcile, read only by admins). app_user reads/writes it through the ALTER DEFAULT PRIVILEGES grant
-- set in the RLS migration; the explicit GRANT below is belt-and-suspenders + self-documenting.
CREATE TABLE "booking_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "booking_ref" TEXT,
    "email" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "consultation_id" UUID,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_webhook_events_pkey" PRIMARY KEY ("id")
);

-- Correlation lookups (event → existing consultation) hit booking_ref.
CREATE INDEX "booking_webhook_events_booking_ref_idx" ON "booking_webhook_events"("booking_ref");

-- Idempotency key: a redelivered webhook (or re-poll) with the same (provider, event_id) is a no-op.
CREATE UNIQUE INDEX "booking_webhook_events_provider_event_id_key" ON "booking_webhook_events"("provider", "event_id");

GRANT SELECT, INSERT, UPDATE, DELETE ON "booking_webhook_events" TO app_user;
