/**
 * Expert attribution / "AI rendition of [Expert]" disclosure (M2.2).
 *
 * This is the SINGLE source of truth for the rendition disclosure phrase. Both the prompt
 * builder (so the in-prompt framing the LLM is given can never drift from what the product
 * promises) and the chat UI/API (so the visible "AI rendition of [Expert]" label reads
 * identically) derive the phrase from here — never from a hand-written string in either layer.
 *
 * Like the rest of {@link buildAnswerPrompt}'s inputs it is pure and dependency-free (no
 * Prisma / shared / IO): it consumes only {@link VoiceProfileInput}, the same neutral value
 * type the prompt builder already takes, so `@expertos/ai` stays free of the app/DB layers.
 */

import type { VoiceProfileInput } from "./types";

/**
 * The attribution layer for one answer. `rendition` is true only when the answer is rendered
 * in a named expert's voice; `disclosureText` is the exact label the prompt and the UI surface
 * ("AI rendition of [Expert]"), and is the empty string for a neutral (no-expert) answer so a
 * caller can render it unconditionally.
 */
export interface AttributionInfo {
  rendition: boolean;
  expertName?: string;
  disclosureText: string;
}

/**
 * Derives the attribution for an answer from its (optional) voice profile. A present, non-empty
 * `expertName` yields a rendition disclosure; anything else (no voice, or an empty name) is a
 * neutral answer with no disclosure.
 */
export function buildAttribution(
  voice: VoiceProfileInput | undefined,
): AttributionInfo {
  const expertName = voice?.expertName;
  if (expertName) {
    return {
      rendition: true,
      expertName,
      disclosureText: `AI rendition of ${expertName}`,
    };
  }
  return { rendition: false, disclosureText: "" };
}
