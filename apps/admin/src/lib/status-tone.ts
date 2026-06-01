import type {
  BadgeTone,
} from "@expertos/ui";
import type {
  FairUseFlagStatusValue,
  KnowledgeDraftStatusValue,
  PublishStatusValue,
  Role,
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

/**
 * Fair-use flag review tones (M8.4): a fresh `open` flag needs attention (amber), a `throttled`
 * account is a hard limit (red), `reviewed` is neutral progress (info), and a `cleared` flag is
 * resolved (green).
 */
const FAIR_USE_TONES: Record<FairUseFlagStatusValue, BadgeTone> = {
  open: "amber",
  reviewed: "info",
  throttled: "red",
  cleared: "green",
};

export function fairUseFlagTone(status: FairUseFlagStatusValue): BadgeTone {
  return FAIR_USE_TONES[status];
}

/** Role tones (M8.4): `admin` reads as elevated privilege (red), `expert` distinguished (info). */
const ROLE_TONES: Record<Role, BadgeTone> = {
  user: "ink",
  expert: "info",
  admin: "red",
};

export function roleTone(role: Role): BadgeTone {
  return ROLE_TONES[role];
}

/** Human label for a status (replaces `_` with a space so `expert_review` reads naturally). */
export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
