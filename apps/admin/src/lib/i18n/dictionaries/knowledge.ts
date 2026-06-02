import type { Messages } from "@expertos/ui";

/**
 * Knowledge approval board + version detail/history (M13.3): the kanban columns, the status
 * pipeline step indicator, card actions, the Conversation → Knowledge table, and the version
 * history detail page. The `knowledge` list page and its `[id]` detail page share this namespace.
 */
export const en = {
  // Page header.
  eyebrow: "Versioned · Expert-reviewed",
  title: "Knowledge approval",
  newNote: "+ New note",
  // Kanban column / pipeline-step labels (also the status DISPLAY labels on the board).
  columns: {
    draft: "Draft",
    aiProcessing: "AI Processing",
    expertReview: "Expert Review",
    published: "Published",
  },
  // Status pipeline step indicator.
  steps: {
    showAll: "Show all columns",
    showOnly: "Show only {label}",
    note: "→ Archived / Deprecated · every answer records which published version produced it",
  },
  // Kanban cards.
  card: {
    processingStages: "parse → chunk → embed",
    processingProgress: "Processing progress",
    approve: "Approve & publish",
    diff: "Diff",
    versionLive: "v{version} live",
    approvedOn: "approved · {date}",
    published: "published",
    awaitingSubmission: "Awaiting submission for review.",
  },
  // Column body empty state.
  columnEmpty: "Nothing here.",
  // Conversation → Knowledge section.
  convknow: {
    eyebrow: "Conversation → Knowledge",
    title: "Grow the knowledge base from real usage",
    pills: {
      conversation: "Conversation",
      markValuable: "Mark valuable",
      draft: "Draft",
      expertReview: "Expert review",
      publish: "Publish",
    },
    empty: "No conversation-sourced drafts yet.",
    colQuestion: "Recurring question",
    colStatus: "Status",
    colFromChat: "From chat",
    colLang: "Lang",
    colAction: "Action",
    fromChatYes: "yes",
    fromChatNo: "—",
    draftAction: "Draft",
  },
  // Detail / version-history page.
  detail: {
    back: "← Knowledge",
    fallbackTitle: "Document",
    versionCountOne: "{count} version",
    versionCountMany: "{count} versions",
    colVersion: "Version",
    colStatus: "Status",
    colChunks: "Chunks",
    colChangeSummary: "Change summary",
    colCreated: "Created",
    colActions: "Actions",
    live: "live",
    noSummary: "—",
    actions: {
      submit: "Submit for review",
      approve: "Approve & publish",
      requestChanges: "Request changes",
      archive: "Archive",
    },
  },
  // Errors / auth.
  errors: {
    signIn: "Please sign in to continue.",
    loadBoard: "Failed to load knowledge board.",
    approve: "Approve failed.",
    loadDocument: "Failed to load document.",
    action: "Action failed.",
  },
} satisfies Messages;

export const vi = {
  eyebrow: "Có phiên bản · Chuyên gia duyệt",
  title: "Duyệt kiến thức",
  newNote: "+ Ghi chú mới",
  columns: {
    draft: "Bản nháp",
    aiProcessing: "AI xử lý",
    expertReview: "Chuyên gia duyệt",
    published: "Đã xuất bản",
  },
  steps: {
    showAll: "Hiện tất cả cột",
    showOnly: "Chỉ hiện {label}",
    note: "→ Lưu trữ / Ngừng dùng · mỗi câu trả lời đều ghi lại phiên bản đã xuất bản tạo ra nó",
  },
  card: {
    processingStages: "phân tích → chia khối → nhúng",
    processingProgress: "Tiến độ xử lý",
    approve: "Duyệt & xuất bản",
    diff: "So sánh",
    versionLive: "v{version} đang hoạt động",
    approvedOn: "đã duyệt · {date}",
    published: "đã xuất bản",
    awaitingSubmission: "Đang chờ gửi để duyệt.",
  },
  columnEmpty: "Chưa có gì ở đây.",
  convknow: {
    eyebrow: "Hội thoại → Kiến thức",
    title: "Mở rộng cơ sở kiến thức từ thực tế sử dụng",
    pills: {
      conversation: "Hội thoại",
      markValuable: "Đánh dấu giá trị",
      draft: "Bản nháp",
      expertReview: "Chuyên gia duyệt",
      publish: "Xuất bản",
    },
    empty: "Chưa có bản nháp nào từ hội thoại.",
    colQuestion: "Câu hỏi lặp lại",
    colStatus: "Trạng thái",
    colFromChat: "Từ hội thoại",
    colLang: "Ngôn ngữ",
    colAction: "Hành động",
    fromChatYes: "có",
    fromChatNo: "—",
    draftAction: "Soạn nháp",
  },
  detail: {
    back: "← Kiến thức",
    fallbackTitle: "Tài liệu",
    versionCountOne: "{count} phiên bản",
    versionCountMany: "{count} phiên bản",
    colVersion: "Phiên bản",
    colStatus: "Trạng thái",
    colChunks: "Khối",
    colChangeSummary: "Tóm tắt thay đổi",
    colCreated: "Ngày tạo",
    colActions: "Hành động",
    live: "đang hoạt động",
    noSummary: "—",
    actions: {
      submit: "Gửi để duyệt",
      approve: "Duyệt & xuất bản",
      requestChanges: "Yêu cầu chỉnh sửa",
      archive: "Lưu trữ",
    },
  },
  errors: {
    signIn: "Vui lòng đăng nhập để tiếp tục.",
    loadBoard: "Không tải được bảng kiến thức.",
    approve: "Duyệt thất bại.",
    loadDocument: "Không tải được tài liệu.",
    action: "Hành động thất bại.",
  },
} satisfies Messages;
