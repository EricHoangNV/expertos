/**
 * Voice-fidelity eval contracts (M2.4 / PRD §"Expert voice layer", §"LLM/RAG eval harness").
 *
 * Where the retrieval harness ({@link EvalGoldenSet}) measures whether the *right facts* are
 * surfaced, this slice measures the other half of the product's core principle: an answer is
 * rendered in an expert's *voice* (tone/structure/framing) while the retrieved facts stay
 * authoritative — "voice on top of facts" (principle #5). The two are evaluated separately so a
 * regression in either is attributable.
 *
 * The harness has two layers, mirroring the retrieval harness's "deterministic offline +
 * out-of-band real model" split:
 *
 *  1. A **structural** layer that is pure and database/network-free: it asserts against the
 *     {@link buildAnswerPrompt} output directly — the disclosure is present, the voice guidelines
 *     and style examples are injected and labeled style-only, the facts-vs-voice separation rules
 *     are stated, and — the load-bearing check — the SOURCES and citation list are byte-for-byte
 *     identical to a voice-off build of the same facts (voice can shape presentation but can never
 *     add, drop, reorder, or alter a fact). This runs in CI and regression-guards the prompt
 *     contract.
 *
 *  2. An optional **live** layer (out-of-band): inject an {@link LlmProvider} to generate the
 *     answer and a {@link VoiceJudge} to score how faithfully it reproduces the expert's voice and
 *     whether every claim is grounded in the sources. No LLM/judge ⇒ the harness reports only the
 *     structural layer, exactly as the retrieval harness reports lexical-only numbers without the
 *     real embedder.
 *
 * Open Decision #2 (the voice-fidelity acceptance bar) is given a concrete engineering stance
 * here via {@link VOICE_FIDELITY_BAR} / {@link FACT_ADHERENCE_BAR}; see voice-metrics.ts.
 */

import type { LlmProvider } from "../providers";
import type {
  PromptFact,
  PromptLanguage,
  VoiceExampleInput,
  VoiceProfileInput,
} from "../prompt/types";

/**
 * One voice-fidelity case: a question plus the facts it must ground on, the expert voice it must
 * be rendered in, and the style markers a faithful rendering is expected to surface.
 */
export interface VoiceEvalCase {
  id: string;
  /** End-user question (treated as already sanitized + NFC-normalized, as at the API boundary). */
  query: string;
  /** The ONLY admissible source of claims/numbers/names. Carried into the citation list. */
  facts: PromptFact[];
  /** The expert voice the answer must be rendered in. */
  voice: VoiceProfileInput;
  /** Optional few-shot style anchors (style only — never a source of facts). */
  voiceExamples?: VoiceExampleInput[];
  /** Answer language. Defaults to `en`. */
  language?: PromptLanguage;
  /**
   * Substrings a faithful in-voice prompt is expected to surface in the system message (e.g. the
   * guideline phrasing, an example's signature line). All must appear for the style-marker check
   * to pass. Optional — omit when guidelines/examples alone are the contract.
   */
  expectStyleMarkers?: string[];
  /** Free-text note describing what the case exercises. */
  note?: string;
}

export interface VoiceGoldenSet {
  cases: VoiceEvalCase[];
}

/**
 * A live voice-fidelity scorer. Implemented out-of-band against a real judge LLM; the harness
 * only sees this interface so it stays dependency-free and the in-CI tests can inject a stub.
 */
export interface VoiceJudge {
  readonly name: string;
  /**
   * Score a generated answer for one case. Both scores are in `[0,1]`; an implementation MUST
   * clamp/normalize before returning (the harness asserts on them but does not re-clamp).
   */
  score(input: VoiceJudgeRequest): Promise<VoiceJudgeVerdict>;
}

export interface VoiceJudgeRequest {
  case: VoiceEvalCase;
  /** The model's generated answer. */
  answer: string;
}

export interface VoiceJudgeVerdict {
  /** `[0,1]` — how well the answer reproduces the expert's voice (tone/structure/framing). */
  voiceFidelity: number;
  /** `[0,1]` — fraction of the answer's claims grounded in the sources (1 = no invention). */
  factAdherence: number;
  /** Optional rationale from the judge, for the inspector UI / debugging. */
  rationale?: string;
}

export interface VoiceEvalOptions {
  /**
   * Optional live model used to generate the answer for the live layer. Omitted ⇒ structural-only.
   * Required whenever {@link judge} is supplied (you cannot score an answer you didn't generate).
   */
  llm?: LlmProvider;
  /** Optional live judge. Requires {@link llm}. */
  judge?: VoiceJudge;
}

/** The deterministic structural checks for one case. `score` is the fraction that passed. */
export interface StructuralVoiceResult {
  /** System prompt carries the "AI rendition of [Expert]" disclosure. */
  disclosurePresent: boolean;
  /** The voice guidelines text is injected into the system prompt. */
  guidelinesPresent: boolean;
  /** Every supplied voice example's content is injected (or none were supplied). */
  examplesPresent: boolean;
  /** The facts-are-authoritative and voice-is-presentation-only rules are both stated. */
  separationRulesPresent: boolean;
  /**
   * The SOURCES block and citation list are identical to a voice-off build of the same facts —
   * i.e. voice changed nothing about the facts. This is the core separation guarantee.
   */
  factsInvariant: boolean;
  /** All `expectStyleMarkers` (if any) appear in the system prompt. */
  styleMarkersPresent: boolean;
  /** Fraction of the above checks that passed, in `[0,1]`. */
  score: number;
  /** True only when every structural check passed (`score === 1`). */
  passed: boolean;
}

/** A live judge's verdict for one case, plus whether it clears the acceptance bars. */
export interface LiveVoiceResult extends VoiceJudgeVerdict {
  passed: boolean;
}

export interface VoiceCaseResult {
  caseId: string;
  structural: StructuralVoiceResult;
  /** Present only when a live judge ran for this case. */
  live?: LiveVoiceResult;
}

export interface VoiceEvalReport {
  cases: VoiceCaseResult[];
  /** Mean structural score across cases (`[0,1]`; 0 for an empty set). */
  meanStructuralScore: number;
  /** True when every case's structural checks fully passed — the offline acceptance gate. */
  structuralPass: boolean;
  /** Live aggregates, present only when a judge ran. */
  live?: {
    judge: string;
    meanVoiceFidelity: number;
    meanFactAdherence: number;
    /** True when mean voice fidelity ≥ bar AND every case clears the fact-adherence bar (OD#2). */
    passed: boolean;
  };
  /** The acceptance bars used (Open Decision #2), echoed for run provenance. */
  acceptance: { voiceFidelityBar: number; factAdherenceBar: number };
}
