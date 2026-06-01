/**
 * Renders a JS number[] as a pgvector text literal `[v1,v2,...]` for binding into raw SQL
 * (`$n::vector`). Prisma can't map the `Unsupported("vector")` column, so both the
 * ingestion write and the M1.2 retrieval query go through raw SQL and this helper.
 *
 * Fixed 8-decimal precision avoids exponent notation, which pgvector's input parser
 * rejects; non-finite values are rejected up front (directive §9 — guard NaN/Infinity).
 */
export function toVectorLiteral(vector: number[]): string {
  const parts = vector.map((value) => {
    if (!Number.isFinite(value)) {
      throw new Error("embedding contains a non-finite value");
    }
    return value.toFixed(8);
  });
  return `[${parts.join(",")}]`;
}
