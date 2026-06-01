import { tokenize } from "../text";
import {
  HIGH_STAKES_CATEGORIES,
  type HighStakesCategory,
  type HighStakesResult,
} from "./types";

/**
 * The high-stakes-topic detector (NT.4, PRD §"Non-Technical Requirements"). Pure and deterministic
 * — like {@link buildAnswerPrompt} and {@link evaluateRecommendation} — so the disclaimer gate, the
 * educational-scope prompt rule, and the `high_stakes` usage log all hang off one offline-testable
 * signal that can never drift between them.
 *
 * Matching reuses the shared {@link tokenize} (the same NFC + lowercase letter/number tokenizer the
 * embedder, keyword retrieval, and recommendation engine use), so a term hits whole-word only ("tax"
 * matches "income tax" but not "syntax"), a multi-word phrase matches a contiguous run, and
 * Vietnamese diacritics stay whole (directive §36). The keyword lists are intentionally broad —
 * this is a liability gate, so over-disclaiming is the safe failure (PRD: append the disclaimer +
 * consultation CTA "when triggered"). Returns null when nothing matches (the common case).
 */
export function detectHighStakes(text: string): HighStakesResult | null {
  // One pass over the tokenized text, wrapped in spaces so a whole-word/phrase check is a substring
  // test against token boundaries (the same trick {@link evaluateRecommendation} uses).
  const hay = ` ${tokenize(text).join(" ")} `;
  const categories: HighStakesCategory[] = [];
  const matchedTerms: string[] = [];

  for (const category of HIGH_STAKES_CATEGORIES) {
    let matchedInCategory = false;
    for (const term of CATEGORY_KEYWORDS[category]) {
      // Every curated term tokenizes to ≥ 1 token, so the joined needle is always non-empty.
      const needle = tokenize(term).join(" ");
      if (hay.includes(` ${needle} `)) {
        matchedInCategory = true;
        if (!matchedTerms.includes(term)) {
          matchedTerms.push(term);
        }
      }
    }
    if (matchedInCategory) {
      categories.push(category);
    }
  }

  return categories.length > 0 ? { categories, matchedTerms } : null;
}

/**
 * Curated high-stakes terms per category, EN + VI (the platform's two languages — OD#9). Tokenized
 * before matching, so an accented VI phrase ("đầu tư") matches whole-word like an EN one. Kept
 * deliberately broad: a missed disclaimer is the costly failure, an extra one merely cautious.
 */
const CATEGORY_KEYWORDS: Record<HighStakesCategory, string[]> = {
  financial: [
    // EN
    "invest",
    "investment",
    "investing",
    "investments",
    "stock",
    "stocks",
    "portfolio",
    "retirement",
    "pension",
    "mortgage",
    "loan",
    "loans",
    "debt",
    "refinance",
    "crypto",
    "cryptocurrency",
    "savings",
    "bankruptcy",
    "insurance",
    "interest rate",
    "capital gains",
    // VI
    "đầu tư",
    "cổ phiếu",
    "chứng khoán",
    "vay",
    "nợ",
    "bảo hiểm",
    "hưu trí",
    "thế chấp",
    "tiết kiệm",
  ],
  legal: [
    // EN
    "legal",
    "lawsuit",
    "sue",
    "suing",
    "sued",
    "lawyer",
    "attorney",
    "court",
    "contract",
    "liability",
    "custody",
    "divorce",
    "patent",
    "trademark",
    "copyright",
    "defamation",
    "intellectual property",
    // VI
    "pháp lý",
    "kiện",
    "luật sư",
    "hợp đồng",
    "ly hôn",
    "tòa án",
    "bản quyền",
  ],
  medical: [
    // EN
    "medical",
    "medication",
    "medicine",
    "diagnosis",
    "diagnose",
    "symptom",
    "symptoms",
    "disease",
    "prescription",
    "dose",
    "dosage",
    "treatment",
    "therapy",
    "surgery",
    "doctor",
    "depression",
    "anxiety",
    // VI
    "thuốc",
    "bệnh",
    "triệu chứng",
    "chẩn đoán",
    "bác sĩ",
    "điều trị",
    "phẫu thuật",
  ],
  tax: [
    // EN
    "tax",
    "taxes",
    "taxable",
    "irs",
    "deduction",
    "deductions",
    "vat",
    "withholding",
    "audit",
    // VI
    "thuế",
    "khấu trừ",
    "quyết toán",
  ],
};
