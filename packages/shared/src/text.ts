/**
 * Text input normalization applied at the API validation boundary (directive §1).
 *
 * Unicode-canonicalizes to NFC so that diacritic-bearing scripts — Vietnamese above all —
 * compare and tokenize consistently no matter how the client encoded them. A query typed in
 * decomposed (NFD) form would otherwise share almost no tokens with NFC-stored knowledge,
 * silently destroying recall (Open Decision #9). Normalizing query text here means both the
 * vector path (the embedder) and the Postgres keyword path (`to_tsvector('simple', …)`, which
 * does not normalize) see the same canonical form.
 *
 * This mirrors `@expertos/ai`'s `normalizeText` deliberately: `@expertos/shared` stays free of
 * a `@expertos/ai` dependency (same purity rule the retrieval/ingestion schemas follow), and
 * the body is a single canonical-form call, so there is nothing to drift.
 */
export function normalizeText(text: string): string {
  return text.normalize("NFC");
}
