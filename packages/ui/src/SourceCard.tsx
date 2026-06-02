import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx";
import { Cite } from "./Cite";
import { Badge } from "./Badge";

export interface SourceCardProps {
  /** Citation marker number — the `[n]` ordinal the answer wrote (may be sparse). */
  ordinal: number;
  /**
   * Source class for the colour treatment (PRD §"Design System"): published expert
   * `knowledge` renders crimson (`.cite`), a user `upload` renders info-blue
   * (`.cite.upload`). Drives the marker icon, the version badge tone, the excerpt
   * accent border, and the active-highlight colour.
   */
  kind: "knowledge" | "upload";
  /** Bold document title — the source name (file name / "Published knowledge"). */
  title: string;
  /** Optional version badge (e.g. "V4") — knowledge: crimson, upload: info-blue. */
  version?: string;
  /**
   * Mono provenance line (`.source-prov`) — the location within the source:
   * `p.22 · "Payback Windows"`, `Sheet "FY24" · C12:C18`, or the
   * `document_version_id` for a knowledge citation that has no finer location.
   */
  provenance?: string;
  /** Quoted excerpt; rendered with a left accent border matching `kind`. */
  excerpt?: string;
  /**
   * Retrieval match percentage (0–100). Shown mono + muted, right-aligned, only
   * when a finite number is given (the citation DTO does not always carry a score).
   */
  matchPercent?: number;
  /** Highlight as the active (clicked-to) source — the click-to-passage target. */
  active?: boolean;
  /**
   * Click-to-passage: when given, the card is a `<button>` that focuses this
   * ordinal (mirrors the inline `.cite` marker click). When omitted the card is a
   * static `<div>`.
   */
  onSelect?: (ordinal: number) => void;
  className?: string;
}

/**
 * Source card (M12.5.3) — one numbered citation in the sources rail: a colour-coded
 * marker icon (crimson `knowledge` / info-blue `upload`), the document title with an
 * optional version badge, a right-aligned mono match percentage, the mono provenance
 * line, and the quoted excerpt with a left accent border matching the source class.
 *
 * Presentational: the chat page maps the latest answer's resolved citations into these
 * (knowledge vs upload kept visually distinct per the Design System — never mixed).
 * Render-after-resolve is upstream: the rail only mounts cards for citations that have
 * resolved to a real chunk.
 */
export function SourceCard({
  ordinal,
  kind,
  title,
  version,
  provenance,
  excerpt,
  matchPercent,
  active = false,
  onSelect,
  className,
}: SourceCardProps): ReactElement {
  const interactive = onSelect != null;
  const classes = cx("source-card", kind === "upload" && "upload", active && "active", className);
  const content: ReactNode[] = [
    <div key="head" className="source-card-head">
      <Cite label={ordinal} variant={kind} resolved />
      <span className="source-card-title">{title}</span>
      {version != null && <Badge tone={kind === "upload" ? "info" : "red"}>{version}</Badge>}
      {Number.isFinite(matchPercent) && (
        <span className="source-card-match mono muted">{Math.round(matchPercent as number)}% match</span>
      )}
    </div>,
    provenance != null ? (
      <span key="prov" className="source-prov">
        {provenance}
      </span>
    ) : null,
    excerpt != null ? (
      <span key="quote" className="source-quote">
        {excerpt}
      </span>
    ) : null,
  ];

  if (interactive) {
    return (
      <button type="button" className={classes} onClick={() => onSelect(ordinal)} aria-pressed={active}>
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}
