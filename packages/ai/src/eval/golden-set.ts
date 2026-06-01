/**
 * The seed retrieval golden set (M1.3 / Open Decision #9).
 *
 * Twelve short knowledge documents across distinct topics — English, Vietnamese (NFC), and
 * mixed EN-VI — with queries whose only *intended* match is one document, so recall/MRR are
 * meaningful (top-K = 8 < corpus size, so ranking has to work). It deliberately includes a
 * Vietnamese case whose query is supplied in decomposed (NFD) form against an NFC corpus: it
 * passes only because every retrieval boundary NFC-normalizes (see `normalizeText`), and fails
 * loudly if that regresses.
 *
 * This is the *deterministic, offline* slice of the eval set. It is intentionally lexical:
 * the offline {@link HashingEmbeddingProvider} captures word overlap only, so cross-lingual
 * semantic recall (e.g. an English query retrieving Vietnamese knowledge with no shared words)
 * is NOT represented here and is measured out-of-band against the real multilingual model with
 * this same fixture format. Owner/size/refresh of the full golden set is Open Decision #6.
 */

import type { EvalGoldenSet } from "./types";

export const RETRIEVAL_GOLDEN_SET: EvalGoldenSet = {
  documents: [
    {
      id: "saas-pricing-en",
      language: "en",
      content:
        "SaaS pricing strategy: choose between per-seat pricing and usage-based pricing tiers. " +
        "Anchor the price to the value delivered, run pricing experiments, and review your tiers quarterly.",
    },
    {
      id: "saas-churn-en",
      language: "en",
      content:
        "Reducing SaaS churn: track cohort retention, flag at-risk accounts early, and invest in " +
        "onboarding and customer success so monthly churn stays low.",
    },
    {
      id: "fundraising-en",
      language: "en",
      content:
        "Raising a seed round: build a concise pitch deck, target investors who fund your stage, " +
        "and negotiate a fair valuation cap on the SAFE.",
    },
    {
      id: "hiring-en",
      language: "en",
      content:
        "Hiring your first engineers: write clear role scopes, run structured interviews, and " +
        "protect for culture as the team scales.",
    },
    {
      id: "tax-vat-en",
      language: "en",
      content:
        "VAT registration: once revenue crosses the registration threshold you must register, " +
        "charge VAT on invoices, and file returns on time.",
    },
    {
      id: "security-en",
      language: "en",
      content:
        "Application security basics: enforce least privilege, rotate secrets regularly, and add " +
        "prompt-injection regression tests to your pipeline.",
    },
    {
      id: "analytics-en",
      language: "en",
      content:
        "Product analytics: instrument key events, build a funnel from signup to activation, and " +
        "track weekly active users as your north-star metric.",
    },
    {
      id: "dinh-gia-saas-vi",
      language: "vi",
      content:
        "Định giá sản phẩm SaaS: lựa chọn giữa tính phí theo người dùng và theo mức sử dụng. " +
        "Neo giá vào giá trị mang lại, thử nghiệm giá và rà soát các gói giá hằng quý.",
    },
    {
      id: "giu-chan-khach-vi",
      language: "vi",
      content:
        "Giữ chân khách hàng SaaS: theo dõi tỷ lệ duy trì theo nhóm, phát hiện sớm khách hàng có " +
        "nguy cơ rời bỏ, và đầu tư vào trải nghiệm để giảm tỷ lệ rời bỏ hằng tháng.",
    },
    {
      id: "thue-gtgt-vi",
      language: "vi",
      content:
        "Đăng ký thuế giá trị gia tăng: khi doanh thu vượt ngưỡng đăng ký, doanh nghiệp phải đăng " +
        "ký, xuất hóa đơn có thuế GTGT và nộp tờ khai đúng hạn.",
    },
    {
      id: "goi-von-vi",
      language: "vi",
      content:
        "Gọi vốn vòng hạt giống: chuẩn bị bộ hồ sơ giới thiệu súc tích, nhắm tới nhà đầu tư phù " +
        "hợp với giai đoạn và thương lượng mức định giá hợp lý.",
    },
    {
      id: "onboarding-mixed",
      language: "vi",
      content:
        "Onboarding khách hàng mới: gửi email chào mừng, hướng dẫn người dùng qua các bước setup, " +
        "và đo lường activation trong tuần đầu tiên.",
    },
  ],
  cases: [
    {
      id: "en-pricing",
      language: "en",
      query: "How should I price my SaaS product and structure the pricing tiers?",
      relevantDocIds: ["saas-pricing-en"],
      note: "English lexical retrieval against an English corpus.",
    },
    {
      id: "en-churn",
      language: "en",
      query: "How do I reduce monthly churn and improve retention for my SaaS?",
      relevantDocIds: ["saas-churn-en"],
      note: "Disambiguates from the pricing doc despite the shared 'SaaS' token.",
    },
    {
      id: "vi-pricing-nfc",
      language: "vi",
      query: "Làm thế nào để định giá sản phẩm SaaS và xây dựng các gói giá?",
      relevantDocIds: ["dinh-gia-saas-vi"],
      note: "Vietnamese (NFC) lexical retrieval against a Vietnamese corpus.",
    },
    {
      id: "vi-pricing-nfd",
      // Same query as vi-pricing-nfc but supplied in decomposed (NFD) form: the corpus is NFC,
      // so this only retrieves because every boundary NFC-normalizes (Open Decision #9 fix).
      language: "vi",
      query: "Làm thế nào để định giá sản phẩm SaaS và xây dựng các gói giá?".normalize("NFD"),
      relevantDocIds: ["dinh-gia-saas-vi"],
      note: "Normalization regression guard: NFD query must match the NFC document.",
    },
    {
      id: "vi-tax",
      language: "vi",
      query: "Khi nào doanh nghiệp phải đăng ký thuế GTGT?",
      relevantDocIds: ["thue-gtgt-vi"],
      note: "Vietnamese tax query.",
    },
    {
      id: "vi-fundraising",
      language: "vi",
      query: "Cần chuẩn bị những gì để gọi vốn vòng hạt giống?",
      relevantDocIds: ["goi-von-vi"],
      note: "Vietnamese fundraising query.",
    },
    {
      id: "mixed-onboarding",
      language: "vi",
      query: "Quy trình onboarding khách hàng mới gồm những bước nào?",
      relevantDocIds: ["onboarding-mixed"],
      note: "Mixed EN-VI document retrieved by a mixed-language query.",
    },
  ],
};
