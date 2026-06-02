import type { Messages } from "@expertos/ui";

/** Admin data-retention sweep page (M13.3): header, policy blurb, preview/sweep controls, results. */
export const en = {
  eyebrow: "Compliance",
  title: "Data retention",
  intro:
    "Enforces the published retention policy. Past their window: temporary uploads, idle conversation history, and aged usage logs are deleted; consultation transcripts are deleted while the consultation record (revenue) is kept; concierge review records are anonymized in place (answer text scrubbed, structural row kept for analytics). Preview is non-destructive; running the sweep applies the changes and is recorded in the audit log.",
  signInError: "Please sign in to continue.",
  previewError: "Failed to load the retention preview.",
  sweepError: "Retention sweep failed.",
  loading: "Loading…",
  eligibleNow: "Eligible now",
  refreshPreview: "Refresh preview",
  runSweep: "Run sweep",
  sweeping: "Sweeping…",
  sweepComplete: "Sweep complete",
  preview: {
    temporaryUploads: "Temporary uploads",
    expiredConversations: "Idle conversations",
    oldUsageLogs: "Old usage logs",
    consultationTranscripts: "Consultation transcripts",
    conciergeRecords: "Concierge records",
  },
  result: {
    temporaryUploads: "Uploads deleted",
    expiredConversations: "Conversations deleted",
    oldUsageLogs: "Usage logs deleted",
    consultationTranscripts: "Transcripts deleted",
    conciergeRecords: "Records anonymized",
  },
} satisfies Messages;

export const vi = {
  eyebrow: "Tuân thủ",
  title: "Lưu giữ dữ liệu",
  intro:
    "Thực thi chính sách lưu giữ đã công bố. Quá thời hạn lưu giữ: các tệp tải lên tạm thời, lịch sử hội thoại không hoạt động và nhật ký sử dụng cũ sẽ bị xóa; bản ghi nội dung tư vấn bị xóa trong khi hồ sơ tư vấn (doanh thu) được giữ lại; hồ sơ đánh giá concierge được ẩn danh tại chỗ (xóa nội dung câu trả lời, giữ lại dòng cấu trúc để phân tích). Xem trước không gây ảnh hưởng; chạy quét sẽ áp dụng thay đổi và được ghi vào nhật ký kiểm toán.",
  signInError: "Vui lòng đăng nhập để tiếp tục.",
  previewError: "Không thể tải bản xem trước lưu giữ.",
  sweepError: "Quét lưu giữ thất bại.",
  loading: "Đang tải…",
  eligibleNow: "Đủ điều kiện hiện tại",
  refreshPreview: "Làm mới xem trước",
  runSweep: "Chạy quét",
  sweeping: "Đang quét…",
  sweepComplete: "Quét hoàn tất",
  preview: {
    temporaryUploads: "Tệp tải lên tạm thời",
    expiredConversations: "Hội thoại không hoạt động",
    oldUsageLogs: "Nhật ký sử dụng cũ",
    consultationTranscripts: "Bản ghi nội dung tư vấn",
    conciergeRecords: "Hồ sơ concierge",
  },
  result: {
    temporaryUploads: "Tệp tải lên đã xóa",
    expiredConversations: "Hội thoại đã xóa",
    oldUsageLogs: "Nhật ký sử dụng đã xóa",
    consultationTranscripts: "Bản ghi đã xóa",
    conciergeRecords: "Hồ sơ đã ẩn danh",
  },
} satisfies Messages;
