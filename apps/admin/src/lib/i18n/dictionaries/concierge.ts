import type { Messages } from "@expertos/ui";

/** String extraction (M13.3) for the `concierge` config-editor admin page. */
export const en = {
  eyebrow: "Concierge mode",
  title: "Human-review trigger",
  subtitle:
    "When the AI is low-confidence, a human expert can step in. Changes take effect on the next chat turn — no deploy.",
  signInRequired: "Please sign in to continue.",
  loadFailed: "Failed to load the concierge config.",
  // Trigger-mode radio cards (M19.3.1).
  triggerMode: "Trigger mode",
  modeOffTitle: "Off",
  modeATitle: "Mode A · User-prompted",
  modeBTitle: "Mode B · Auto-silent",
  // Static metadata badge per mode card.
  badgeNoTrigger: "No trigger",
  badgeActive: "Active",
  badgeAwaitingSignoff: "Awaiting OD#5 sign-off",
  // Description shown beneath each mode card's title.
  modeHelp: {
    off: "No human-review trigger. Low-confidence answers are delivered as-is.",
    userPrompted:
      "Below the confidence threshold, the user is offered a “request human review” option. Opt-in, fully visible.",
    autoSilent:
      "The user sees a normal AI answer while it is quietly queued for human review.",
  },
  // Numeric fields.
  confidenceThreshold: "Confidence threshold (0–1)",
  slaHours: "SLA (hours)",
  volumeCap: "Daily volume cap",
  // Validation messages.
  thresholdInvalid: "Confidence threshold must be a number between 0 and 1.",
  slaInvalid: "SLA must be a whole number of hours ≥ 1.",
  capInvalid: "Daily volume cap must be a whole number ≥ 1.",
  saveFailed: "Save failed.",
  // Save action.
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
} satisfies Messages;

export const vi = {
  eyebrow: "Chế độ hỗ trợ",
  title: "Kích hoạt duyệt bởi người",
  subtitle:
    "Khi AI có độ tin cậy thấp, một chuyên gia có thể can thiệp. Thay đổi có hiệu lực ở lượt trò chuyện kế tiếp — không cần triển khai lại.",
  signInRequired: "Vui lòng đăng nhập để tiếp tục.",
  loadFailed: "Không tải được cấu hình hỗ trợ.",
  triggerMode: "Chế độ kích hoạt",
  modeOffTitle: "Tắt",
  modeATitle: "Chế độ A · Người dùng chủ động",
  modeBTitle: "Chế độ B · Tự động ngầm",
  badgeNoTrigger: "Không kích hoạt",
  badgeActive: "Đang hoạt động",
  badgeAwaitingSignoff: "Chờ phê duyệt OD#5",
  modeHelp: {
    off: "Không kích hoạt duyệt bởi người. Câu trả lời độ tin cậy thấp được gửi nguyên trạng.",
    userPrompted:
      "Dưới ngưỡng độ tin cậy, người dùng được đề nghị tùy chọn “yêu cầu duyệt bởi người”. Chủ động đồng ý, hoàn toàn công khai.",
    autoSilent:
      "Người dùng thấy một câu trả lời AI bình thường trong khi nội dung được lặng lẽ đưa vào hàng đợi duyệt bởi người.",
  },
  confidenceThreshold: "Ngưỡng độ tin cậy (0–1)",
  slaHours: "SLA (giờ)",
  volumeCap: "Giới hạn khối lượng mỗi ngày",
  thresholdInvalid: "Ngưỡng độ tin cậy phải là một số từ 0 đến 1.",
  slaInvalid: "SLA phải là số giờ nguyên ≥ 1.",
  capInvalid: "Giới hạn khối lượng mỗi ngày phải là số nguyên ≥ 1.",
  saveFailed: "Lưu thất bại.",
  save: "Lưu",
  saving: "Đang lưu…",
  saved: "Đã lưu",
} satisfies Messages;
