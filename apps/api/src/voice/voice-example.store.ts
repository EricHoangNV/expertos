import type { Prisma } from "@expertos/db";
import { toVectorLiteral } from "../database/vector";
import type {
  VoiceExampleHit,
  VoiceExampleRequest,
  VoiceProfileMeta,
} from "./voice.types";

/** Raw row from the published-profile lookup. */
interface ProfileRow {
  voice_profile_id: string;
  expert_name: string;
  guidelines: string | null;
}

/** Raw row from the voice-example cosine query. */
interface ExampleRow {
  id: string;
  prompt: string | null;
  content: string;
  score: number;
}

/**
 * pgvector-backed voice-example retrieval driver (M2.1). Unlike knowledge retrieval this is
 * single-modality — voice matching is purely semantic (cosine over the HNSW
 * `voice_examples.embedding` index), there is no keyword path — so there is nothing to fuse.
 *
 * It runs against a {@link Prisma.TransactionClient} the caller has already scoped with the
 * acting user's RLS context (see {@link VoiceService}), so tenant isolation is enforced by
 * Postgres — the SQL never expresses a `tenant_id` predicate. All values are bound parameters,
 * never interpolated (directive §1). Only *published* profiles of *active* experts are
 * eligible, so an unreviewed or retired voice never renders an answer.
 */
export class PgVoiceExampleStore {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /** The published voice profile for an expert in a language, or null if none exists. */
  async loadProfile(
    expertId: string,
    language: string,
  ): Promise<VoiceProfileMeta | null> {
    const sql = `
      SELECT vp.id AS voice_profile_id,
             e.display_name AS expert_name,
             vp.guidelines
      FROM voice_profiles vp
      JOIN experts e ON e.id = vp.expert_id
      WHERE vp.expert_id = $1::uuid
        AND vp.language = $2::language
        AND vp.status = 'published'::publish_status
        AND e.active = true
      ORDER BY vp.updated_at DESC
      LIMIT 1`;
    const rows = await this.tx.$queryRawUnsafe<ProfileRow[]>(
      sql,
      expertId,
      language,
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      voiceProfileId: row.voice_profile_id,
      expertName: row.expert_name,
      guidelines: row.guidelines,
    };
  }

  /** Top-K voice examples within a profile, ranked by cosine similarity to the query topic. */
  async retrieveExamples(
    request: VoiceExampleRequest,
  ): Promise<VoiceExampleHit[]> {
    const vector = toVectorLiteral(request.embedding);
    const sql = `
      SELECT id, prompt, content,
             1 - (embedding <=> $1::vector) AS score
      FROM voice_examples
      WHERE voice_profile_id = $2::uuid AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $3`;
    const rows = await this.tx.$queryRawUnsafe<ExampleRow[]>(
      sql,
      vector,
      request.voiceProfileId,
      request.topK,
    );
    return rows.map((row) => ({
      id: row.id,
      prompt: row.prompt,
      content: row.content,
      score: Number(row.score),
    }));
  }
}
