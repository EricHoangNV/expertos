/**
 * Citation builder with a chunk-resolvability guarantee (M4.1).
 *
 * The prompt builder ({@link buildAnswerPrompt}) numbers the retrieved sources `[1..N]` and tells
 * the model to cite with `[n]` markers; marker `[n]` resolves to `citations[n - 1]`. The model is
 * free text, though — it can emit a marker that points nowhere (`[0]`, `[99]`, a hallucinated
 * number) or cite only a subset of what was retrieved. This module is the single enforcement point
 * for the M4 contract: **never emit an unresolvable citation**. Given the COMPLETE post-stream
 * answer and the ordered source table, it
 *
 *   1. parses every `[n]` marker in the answer,
 *   2. drops any marker that does not resolve to a real chunk (out of `1..N`),
 *   3. returns ONLY the sources a surviving marker actually referenced — without renumbering, so
 *      the marker the model wrote still equals the citation's `ordinal` (the streamed prose the
 *      user saw is never invalidated), and
 *   4. returns a sanitized copy of the answer with the unresolvable markers stripped, so neither
 *      the emitted citation list NOR the persisted answer text can carry a dangling `[n]`.
 *
 * Like the prompt builder it is pure and deterministic (no clock / RNG / IO) so it can be asserted
 * against directly. It does not compute the insufficient-knowledge signal — that stays a
 * retrieval-side fact (`facts.length === 0`) at the chat seam, decoupled from "the model cited
 * nothing resolvable".
 */

import { normalizeText } from "../text";

/**
 * A retrieved source the answer may cite. Structurally a superset-compatible subset of
 * `PromptFact` (so the chat seam can pass `AnswerPrompt.citations` straight in), plus an optional
 * `kind` reserved for the M5 upload-vs-knowledge citation distinction (defaults to `knowledge`).
 */
export interface CitationSource {
  chunkId: string;
  documentVersionId: string;
  content: string;
  /** Source class for the M4.2/M5 `.cite` variant. Defaults to `"knowledge"` when absent. */
  kind?: "knowledge" | "upload";
  /** `upload_chunk` id when the source came from a user upload (M5.4); absent for knowledge. */
  uploadChunkId?: string;
  /** Human-readable provenance for an uploaded source (M5.4): `filename · sheet!cell`. */
  sourceLabel?: string;
}

/** A source confirmed resolvable and actually referenced by a surviving marker. */
export interface ResolvedCitation {
  /** The 1-based marker the model wrote AND the array position it resolved to. NOT renumbered. */
  ordinal: number;
  chunkId: string;
  documentVersionId: string;
  content: string;
  kind: "knowledge" | "upload";
  /** `upload_chunk` id for an upload citation (M5.4) — persisted as the citation's provenance. */
  uploadChunkId?: string;
  /** Human-readable provenance for an upload citation (M5.4): `filename · sheet!cell`. */
  sourceLabel?: string;
}

export interface BuildCitationsInput {
  /** The COMPLETE model answer (post-stream). NFC-normalized internally before parsing. */
  answer: string;
  /** The ordered resolution table — `AnswerPrompt.citations`. `citations[i]` resolves marker `[i + 1]`. */
  citations: readonly CitationSource[];
}

export interface BuiltCitations {
  /** The answer, NFC-normalized, with every unresolvable marker stripped (resolvable ones kept verbatim). */
  text: string;
  /** Only the sources referenced by a surviving resolvable marker, ascending by ordinal, de-duplicated. */
  citations: ResolvedCitation[];
}

/**
 * Matches a citation marker: a bracket wrapping one or more integers, optionally comma/space
 * separated. Covers the form the prompt teaches (`[1]`, and adjacent runs `[1][3]` as two matches)
 * plus the comma/space drift a model may produce (`[1,3]`, `[1, 3]`, `[1 3]`). The `\d+` requirement
 * means bracketed prose that is not all-integers (`[abc]`, array literals) is left untouched.
 */
const MARKER = /\[\s*\d+(?:\s*[,\s]\s*\d+)*\s*\]/gu;

/**
 * Builds the resolvable citation list and the sanitized answer text. See the module doc for the
 * full contract; never throws (an empty source table or a marker-free answer just yields `[]`).
 */
export function buildCitations(input: BuildCitationsInput): BuiltCitations {
  const sources = input.citations;
  const total = sources.length;
  const normalized = normalizeText(input.answer);
  // Keyed by ordinal so a source cited in two sentences appears once; insertion order is irrelevant
  // because the final list is sorted by ordinal.
  const referenced = new Map<number, ResolvedCitation>();

  const stripped = normalized.replace(MARKER, (group) => {
    const numbers = group.match(/\d+/gu);
    // The MARKER pattern guarantees at least one integer; guard defensively anyway.
    if (!numbers) {
      return group;
    }
    let anyResolvable = false;
    for (const raw of numbers) {
      const ordinal = Number.parseInt(raw, 10);
      if (ordinal >= 1 && ordinal <= total) {
        anyResolvable = true;
        if (!referenced.has(ordinal)) {
          const src = sources[ordinal - 1];
          referenced.set(ordinal, {
            ordinal,
            chunkId: src.chunkId,
            documentVersionId: src.documentVersionId,
            content: src.content,
            kind: src.kind ?? "knowledge",
            uploadChunkId: src.uploadChunkId,
            sourceLabel: src.sourceLabel,
          });
        }
      }
    }
    // Keep a group with any resolvable member verbatim (so the prose still matches the citation
    // ordinals); drop a wholly-unresolvable group so no dangling marker can ever be displayed.
    return anyResolvable ? group : "";
  });

  const text = squeezeWhitespace(stripped);
  const citations = [...referenced.values()].sort((a, b) => a.ordinal - b.ordinal);
  return { text, citations };
}

/**
 * Tidies the spacing left behind when an unresolvable marker is removed: collapses the resulting
 * run of spaces and drops a space stranded immediately before sentence punctuation. Deliberately
 * minimal — it only touches spaces (never newlines), so it cannot reflow the answer's structure.
 */
function squeezeWhitespace(text: string): string {
  return text.replace(/ {2,}/gu, " ").replace(/ +([.,;:!?])/gu, "$1");
}
