import type { Prisma } from "@expertos/db";

/** `select` that yields exactly the fields a `KnowledgeVersionDto` needs (+ chunk count). */
export const VERSION_SELECT = {
  id: true,
  documentId: true,
  versionNumber: true,
  status: true,
  changeSummary: true,
  approvedBy: true,
  approvedAt: true,
  createdAt: true,
  _count: { select: { chunks: true } },
} satisfies Prisma.DocumentVersionSelect;

/** The row shape {@link VERSION_SELECT} returns. */
export interface VersionRow {
  id: string;
  documentId: string;
  versionNumber: number;
  status: string;
  changeSummary: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  _count: { chunks: number };
}
