import type { Locale, Messages } from "@expertos/ui";

/**
 * EN/VI message catalogs for the consumer web app (M13.1). The framework (dot-path lookup +
 * `{placeholder}` interpolation) lives in `@expertos/ui` (`translate`/`createTranslator`); this
 * file is the app-owned copy. M13.1 establishes the loop with a representative `chat` namespace;
 * M13.2 fills in the remaining `/chat`, `/history`, and `/account` strings against this same shape.
 *
 * Keep EN and VI in lockstep — every key present in `en` must exist in `vi`, or the VI UI falls
 * back to the key token (visible, greppable) for the missing string.
 */

const en = {
  chat: {
    emptyTitle: "Start a new conversation",
    emptyDescription:
      "Ask anything about your business — answers are grounded in published expert knowledge, with sources you can check.",
    askPlaceholder: "Ask {name} anything about your business…",
    askPlaceholderGeneric: "Ask anything about your business…",
  },
} satisfies Messages;

const vi = {
  chat: {
    emptyTitle: "Bắt đầu cuộc trò chuyện mới",
    emptyDescription:
      "Hỏi bất cứ điều gì về doanh nghiệp của bạn — câu trả lời dựa trên kiến thức chuyên gia đã xuất bản, kèm nguồn bạn có thể kiểm chứng.",
    askPlaceholder: "Hỏi {name} bất cứ điều gì về doanh nghiệp của bạn…",
    askPlaceholderGeneric: "Hỏi bất cứ điều gì về doanh nghiệp của bạn…",
  },
} satisfies Messages;

/** The message catalog for each supported locale. */
export const MESSAGES: Record<Locale, Messages> = { en, vi };
