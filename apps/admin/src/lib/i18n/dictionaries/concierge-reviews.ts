import type { Messages } from "@expertos/ui";

/** Expert-portal concierge review queue (M13.3): two-pane queue + review detail. */
export const en = {
  eyebrow: "Concierge · human-in-the-loop",
  title: "Review queue",
  subtitle:
    "Answers flagged for human review, most-urgent first. Open one to see the question and full answer, record a verdict, and optionally push a refined update.",

  expertLabel: "Expert",
  selectExpertPlaceholder: "Select an expert…",
  selectExpertPrompt: "Select an expert to review their queue.",

  signInError: "Please sign in to continue.",
  loadQueueError: "Failed to load the review queue.",
  loadReviewError: "Failed to load the review.",
  recordVerdictError: "Failed to record the verdict.",
  escalateError: "Failed to escalate the review.",

  queueAriaLabel: "Review queue",
  queueOpenCount: "Queue · {count} open",
  slaChip: "SLA {hours}h",

  filterAriaLabel: "Filter reviews",
  tabOpen: "Open",
  tabMine: "Mine",
  tabDone: "Done",

  loading: "Loading…",
  emptyOpen: "Nothing awaiting review.",
  emptyMine: "No claimed reviews.",
  emptyDone: "No completed reviews yet.",
  loadMore: "Load more",

  // Queue-item badges.
  modeAuto: "Auto · silent",
  modeUserPrompted: "User-prompted",
  confShort: "conf {score}",

  reviewDetailAriaLabel: "Review detail",
  selectReviewPrompt: "Select a review to see the question, answer, and verdict.",

  // Detail header badges.
  confidence: "Confidence {score}",
  sla: "SLA {label}",
  slaLeft: "{span} left",
  slaOverdue: "{span} overdue",

  // Elapsed-time labels (queue item).
  minutesAgo: "{minutes}m ago",
  hoursAgo: "{hours}h ago",
  daysAgo: "{days}d ago",

  // User question section.
  userQuestion: "User question",
  questionNotFound: "— (question not found)",
  lowConfidenceNote: "Low retrieval confidence ({score}).",
  flaggedNote: "Flagged for human review.",
  silentNote: "Silent shadow review — the user already saw a hedged answer.",
  visibleNote: "User-visible — the user opted in to a human review.",

  // AI answer section.
  aiAnswerLabel: "AI answer · user saw this",
  aiRendition: "AI rendition",
  lowConfidenceBadge: "low confidence",

  // Previous responses.
  previousResponses: "Previous responses",
  edited: "edited",
  delivered: "delivered",

  // Verdict cards.
  yourVerdict: "Your verdict",
  verdictBadName: "Bad",
  verdictBadNote: "Flags the source chunks",
  verdictGoodName: "Good",
  verdictGoodNote: "Deliver as-is",
  verdictGreatName: "Great",
  verdictGreatNote: "→ becomes a voice example",

  // Refined answer.
  refinedAnswer: "Refined answer",
  notesLabel: "Notes (optional)",
  flywheelImmediate: "immediate",
  flywheelGlobal: "global",
  flywheelNotePrefix: "Reviewer-feedback flywheel: ",
  flywheelImmediateDesc: " — injected into this conversation’s context; ",
  flywheelGlobalDesc: " — great/edited answers feed future retrieval & voice examples.",

  // Action bar.
  saving: "Saving…",
  pushRefined: "Push refined update",
  recordVerdict: "Record verdict",
  escalate: "Escalate to paid consultation",
  notifyNote: "User notified by email on delivery.",
} satisfies Messages;

export const vi = {
  eyebrow: "Hỗ trợ · có con người tham gia",
  title: "Hàng đợi kiểm duyệt",
  subtitle:
    "Các câu trả lời được gắn cờ chờ con người kiểm duyệt, khẩn cấp nhất trước. Mở một mục để xem câu hỏi và toàn bộ câu trả lời, ghi nhận đánh giá, và tùy chọn đẩy bản cập nhật đã tinh chỉnh.",

  expertLabel: "Chuyên gia",
  selectExpertPlaceholder: "Chọn một chuyên gia…",
  selectExpertPrompt: "Chọn một chuyên gia để kiểm duyệt hàng đợi của họ.",

  signInError: "Vui lòng đăng nhập để tiếp tục.",
  loadQueueError: "Không thể tải hàng đợi kiểm duyệt.",
  loadReviewError: "Không thể tải mục kiểm duyệt.",
  recordVerdictError: "Không thể ghi nhận đánh giá.",
  escalateError: "Không thể chuyển mục kiểm duyệt lên cấp cao hơn.",

  queueAriaLabel: "Hàng đợi kiểm duyệt",
  queueOpenCount: "Hàng đợi · {count} đang mở",
  slaChip: "SLA {hours}h",

  filterAriaLabel: "Lọc các mục kiểm duyệt",
  tabOpen: "Đang mở",
  tabMine: "Của tôi",
  tabDone: "Đã xong",

  loading: "Đang tải…",
  emptyOpen: "Không có mục nào chờ kiểm duyệt.",
  emptyMine: "Chưa có mục nào được nhận xử lý.",
  emptyDone: "Chưa có mục kiểm duyệt nào hoàn tất.",
  loadMore: "Tải thêm",

  modeAuto: "Tự động · ngầm",
  modeUserPrompted: "Người dùng yêu cầu",
  confShort: "tin cậy {score}",

  reviewDetailAriaLabel: "Chi tiết kiểm duyệt",
  selectReviewPrompt: "Chọn một mục để xem câu hỏi, câu trả lời và đánh giá.",

  confidence: "Độ tin cậy {score}",
  sla: "SLA {label}",
  slaLeft: "còn {span}",
  slaOverdue: "quá hạn {span}",

  minutesAgo: "{minutes} phút trước",
  hoursAgo: "{hours} giờ trước",
  daysAgo: "{days} ngày trước",

  userQuestion: "Câu hỏi của người dùng",
  questionNotFound: "— (không tìm thấy câu hỏi)",
  lowConfidenceNote: "Độ tin cậy truy xuất thấp ({score}).",
  flaggedNote: "Được gắn cờ chờ con người kiểm duyệt.",
  silentNote: "Kiểm duyệt ngầm — người dùng đã thấy câu trả lời thận trọng.",
  visibleNote: "Hiển thị cho người dùng — người dùng đã chọn nhờ con người kiểm duyệt.",

  aiAnswerLabel: "Câu trả lời AI · người dùng đã thấy nội dung này",
  aiRendition: "Bản AI tạo",
  lowConfidenceBadge: "độ tin cậy thấp",

  previousResponses: "Phản hồi trước đó",
  edited: "đã chỉnh sửa",
  delivered: "đã gửi",

  yourVerdict: "Đánh giá của bạn",
  verdictBadName: "Kém",
  verdictBadNote: "Gắn cờ các đoạn nguồn",
  verdictGoodName: "Tốt",
  verdictGoodNote: "Gửi nguyên trạng",
  verdictGreatName: "Xuất sắc",
  verdictGreatNote: "→ trở thành ví dụ giọng văn",

  refinedAnswer: "Câu trả lời đã tinh chỉnh",
  notesLabel: "Ghi chú (tùy chọn)",
  flywheelImmediate: "tức thời",
  flywheelGlobal: "toàn cục",
  flywheelNotePrefix: "Vòng phản hồi của người kiểm duyệt: ",
  flywheelImmediateDesc: " — đưa vào ngữ cảnh của cuộc hội thoại này; ",
  flywheelGlobalDesc:
    " — các câu trả lời xuất sắc/đã chỉnh sửa sẽ bổ sung cho truy xuất và ví dụ giọng văn về sau.",

  saving: "Đang lưu…",
  pushRefined: "Đẩy bản cập nhật đã tinh chỉnh",
  recordVerdict: "Ghi nhận đánh giá",
  escalate: "Chuyển lên tư vấn trả phí",
  notifyNote: "Người dùng được thông báo qua email khi gửi.",
} satisfies Messages;
