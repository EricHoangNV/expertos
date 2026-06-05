import type { Prisma } from "@expertos/db";
import { VERSION_SELECT, type VersionRow } from "./knowledge.constants";

/** Raised when a caller tries to publish a version that is not in `expert_review`. */
export class NotReviewedError extends Error {
  constructor(public readonly status: string) {
    super(`refusing to publish a "${status}" version — only expert_review versions may be published`);
    this.name = "NotReviewedError";
  }
}

/** What {@link publishReviewedVersionTx} needs from the caller (already-loaded, RLS-scoped). */
interface PublishReviewedInput {
  /** The version to publish. */
  versionId: string;
  /** Its current lifecycle status — the gate refuses anything other than `expert_review`. */
  versionStatus: string;
  /** The owning document's currently-published version, if any (it gets superseded). */
  currentPublishedVersionId: string | null;
  /** The user id stamped as the approver (the human source of authorization). */
  approverId: string;
  /** Override the timestamp (tests); defaults to now. */
  now?: Date;
}

/**
 * The single shared primitive that flips a reviewed document version live. Used by BOTH
 * {@link import("./knowledge.service").KnowledgeService.approve} (the per-version expert sign-off in
 * the portal) and the bulk-publish CLI, so the retrieval-visibility side effects — version published,
 * its chunks published (the M1.2 retrieval filter is `status = published`), the document pointer moved,
 * and the prior generation archived so retrieval never returns two — cannot drift across entry points.
 *
 * **THE EXPERT-REVIEW GATE LIVES HERE.** It throws {@link NotReviewedError} for any version not already
 * in `expert_review`. A `draft` version can never be published directly through this path — that is the
 * invariant that keeps user answers from being grounded in unreviewed knowledge. No caller can bypass it.
 *
 * Runs entirely inside the caller's transaction (and RLS context). Cache invalidation is the caller's
 * job (the per-process answer/retrieval LRU lives in the running API, unreachable from a CLI process).
 *
 * @returns the updated (now-`published`) version row, for the caller to map to a DTO.
 */
export async function publishReviewedVersionTx(
  tx: Prisma.TransactionClient,
  input: PublishReviewedInput,
): Promise<VersionRow> {
  if (input.versionStatus !== "expert_review") {
    throw new NotReviewedError(input.versionStatus);
  }
  const now = input.now ?? new Date();

  // Supersede the previously-published version (if any other) so retrieval never sees two generations.
  if (input.currentPublishedVersionId && input.currentPublishedVersionId !== input.versionId) {
    await tx.documentVersion.update({
      where: { id: input.currentPublishedVersionId },
      data: { status: "archived" },
    });
    await tx.chunk.updateMany({
      where: { documentVersionId: input.currentPublishedVersionId },
      data: { status: "archived" },
    });
  }

  const updated = (await tx.documentVersion.update({
    where: { id: input.versionId },
    data: { status: "published", approvedBy: input.approverId, approvedAt: now },
    select: VERSION_SELECT,
  })) as VersionRow;
  await tx.chunk.updateMany({
    where: { documentVersionId: input.versionId },
    data: { status: "published" },
  });
  await tx.document.update({
    where: { id: updated.documentId },
    data: { publishedVersionId: input.versionId, status: "published" },
  });
  return updated;
}
