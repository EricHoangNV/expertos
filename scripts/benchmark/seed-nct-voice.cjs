#!/usr/bin/env node
/**
 * Seed the NCT expert (Ngô Công Trường) + voice profiles for the benchmark.
 *
 * Production only ships a Vietnamese voice profile. The benchmark exercises NCT's voice
 * in BOTH languages, so this seeds:
 *   - the `nct` expert (find-or-create),
 *   - a PUBLISHED `vi` voice profile (guidelines + signature examples), matching production,
 *   - a PUBLISHED `en` voice profile (English guidelines + the same signature examples),
 *     which is benchmark-only config (no EN profile ships today).
 *
 * Signature examples come from the KBM Approved Response Bank; if that asset is absent the
 * profiles are still seeded (guidelines-only voice).
 *
 * Idempotent: re-running refreshes both profiles and their examples.
 *
 *   node scripts/benchmark/seed-nct-voice.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const S = require("./lib/shared.cjs");

const GLOBAL_TENANT = "00000000-0000-0000-0000-000000000000";
const SYSTEM_USER = "11111111-1111-1111-1111-111111111111";
const SLUG = "nct";

// Vietnamese guidelines — verbatim from tmp/seed_voice.cjs (the production seed).
const GUIDELINES_VI = `Bạn đang mô phỏng phong cách diễn đạt của DBA Ngô Công Trường (NCT) — chuyên gia Operational Excellence, Lean Six Sigma, nhà sáng lập John & Partners.

GIỌNG ĐIỆU:
- Thẳng thắn, trực tiếp, không vòng vo; thường mở đầu bằng một sự thật khó nghe.
- Kết hợp học thuật và thực chiến: dùng framework/phương pháp rõ ràng nhưng luôn neo vào ví dụ thực tế, con số, hệ thống.
- Tư duy hệ thống: hỏi "hệ thống nào tạo ra kết quả này?" thay vì "ai làm sai?". Nhấn mạnh chuẩn hóa, đo lường, thiết kế cấu trúc.
- Tự tin, khẳng định; luôn đưa ra quan điểm và khuyến nghị rõ ràng.
- Câu ngắn, dứt khoát, có nhịp; hay dùng tương phản và câu hỏi gợi mở.

KHÔNG ĐƯỢC (Do-Not-Say):
- Tránh ngôn ngữ do dự: "có thể là...", "có lẽ nên...", "mình nghĩ là...", "khó nói lắm", "tùy thuộc vào..." (khi không giải thích tiếp).
- Không tự hạ thấp: "tôi không chắc...", "có thể tôi nhầm...", "chỉ là ý kiến cá nhân...", "tôi không phải chuyên gia nhưng...". NCT tự tin về credentials (TOP 40 ASQ, Master Black Belt, DBA, 15+ năm) — không cần disclaimer.
- Tránh buzzword rỗng ("digital transformation", "disruptive innovation", "synergy", "leverage") nếu không định nghĩa rõ trong ngữ cảnh.

Đây chỉ là hướng dẫn GIỌNG ĐIỆU — không bao giờ lấy số liệu/khẳng định từ đây; mọi dữ kiện phải đến từ SOURCES.`;

// English guidelines — a faithful translation of the VI voice for the benchmark-only en profile.
const GUIDELINES_EN = `You are emulating the speaking style of DBA Ngô Công Trường (NCT) — an Operational Excellence and Lean Six Sigma expert, founder of John & Partners.

TONE:
- Direct and blunt, no hedging; often open with an uncomfortable truth.
- Blend academic rigor with real-world execution: use clear frameworks/methods but always anchor to concrete examples, numbers, and systems.
- Systems thinking: ask "what system produced this result?" rather than "who did it wrong?". Emphasize standardization, measurement, and structural design.
- Confident and assertive; always give a clear point of view and recommendation.
- Short, decisive, rhythmic sentences; use contrast and pointed questions.

DO NOT SAY:
- Avoid hesitant language: "it might be...", "perhaps you should...", "I think maybe...", "it's hard to say...", "it depends..." (when left unexplained).
- No self-deprecation: "I'm not sure...", "I might be wrong...", "just my personal opinion...", "I'm not an expert but...". NCT is confident in his credentials (TOP 40 ASQ, Master Black Belt, DBA, 15+ years) — no disclaimers needed.
- Avoid empty buzzwords ("digital transformation", "disruptive innovation", "synergy", "leverage") unless clearly defined in context.

This is STYLE guidance only — never take facts or figures from here; every fact must come from SOURCES.`;

const KBM_BANK = path.join(
  S.ROOT,
  "tmp",
  "AJJ AI KBM",
  "03_COMMUNICATION_STYLE",
  "06_Approved_Response_Bank",
);

/** Pull (topic, quote) pairs from the Approved Response Bank markdown. Returns [] if absent. */
function extractExamples() {
  let dir;
  try {
    dir = fs.readdirSync(KBM_BANK).find((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  if (!dir) return [];
  const text = fs.readFileSync(path.join(KBM_BANK, dir), "utf8");
  const out = [];
  let topic = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^##\s*(?:\d+\.\s*)?(.+?)\s*$/);
    if (h) {
      topic = h[1].trim();
      continue;
    }
    const q = line.match(/^>\s*"(.+)"\s*$/);
    if (q) out.push({ prompt: topic, content: q[1].trim() });
  }
  const seen = new Set();
  return out.filter((e) => {
    if (e.content.length < 15 || e.content.length > 600 || seen.has(e.content)) return false;
    seen.add(e.content);
    return true;
  });
}

async function seedProfile(tx, { expertId, language, name, description, guidelines, examples, vectors, toVectorLiteral }) {
  let profile = await tx.voiceProfile.findFirst({ where: { tenantId: GLOBAL_TENANT, expertId, language } });
  if (profile) {
    await tx.voiceExample.deleteMany({ where: { voiceProfileId: profile.id } });
    profile = await tx.voiceProfile.update({
      where: { id: profile.id },
      data: { name, description, guidelines, status: "published", approvedBy: SYSTEM_USER, approvedAt: new Date() },
    });
  } else {
    profile = await tx.voiceProfile.create({
      data: { tenantId: GLOBAL_TENANT, expertId, language, name, description, guidelines, status: "published", approvedBy: SYSTEM_USER, approvedAt: new Date() },
    });
  }
  for (let i = 0; i < examples.length; i++) {
    await tx.$executeRawUnsafe(
      `INSERT INTO voice_examples (id, tenant_id, voice_profile_id, prompt, content, language, embedding, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::language, $7::vector, now())`,
      randomUUID(),
      GLOBAL_TENANT,
      profile.id,
      examples[i].prompt,
      examples[i].content,
      language,
      toVectorLiteral(vectors[i]),
    );
  }
  return profile;
}

async function main() {
  S.loadEnv();
  const { db, defaults } = S.requireDist();
  const { PrismaClient, applyRlsContext } = db;
  const { toVectorLiteral } = require(path.join(S.ROOT, "apps", "api", "dist", "database", "vector"));

  const examples = extractExamples();
  console.log(`Signature examples extracted from KBM: ${examples.length}${examples.length ? "" : " (guidelines-only voice)"}`);

  const embedder = defaults.createDefaultEmbeddingProvider(process.env);
  const vectors = examples.length ? await embedder.embed(examples.map((e) => e.content)) : [];

  const prisma = new PrismaClient({ transactionOptions: { timeout: 60000, maxWait: 15000 } });
  const result = await prisma.$transaction(async (tx) => {
    await applyRlsContext(tx, { tenantId: GLOBAL_TENANT, userId: SYSTEM_USER, isAdmin: true });

    let expert = await tx.expert.findFirst({ where: { tenantId: GLOBAL_TENANT, slug: SLUG } });
    if (!expert) {
      expert = await tx.expert.create({
        data: {
          tenantId: GLOBAL_TENANT,
          slug: SLUG,
          displayName: "Ngô Công Trường",
          title: "DBA · Operational Excellence · John & Partners",
          bio: "Chuyên gia Operational Excellence, Lean Six Sigma; TOP 40 ASQ; nhà sáng lập John & Partners.",
          active: true,
        },
      });
    }

    const vi = await seedProfile(tx, {
      expertId: expert.id, language: "vi",
      name: "Ngô Công Trường — thẳng thắn, thực chiến",
      description: "Giọng điệu OPEX: thẳng thắn, tư duy hệ thống, tự tin.",
      guidelines: GUIDELINES_VI, examples, vectors, toVectorLiteral,
    });
    const en = await seedProfile(tx, {
      expertId: expert.id, language: "en",
      name: "Ngô Công Trường — direct, execution-focused",
      description: "OPEX voice: blunt, systems-thinking, confident. (benchmark-only)",
      guidelines: GUIDELINES_EN, examples, vectors, toVectorLiteral,
    });

    return { expertId: expert.id, viId: vi.id, enId: en.id };
  });

  console.log(`✓ Expert ${result.expertId} (slug=${SLUG})`);
  console.log(`✓ vi profile ${result.viId} — PUBLISHED (${examples.length} examples)`);
  console.log(`✓ en profile ${result.enId} — PUBLISHED (${examples.length} examples)  [benchmark-only]`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
