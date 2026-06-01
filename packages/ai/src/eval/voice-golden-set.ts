/**
 * The seed voice-fidelity golden set (M2.4).
 *
 * Each case pairs a question with the facts it must ground on and a distinct expert voice, so the
 * structural layer can prove "voice on top of facts" for several voice shapes: a terse
 * number-first English voice, a warm narrative English voice, a guidelines-only voice (no
 * examples), and a Vietnamese voice (NFC). `expectStyleMarkers` are signature phrases a faithful
 * rendering must surface in the prompt; the live layer (out-of-band) scores whether the generated
 * answer actually reads in that voice.
 *
 * This is the *deterministic, offline* slice. Like the retrieval golden set, ownership/size/
 * refresh of the full voice golden set — and the *product* (expert-signed) voice-fidelity bar — is
 * Open Decision #6 / the open half of #2. The voice profiles here are illustrative fixtures, not
 * any real expert's signed profile (which lands via the M2.3 sign-off workflow + M8.4 authoring).
 */

import type { VoiceGoldenSet } from "./voice-types";

export const VOICE_GOLDEN_SET: VoiceGoldenSet = {
  cases: [
    {
      id: "pricing-terse-en",
      query: "How should I price my SaaS product?",
      facts: [
        {
          chunkId: "pricing#0",
          documentVersionId: "saas-pricing-en",
          content:
            "Anchor the price to the value delivered, offer usage-based tiers, and review them quarterly.",
        },
      ],
      voice: {
        expertName: "Dr. Lan",
        guidelines:
          "Be direct and concise. Lead with the recommendation, then justify in one line. No hedging.",
      },
      voiceExamples: [
        {
          prompt: "Should I discount for annual plans?",
          content: "Yes. Annual prepay trades a small discount for cash and lower churn.",
        },
      ],
      expectStyleMarkers: ["Lead with the recommendation", "Annual prepay"],
      note: "Terse, number-first English voice with one style example.",
    },
    {
      id: "churn-narrative-en",
      query: "How do I reduce monthly churn?",
      facts: [
        {
          chunkId: "churn#0",
          documentVersionId: "saas-churn-en",
          content:
            "Track cohort retention, flag at-risk accounts early, and invest in onboarding and customer success.",
        },
      ],
      voice: {
        expertName: "Mateo",
        guidelines:
          "Warm and narrative. Open with empathy for the founder's situation before giving the steps.",
      },
      expectStyleMarkers: ["Open with empathy"],
      note: "Guidelines-only voice (no style examples) — the no-examples branch.",
    },
    {
      id: "fundraising-vi",
      query: "Cần chuẩn bị những gì để gọi vốn vòng hạt giống?",
      facts: [
        {
          chunkId: "goi-von#0",
          documentVersionId: "goi-von-vi",
          content:
            "Chuẩn bị bộ hồ sơ giới thiệu súc tích, nhắm tới nhà đầu tư phù hợp với giai đoạn và thương lượng mức định giá hợp lý.",
        },
      ],
      voice: {
        expertName: "Chị Mai",
        guidelines: "Nói thẳng vào trọng tâm, dùng ví dụ thực tế và tránh thuật ngữ rườm rà.",
      },
      voiceExamples: [
        {
          prompt: "Định giá bao nhiêu là hợp lý?",
          content: "Đừng neo vào con số, hãy neo vào câu chuyện tăng trưởng của bạn.",
        },
      ],
      language: "vi",
      expectStyleMarkers: ["Nói thẳng vào trọng tâm", "câu chuyện tăng trưởng"],
      note: "Vietnamese (NFC) voice — guidelines + example in Vietnamese.",
    },
  ],
};
