import type { Prisma } from "@expertos/db";
import type { RetrievalLanguage } from "@expertos/ai";
import type { ExpertVoiceMeta } from "./voice.types";

/** Raw row from the selectable-experts listing. */
interface ExpertRow {
  expert_id: string;
  display_name: string;
  /** Postgres `array_agg` of the `language` enum, surfaced as text[]. */
  languages: string[];
}

/**
 * pgvector-free driver that lists the experts a user can pick a voice from (M2.2). It returns
 * only *active* experts that have at least one *published* voice profile — joined and filtered
 * in SQL so a retired expert or an unreviewed profile can never reach the picker — and folds
 * each expert's published-profile languages into a single row via `array_agg`.
 *
 * Like {@link PgVoiceExampleStore} it runs against a {@link Prisma.TransactionClient} the caller
 * (see {@link VoiceService}) has already scoped with the acting user's RLS context, so tenant
 * isolation is enforced by Postgres and the SQL never expresses a `tenant_id` predicate. All
 * values are bound parameters, never interpolated (directive §1); only the parameter *position*
 * markers (`$1`, `$2`) are composed into the string.
 */
export class PgExpertStore {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /** Active experts with a published voice profile, optionally narrowed to one language. */
  async listExperts(
    language: RetrievalLanguage | undefined,
    limit: number,
  ): Promise<ExpertVoiceMeta[]> {
    const params: unknown[] = [];
    let languageClause = "";
    if (language) {
      params.push(language);
      languageClause = `AND vp.language = $${params.length}::language`;
    }
    params.push(limit);
    const limitMarker = `$${params.length}`;

    const sql = `
      SELECT e.id AS expert_id,
             e.display_name AS display_name,
             array_agg(DISTINCT vp.language::text ORDER BY vp.language::text) AS languages
      FROM experts e
      JOIN voice_profiles vp ON vp.expert_id = e.id
      WHERE e.active = true
        AND vp.status = 'published'::publish_status
        ${languageClause}
      GROUP BY e.id, e.display_name
      ORDER BY e.display_name ASC
      LIMIT ${limitMarker}`;

    const rows = await this.tx.$queryRawUnsafe<ExpertRow[]>(sql, ...params);
    return rows.map((row) => ({
      expertId: row.expert_id,
      displayName: row.display_name,
      languages: (row.languages ?? []) as RetrievalLanguage[],
      hasActiveProfile: true,
    }));
  }
}
