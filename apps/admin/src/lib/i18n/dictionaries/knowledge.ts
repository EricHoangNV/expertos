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
    back: "← Back to knowledge",
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
    draft: "draft",
    noSummary: "—",
    actions: {
      submit: "Submit for review",
      approve: "Approve & publish",
      requestChanges: "Request changes",
      archive: "Archive",
    },
    edit: {
      open: "Edit content",
      title: "Edit draft content",
      hint: "Saving re-chunks and re-embeds this version. Only drafts can be edited.",
      save: "Save changes",
      saving: "Saving…",
      cancel: "Cancel",
      saved: "Saved — re-chunked into {count} chunks.",
    },
  },
  // Errors / auth.
  errors: {
    signIn: "Please sign in to continue.",
    loadBoard: "Failed to load knowledge board.",
    approve: "Approve failed.",
    loadDocument: "Failed to load document.",
    action: "Action failed.",
    loadContent: "Failed to load content.",
    saveContent: "Failed to save content.",
  },
} satisfies Messages;

export const vi = {
  eyebrow: "Có phiên bản · Chuyên gia duyệt",
  title: "Duyệt kiến thức",
  newNote: "+ Ghi chú mới",
  columns: {
    draft: "Bản nháp",
    expertReview: "Chuyên gia duyệt",
    published: "Đã xuất bản",
  },
  steps: {
    showAll: "Hiện tất cả cột",
    showOnly: "Chỉ hiện {label}",
    note: "→ Lưu trữ / Ngừng dùng · mỗi câu trả lời đều ghi lại phiên bản đã xuất bản tạo ra nó",
  },
  card: {
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
    back: "← Quay lại Kiến thức",
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
    draft: "bản nháp",
    noSummary: "—",
    actions: {
      submit: "Gửi để duyệt",
      approve: "Duyệt & xuất bản",
      requestChanges: "Yêu cầu chỉnh sửa",
      archive: "Lưu trữ",
    },
    edit: {
      open: "Sửa nội dung",
      title: "Sửa nội dung bản nháp",
      hint: "Khi lưu, phiên bản này sẽ được chia khối và nhúng lại. Chỉ sửa được bản nháp.",
      save: "Lưu thay đổi",
      saving: "Đang lưu…",
      cancel: "Hủy",
      saved: "Đã lưu — chia thành {count} khối.",
    },
  },
  errors: {
    signIn: "Vui lòng đăng nhập để tiếp tục.",
    loadBoard: "Không tải được bảng kiến thức.",
    approve: "Duyệt thất bại.",
    loadDocument: "Không tải được tài liệu.",
    action: "Hành động thất bại.",
    loadContent: "Không tải được nội dung.",
    saveContent: "Lưu nội dung thất bại.",
  },
} satisfies Messages;
