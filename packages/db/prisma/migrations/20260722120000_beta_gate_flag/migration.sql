-- Private beta gate: when enabled, consumer-app sign-in requires an `allowed_emails` entry
-- (any role) — enforced in `AuthService.resolveUser`. Defaults ON (private-beta posture);
-- admins flip it from the Settings page. No DDL for `allowed_emails`: its `role` column is
-- already the full Role enum — only the app layer previously restricted it to the portal roles.
ALTER TABLE "app_settings" ADD COLUMN "beta_gate_enabled" BOOLEAN NOT NULL DEFAULT true;
