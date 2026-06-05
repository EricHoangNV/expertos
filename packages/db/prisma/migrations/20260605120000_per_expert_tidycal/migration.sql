-- M16: per-expert TidyCal calendar integration.
--
-- TidyCal has no native webhooks, so booking sync is per-expert *polling* of `GET /bookings` with
-- each expert's own API token. Each `experts` row therefore carries its (encrypted) API token, its
-- public booking link, and a poll watermark; each `consultations` row records which expert's calendar
-- the booking belongs to so the poll can correlate + attribute it.
--
-- `tidycal_api_token_enc` holds AES-256-GCM ciphertext (`iv:authTag:ciphertext`, see
-- `apps/api/src/common/secret-crypto.ts`); it is never decrypted outside the API and never returned
-- in plaintext over any route. No webhook-secret column exists — there are no inbound webhooks.
--
-- Both tables already enforce RLS (the `tenant_only` / `user_scoped` families from the RLS migration);
-- adding columns + an FK does not change their policies, so no policy/GRANT statements are needed here.

-- AlterTable: per-expert calendar credentials + poll watermark. `tidycal_api_token_last4` is a
-- non-sensitive UI hint so the portal can show "configured ••••1234" without ever decrypting the token.
ALTER TABLE "experts"
  ADD COLUMN "tidycal_api_token_enc" TEXT,
  ADD COLUMN "tidycal_api_token_last4" TEXT,
  ADD COLUMN "tidycal_link" TEXT,
  ADD COLUMN "tidycal_polled_at" TIMESTAMP(3);

-- AlterTable: attribute a consultation/booking to the expert whose calendar it came from.
ALTER TABLE "consultations"
  ADD COLUMN "expert_id" UUID;

-- CreateIndex: the per-expert poll correlates pending consultations within one expert's scope.
CREATE INDEX "consultations_tenant_id_expert_id_idx" ON "consultations"("tenant_id", "expert_id");

-- AddForeignKey: deleting an expert leaves their historical consultations intact (SetNull), matching
-- the `type_id` FK on the same table.
ALTER TABLE "consultations"
  ADD CONSTRAINT "consultations_expert_id_fkey"
  FOREIGN KEY ("expert_id") REFERENCES "experts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
