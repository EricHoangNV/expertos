import type { Messages } from "@expertos/ui";

/**
 * Flagged / low-confidence answers feed (M13.3): the inspector header, per-answer cards with
 * their badges and section labels, empty states, and the paginated "Load more" control.
 */
export const en = {
  eyebrow: "Quality",
  title: "Flagged answers",
  intro:
    "Answers users rated unhelpful, newest first — across all tenants. Triage these to feed weak answers back into knowledge.",
  emptyFlagged: "No answers have been flagged unhelpful.",
  // Card badges.
  insufficientKnowledge: "Insufficient knowledge",
  confidence: "confidence {value}",
  // Card section labels.
  question: "Question",
  questionMissing: "— (question not found)",
  answer: "Answer",
  reason: "Reason",
  // Pagination.
  loadMore: "Load more",
  loading: "Loading…",
  // Errors / auth.
  errors: {
    signIn: "Please sign in to continue.",
    load: "Failed to load flagged answers.",
  },
} satisfies Messages;

export const vi = {
  eyebrow: "Chất lượng",
  title: "Câu trả lời bị gắn cờ",
  intro:
    "Câu trả lời người dùng đánh giá không hữu ích, mới nhất trước — trên tất cả khách hàng. Phân loại để đưa các câu trả lời yếu trở lại kiến thức.",
  emptyFlagged: "Chưa có câu trả lời nào bị gắn cờ không hữu ích.",
  insufficientKnowledge: "Thiếu kiến thức",
  confidence: "độ tin cậy {value}",
  question: "Câu hỏi",
  questionMissing: "— (không tìm thấy câu hỏi)",
  answer: "Câu trả lời",
  reason: "Lý do",
  loadMore: "Tải thêm",
  loading: "Đang tải…",
  errors: {
    signIn: "Vui lòng đăng nhập để tiếp tục.",
    load: "Không tải được câu trả lời bị gắn cờ.",
  },
} satisfies Messages;
