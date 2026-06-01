/**
 * Text normalization + tokenization shared by the embedding, chunking, and eval code
 * (Open Decision #9 — Vietnamese retrieval quality).
 *
 * Vietnamese diacritics can be encoded two ways that look identical but differ byte-for-byte:
 * NFC (precomposed, e.g. "ệ" = one code point) and NFD (decomposed, e.g. "e" + two combining
 * marks). The combining marks carry the Unicode `Mark` property, NOT `Letter` — so the
 * letter/number tokenizer below splits a decomposed "Việt" into ["vie", "t"] (the marks fall
 * outside `[\p{L}\p{N}]` and break the run), while the composed form yields ["việt"]. A query
 * and a document in different normalization forms then share almost no tokens, silently
 * destroying recall on Vietnamese.
 *
 * Normalizing every piece of text to NFC at the boundary makes the two forms compare equal,
 * so this is applied uniformly: at ingestion (chunk content), at embedding time, and at query
 * time. The Postgres keyword path (`to_tsvector('simple', …)`) doesn't normalize either, so
 * the query text reaching it must already be NFC (see the shared `retrievalQuerySchema`).
 */

/** Unicode-canonicalize text to NFC so equivalent diacritic encodings compare equal. */
export function normalizeText(text: string): string {
  return text.normalize("NFC");
}

/**
 * Lowercased Unicode letter/number runs over NFC-normalized text. NFC-first keeps Vietnamese
 * (and other diacritic-bearing) words whole; the `u` flag makes `\p{L}`/`\p{N}` Unicode-aware
 * rather than ASCII-only. This is the single tokenizer definition the bag-of-words embedder
 * and the eval keyword scorer both use, so they can never drift apart.
 */
export function tokenize(text: string): string[] {
  return normalizeText(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
