"use client";

import { useEffect, useState } from "react";
import type { Role } from "@expertos/shared";
import { getConciergeReviews, getFailedQueries, listDocuments } from "./admin-client";

/**
 * Sidebar nav count badges (M13.1.2). Each value is the attention-needing count rendered as a
 * `.navitem .tag` next to its nav item, or `null` while it is still loading / not visible to the
 * signed-in role. Counts are display-capped (see {@link CAP}); a count at the cap renders as "99+".
 */
export interface NavCounts {
  /** Knowledge versions sitting in `expert_review` (documents needing a sign-off). Expert + admin. */
  knowledgeReview: number | null;
  /** Flagged (👎) low-confidence answers awaiting triage. Admin only. */
  failedQueries: number | null;
  /** Open concierge review requests (`requested` + `in_review`). Expert + admin. */
  conciergeOpen: number | null;
}

const EMPTY: NavCounts = { knowledgeReview: null, failedQueries: null, conciergeOpen: null };

/** Display cap — counts beyond this render as "99+" so the badge stays a single small chip. */
export const CAP = 99;

/** Clamp a fetched length to the display cap. */
function capCount(n: number): number {
  return n > CAP ? CAP : n;
}

/**
 * Fetches the three sidebar count badges from the existing review/queue APIs once the role resolves.
 * Best-effort per badge (one failing API leaves its count `null` rather than blocking the others),
 * and a UX-only signal — the API still enforces the real role + tenant boundary. Admin-only counts
 * are skipped for an expert. Re-runs when the role changes (e.g. expert → admin after `/me`).
 */
export function useNavCounts(
  role: Role | null,
  getIdToken: () => Promise<string | null>,
): NavCounts {
  const [counts, setCounts] = useState<NavCounts>(EMPTY);

  useEffect(() => {
    if (role == null) {
      return;
    }
    let cancelled = false;
    const isAdmin = role === "admin";

    void (async () => {
      const token = await getIdToken();
      if (!token || cancelled) {
        return;
      }

      const set = (patch: Partial<NavCounts>) => {
        if (!cancelled) {
          setCounts((prev) => ({ ...prev, ...patch }));
        }
      };

      // Knowledge needing review — versions parked in `expert_review` (expert + admin visible).
      void listDocuments(token, "expert_review")
        .then((docs) => set({ knowledgeReview: capCount(docs.length) }))
        .catch(() => {});

      // Open concierge queue — `requested` + `in_review`, fetched separately because the list API
      // filters on a single status (its default ordering surfaces answered items first).
      void Promise.all([
        getConciergeReviews(token, { status: "requested", limit: CAP + 1 }),
        getConciergeReviews(token, { status: "in_review", limit: CAP + 1 }),
      ])
        .then(([requested, inReview]) =>
          set({ conciergeOpen: capCount(requested.length + inReview.length) }),
        )
        .catch(() => {});

      // Flagged low-confidence queries (admin only).
      if (isAdmin) {
        void getFailedQueries(token, { limit: CAP + 1 })
          .then((rows) => set({ failedQueries: capCount(rows.length) }))
          .catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role, getIdToken]);

  return counts;
}
