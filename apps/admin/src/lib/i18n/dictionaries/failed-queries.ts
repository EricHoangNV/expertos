import type { Messages } from "@expertos/ui";

/**
 * Flagged / low-confidence answers feed (M13.3): the inspector header, per-answer cards with
 * their badges and section labels, empty states, and the paginated "Load more" control.
 */
export const en = {
  eyebrow: "Content roadmap · Inspector",
  title: "Failed queries",
  intro:
    "Answers users flagged as unhelpful or that returned insufficient knowledge — the raw signal for what to write next.",
  emptyFlagged: "No answers have been flagged unhelpful.",
  // Card badges.
  insufficientKnowledge: "Insufficient knowledge",
  confidence: "confidence {value}",
  // Card section labels.
  question: "Question",
  questionMissing: "— (question not found)",
  answer: "Answer",
  reason: "Reason flagged",
  // Per-card action → the draft pipeline.
  draftKnowledge: "Draft knowledge",
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
  eyebrow: "Lộ trình nội dung · Trình kiểm tra",
  title: "Truy vấn thất bại",
  intro:
    "Câu trả lời người dùng gắn cờ không hữu ích hoặc trả về thiếu kiến thức — tín hiệu thô cho biết cần viết gì tiếp theo.",
  emptyFlagged: "Chưa có câu trả lời nào bị gắn cờ không hữu ích.",
  insufficientKnowledge: "Thiếu kiến thức",
  confidence: "độ tin cậy {value}",
  question: "Câu hỏi",
  questionMissing: "— (không tìm thấy câu hỏi)",
  answer: "Câu trả lời",
  reason: "Lý do gắn cờ",
  draftKnowledge: "Soạn kiến thức",
  loadMore: "Tải thêm",
  loading: "Đang tải…",
  errors: {
    signIn: "Vui lòng đăng nhập để tiếp tục.",
    load: "Không tải được câu trả lời bị gắn cờ.",
  },
} satisfies Messages;
