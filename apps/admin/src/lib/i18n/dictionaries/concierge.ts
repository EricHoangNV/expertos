import type { Messages } from "@expertos/ui";

/** String extraction (M13.3) for the `concierge` config-editor admin page. */
export const en = {
  eyebrow: "Concierge mode",
  title: "Human-review trigger",
  subtitle:
    "When the AI is low-confidence, a human expert can step in. Changes take effect on the next chat turn — no deploy.",
  signInRequired: "Please sign in to continue.",
  loadFailed: "Failed to load the concierge config.",
  // Trigger-mode select control.
  triggerMode: "Trigger mode",
  modeOff: "Off",
  modeUserPrompted: "Mode A — user-prompted",
  modeAutoSilent: "Mode B — auto-silent",
  modeAutoSilentPending: " (pending legal sign-off)",
  // Inline help text shown beneath the mode select.
  modeHelp: {
    off: "No human-review trigger. Low-confidence answers are delivered as-is.",
    userPrompted:
      "Mode A — the chat offers “would you like our team to review this?” and the user opts in.",
    autoSilent:
      "Mode B — the user sees a normal AI answer while it is quietly queued for human review.",
  },
  silentReviewPending:
    "Mode B (silent review) is pending the OD#5 legal/brand sign-off and can’t be enabled yet.",
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
  modeOff: "Tắt",
  modeUserPrompted: "Chế độ A — người dùng chủ động",
  modeAutoSilent: "Chế độ B — tự động ngầm",
  modeAutoSilentPending: " (đang chờ phê duyệt pháp lý)",
  modeHelp: {
    off: "Không kích hoạt duyệt bởi người. Câu trả lời độ tin cậy thấp được gửi nguyên trạng.",
    userPrompted:
      "Chế độ A — cửa sổ trò chuyện đề nghị “bạn có muốn đội ngũ của chúng tôi duyệt nội dung này không?” và người dùng chủ động đồng ý.",
    autoSilent:
      "Chế độ B — người dùng thấy một câu trả lời AI bình thường trong khi nội dung được lặng lẽ đưa vào hàng đợi duyệt bởi người.",
  },
  silentReviewPending:
    "Chế độ B (duyệt ngầm) đang chờ phê duyệt pháp lý/thương hiệu OD#5 và chưa thể bật.",
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
