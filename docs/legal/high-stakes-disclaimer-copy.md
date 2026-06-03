# High-Stakes Disclaimer & Consultation-Routing Copy — DRAFT

> **Status: DRAFT awaiting PM/legal sign-off (NT.4 human gate).**
> The detector, disclaimer rendering, and consultation routing are built and tested
> (`packages/ai/src/high-stakes/`, surfaced via `ChatService`; copy single-sourced in
> `packages/shared/src/chat.ts` → `HIGH_STAKES_DISCLAIMERS`). This document is the copy + ToS package
> for review. Signing off on the wording and ToS coverage closes NT.4 / M11.4.

---

## 1. When the disclaimer fires

A deterministic detector classifies a question as **high-stakes** when it touches **financial, legal,
medical, or tax** topics, in **English or Vietnamese** (whole-word matching over the shared tokenizer
— no LLM, so it is predictable and auditable). When it fires:

1. The AI answer is scoped to **educational/informational context** by a system-prompt rule.
2. The **disclaimer** (below) is rendered directly under the answer — on both the live turn **and** the
   saved history view, so it never disappears.
3. The **"book a consultation" CTA** is surfaced alongside it (the consultation funnel's topic trigger
   fires on the same detection), so every disclaimer is paired with an actionable next step.

The answer is also flagged `high_stakes` in the data model (on `messages` and `usage_logs`) for audit.

> **Legal decision needed:** confirm the four covered categories (financial / legal / medical / tax)
> are the right scope, and whether any additional category (e.g. safety, immigration, mental-health
> crisis) must trigger a disclaimer or a stronger intervention.

## 2. Disclaimer copy (for sign-off)

### English (canonical)

> This response is AI-generated for informational purposes only and does not constitute professional
> financial, legal, medical, or tax advice. For decisions with significant financial, legal, or health
> consequences, consider booking a consultation for guidance tailored to your situation.

### Vietnamese

> Phản hồi này do AI tạo ra và chỉ nhằm mục đích cung cấp thông tin, không phải là tư vấn chuyên môn về
> tài chính, pháp lý, y tế hoặc thuế. Đối với các quyết định có hậu quả đáng kể về tài chính, pháp lý
> hoặc sức khỏe, hãy cân nhắc đặt lịch tư vấn để được hướng dẫn phù hợp với tình huống của bạn.

> **Note.** The two translations are single-sourced together in code specifically so this review can
> sign off both languages in one place and they can never drift apart. The Vietnamese is a faithful
> rendering of the English — confirm it reads naturally and carries the same legal weight.

## 3. Points to confirm on the wording

- [ ] **"does not constitute professional … advice"** — is this the disclaimer language legal wants, or
      should it be stronger (e.g. "should not be relied upon," "consult a licensed professional")?
- [ ] **Medical specificity** — for medical topics, do we need an explicit "not a substitute for
      professional medical advice; in an emergency contact local emergency services" line? Today one
      disclaimer covers all four categories. Legal may want a category-specific variant for medical.
- [ ] **"AI-generated"** — confirm this framing is sufficient disclosure (it pairs with the OD#5
      concierge "AI-reviewed/edited" indicator on reviewed answers).
- [ ] **CTA tone** — "consider booking a consultation" is a soft nudge. Confirm we don't want a harder
      "we recommend you consult a professional" for high-stakes specifically.

## 4. Terms of Service coverage (the other half of NT.4)

The disclaimer is the in-product surface; the ToS must back it. Confirm the ToS contains, or add:

- [ ] **Educational-use clause** — the service provides general, AI-generated educational information,
      not professional advice, and creates no professional (attorney/doctor/financial-adviser) relationship.
- [ ] **No-reliance / limitation-of-liability** clause covering decisions made on AI answers, especially
      in the four high-stakes categories.
- [ ] **AI-generated & AI-reviewed disclosure** — answers are AI-generated and may be reviewed/edited by
      experts (ties to OD#5 / NT.1, already approved); accuracy is not guaranteed.
- [ ] **Consultation terms** — that booking a consultation is a separate paid service with its own terms.
- [ ] **Jurisdiction note** — if we serve VN + other markets, confirm the disclaimer/ToS satisfy each
      market's advertising/advice rules (esp. medical and financial in Vietnam).

## 5. Open items for the approver (checklist)

- [ ] Approve the English disclaimer wording (or provide edits → update `HIGH_STAKES_DISCLAIMERS.en`).
- [ ] Approve the Vietnamese disclaimer wording (or provide edits → update `HIGH_STAKES_DISCLAIMERS.vi`).
- [ ] Confirm the four covered categories, or extend the detector's category list.
- [ ] Decide whether medical needs a stronger / category-specific disclaimer.
- [ ] Confirm ToS covers §4; draft any missing clauses.
- [ ] Sign off → mark NT.4 `[x]` and M11.4 progress.

> **Where edits land:** any wording change is a one-line edit per language in
> `packages/shared/src/chat.ts` (`HIGH_STAKES_DISCLAIMERS`); it propagates to the live chat and history
> views automatically. No other code changes needed. Adding a category means extending the detector's
> term list in `packages/ai/src/high-stakes/`.
