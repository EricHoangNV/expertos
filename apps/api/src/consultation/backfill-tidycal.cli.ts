/**
 * Backfill the per-expert TidyCal token from the legacy global env var (M16.6, one-off deploy step).
 *
 * Before M16, TidyCal was a single global integration configured by `TIDYCAL_API_TOKEN`. M16 moves
 * the token onto each `Expert` row (encrypted). This script seeds the **primary expert** (Ngô Công
 * Trường — the chat default voice) with that global token, encrypted at rest, so the existing single
 * calendar keeps polling under the per-expert model with no manual re-entry.
 *
 * Idempotent + safe to run repeatedly:
 *   - does nothing if `TIDYCAL_API_TOKEN` is unset (no legacy token to migrate);
 *   - does nothing if the target expert already has a token (never clobbers a value an expert set);
 *   - requires `CREDENTIALS_ENCRYPTION_KEY` (the at-rest key) — fails loudly if missing.
 *
 *   # dry run — reports what WOULD change, writes nothing (default):
 *   pnpm --filter @expertos/api backfill-tidycal
 *
 *   # actually write:
 *   pnpm --filter @expertos/api backfill-tidycal -- --commit
 *
 *   # target a different expert by display name (default: "Ngô Công Trường"):
 *   pnpm --filter @expertos/api backfill-tidycal -- --commit --name="Some Other Expert"
 *
 * Local-engine note: prefix with `PRISMA_CLIENT_ENGINE_TYPE=binary` on the sandbox.
 */
import { GLOBAL_TENANT_ID, prisma, applyRlsContext } from "@expertos/db";
import type { Prisma } from "@expertos/db";
import { encryptSecret, isCredentialsKeyConfigured, last4 } from "../common/secret-crypto";

const DEFAULT_EXPERT_NAME = "Ngô Công Trường";

function withRls<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });
    return work(tx);
  });
}

/* eslint-disable no-console */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commit = argv.includes("--commit");
  const name =
    argv.find((a) => a.startsWith("--name="))?.split("=").slice(1).join("=") ?? DEFAULT_EXPERT_NAME;

  const token = process.env.TIDYCAL_API_TOKEN;
  if (!token) {
    console.log("TIDYCAL_API_TOKEN unset — no legacy token to migrate. Nothing to do.");
    return;
  }
  if (!isCredentialsKeyConfigured()) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not configured — cannot encrypt the token at rest. Aborting.",
    );
  }

  const expert = await withRls((tx) =>
    tx.expert.findFirst({
      where: { displayName: name },
      select: { id: true, displayName: true, tidycalApiTokenEnc: true },
    }),
  );

  if (!expert) {
    console.log(`No expert named "${name}" found. Nothing to do.`);
    return;
  }
  if (expert.tidycalApiTokenEnc) {
    console.log(`Expert "${expert.displayName}" already has a TidyCal token configured. Skipping.`);
    return;
  }

  console.log(
    `Would backfill TidyCal token (••••${last4(token)}) onto expert "${expert.displayName}" (${expert.id}).`,
  );
  if (!commit) {
    console.log("Dry run — pass --commit to write.");
    return;
  }

  await withRls((tx) =>
    tx.expert.update({
      where: { id: expert.id },
      data: { tidycalApiTokenEnc: encryptSecret(token), tidycalApiTokenLast4: last4(token) },
    }),
  );
  console.log("Done. The primary expert now polls TidyCal with the migrated token.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
