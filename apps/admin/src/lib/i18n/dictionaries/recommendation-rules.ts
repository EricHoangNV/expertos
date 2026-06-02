import type { Messages } from "@expertos/ui";

/** Funnel recommendation-rules editor (M13.3): header, per-trigger meta, rule controls, validation. */
export const en = {
  eyebrow: "Consultation funnel",
  title: "Recommendation rules",
  subtitle:
    "When to surface an in-chat “book a consultation” prompt. Changes take effect on the next chat turn — no deploy. Higher priority wins when several rules fire on one answer.",
  signInError: "Please sign in to continue.",
  loadError: "Failed to load the recommendation rules.",
  saveFailed: "Save failed.",
  col: {
    trigger: "Trigger",
    configuration: "Configuration",
  },
  trigger: {
    highIntent: {
      label: "High intent",
      help: "A keyword in the user's question shows they want to engage (book, hire, work with you).",
    },
    topic: {
      label: "High-stakes topic",
      help: "A keyword in the question or answer flags a topic best handled by a human (legal, tax, medical).",
    },
    lowConfidence: {
      label: "Low confidence",
      help: "The answer was ungrounded, or cited at most this many sources — offer the human path.",
    },
    depth: {
      label: "Conversation depth",
      help: "The conversation has reached this many assistant turns — an engaged user is a strong candidate.",
    },
  },
  enabled: "Enabled",
  keywordsLabel: "Keywords (one per line)",
  thresholdLabel: "Threshold",
  thresholdPlaceholder: "none",
  priorityLabel: "Priority",
  recommendLabel: "Recommend",
  defaultConsultation: "default consultation",
  inactiveSuffix: " (inactive)",
  priorityError: "Priority must be a whole number ≥ 0.",
  thresholdError: "Threshold must be a whole number ≥ 0.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
} satisfies Messages;

export const vi = {
  eyebrow: "Phễu tư vấn",
  title: "Quy tắc gợi ý",
  subtitle:
    "Thời điểm hiển thị lời mời “đặt lịch tư vấn” ngay trong chat. Thay đổi có hiệu lực ở lượt chat kế tiếp — không cần triển khai. Quy tắc có độ ưu tiên cao hơn sẽ thắng khi nhiều quy tắc cùng kích hoạt trên một câu trả lời.",
  signInError: "Vui lòng đăng nhập để tiếp tục.",
  loadError: "Không thể tải các quy tắc gợi ý.",
  saveFailed: "Lưu thất bại.",
  col: {
    trigger: "Điều kiện kích hoạt",
    configuration: "Cấu hình",
  },
  trigger: {
    highIntent: {
      label: "Ý định cao",
      help: "Một từ khóa trong câu hỏi của người dùng cho thấy họ muốn tương tác (đặt lịch, thuê, hợp tác với bạn).",
    },
    topic: {
      label: "Chủ đề quan trọng",
      help: "Một từ khóa trong câu hỏi hoặc câu trả lời báo hiệu chủ đề nên do con người xử lý (pháp lý, thuế, y tế).",
    },
    lowConfidence: {
      label: "Độ tin cậy thấp",
      help: "Câu trả lời không có căn cứ, hoặc trích dẫn nhiều nhất chừng này nguồn — hãy đề xuất hướng có con người hỗ trợ.",
    },
    depth: {
      label: "Độ sâu hội thoại",
      help: "Cuộc hội thoại đã đạt chừng này lượt trả lời của trợ lý — người dùng đang gắn kết là ứng viên tiềm năng.",
    },
  },
  enabled: "Đã bật",
  keywordsLabel: "Từ khóa (mỗi dòng một từ)",
  thresholdLabel: "Ngưỡng",
  thresholdPlaceholder: "không",
  priorityLabel: "Độ ưu tiên",
  recommendLabel: "Đề xuất",
  defaultConsultation: "tư vấn mặc định",
  inactiveSuffix: " (không hoạt động)",
  priorityError: "Độ ưu tiên phải là số nguyên ≥ 0.",
  thresholdError: "Ngưỡng phải là số nguyên ≥ 0.",
  save: "Lưu",
  saving: "Đang lưu…",
  saved: "Đã lưu",
} satisfies Messages;
