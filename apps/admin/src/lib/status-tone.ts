import type {
  BadgeTone,
} from "@expertos/ui";
import type {
  KnowledgeDraftStatusValue,
  PublishStatusValue,
} from "@expertos/shared";

/**
 * Maps a lifecycle status onto a semantic `.badge` tone (Design System §"Design System"):
 * `published` reads as success (green), `expert_review` as needing attention (amber),
 * `rejected` as a hard stop (red), in-progress/neutral states as ink/info. Single source so
 * the document queue (M8.1) and the draft queue (M8.2) never drift on what a status looks like.
 */
const PUBLISH_TONES: Record<PublishStatusValue, BadgeTone> = {
  draft: "ink",
  ai_processing: "info",
  expert_review: "amber",
  published: "green",
  archived: "ink",
};

const DRAFT_TONES: Record<KnowledgeDraftStatusValue, BadgeTone> = {
  draft: "ink",
  expert_review: "amber",
  published: "green",
  rejected: "red",
};

export function publishStatusTone(status: PublishStatusValue): BadgeTone {
  return PUBLISH_TONES[status];
}

export function draftStatusTone(status: KnowledgeDraftStatusValue): BadgeTone {
  return DRAFT_TONES[status];
}

/** Human label for a status (replaces `_` with a space so `expert_review` reads naturally). */
export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
