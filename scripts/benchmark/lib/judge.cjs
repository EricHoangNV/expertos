/**
 * LLM-as-judge for answer verification. Compares a generated answer against the gold
 * answer for the same question and returns a 0-100 match score with a short rationale.
 *
 * The rubric targets CONTENT correctness, not wording or voice: does the answer convey
 * the same key points and conclusions as the gold answer, without contradictions or
 * fabricated claims. Temperature 0 for maximum run-to-run stability. The judge is
 * instructed to answer in strict JSON so the score is machine-parseable.
 */
const SYSTEM = `You are a strict evaluator for an expert business-advisory Q&A system.
You compare a CANDIDATE answer against a GOLD (reference) answer for the same question
and rate how well the candidate matches the gold answer's substance.

Score 0-100 where:
- 100 = the candidate conveys all the key points and conclusions of the gold answer,
        with no contradictions and no fabricated claims. Wording and structure may differ.
- 70-99 = substantially matches; most key points present; minor omissions or added-but-correct detail.
- 40-69 = partial match; some key points present but notable omissions or vague/generic content.
- 1-39 = largely different, mostly missing the gold answer's substance, or drifts off-topic.
- 0 = contradicts the gold answer, is empty, refuses, or says it lacks the knowledge to answer.

Judge SUBSTANCE, not style. Do not reward or penalize differences in tone, length, persona,
or phrasing. Penalize factual contradictions and claims not supported by the gold answer.
Be consistent and calibrated. Respond ONLY with strict JSON, no markdown, no prose outside JSON.`;

function buildMessages({ question, gold, candidate }) {
  const user = `QUESTION:
${question}

GOLD ANSWER:
${gold}

CANDIDATE ANSWER:
${candidate || "(empty)"}

Return JSON exactly:
{"score": <integer 0-100>, "verdict": "<match|partial|mismatch>", "missing": ["<key point in gold but absent/weak in candidate>", ...], "contradictions": ["<candidate claim that conflicts with gold>", ...], "rationale": "<one or two sentences>"}`;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

function extractJson(text) {
  // Tolerate stray prose or code fences around the JSON object.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object in judge output");
  return JSON.parse(body.slice(start, end + 1));
}

function clampScore(v) {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) throw new Error("judge score is not a number");
  return Math.max(0, Math.min(100, n));
}

/**
 * @param llm  an LlmProvider (OpenAiLlmProvider) used as the judge
 * @param model optional judge model override
 * @returns { score, verdict, missing[], contradictions[], rationale, judgeModel, judgeTokens }
 */
async function judgeAnswer(llm, { question, gold, candidate }, { model } = {}) {
  if (!candidate || !candidate.trim()) {
    return {
      score: 0,
      verdict: "mismatch",
      missing: ["entire answer (candidate empty)"],
      contradictions: [],
      rationale: "Candidate answer is empty.",
      judgeModel: model || llm.name,
      judgeTokens: 0,
    };
  }
  const messages = buildMessages({ question, gold, candidate });
  const { text, usage } = await llm.complete(messages, { temperature: 0, model });
  const parsed = extractJson(text);
  return {
    score: clampScore(parsed.score),
    verdict: String(parsed.verdict || "").toLowerCase() || "unknown",
    missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 8) : [],
    contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions.slice(0, 8) : [],
    rationale: String(parsed.rationale || "").slice(0, 500),
    judgeModel: model || llm.name,
    judgeTokens: (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0),
  };
}

module.exports = { judgeAnswer, buildMessages, extractJson, clampScore };
