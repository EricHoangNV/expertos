import type { Messages } from "@expertos/ui";

/**
 * Draft review queue + detail/edit (M13.3): the conversation-to-knowledge queue table and the
 * draft editor with its lifecycle actions (Submit / Request changes / Reject / Publish). The
 * `knowledge-drafts` list page and its `[id]` detail page share this namespace.
 */
export const en = {
  // Queue page header.
  eyebrow: "Drafts",
  title: "Conversation-to-knowledge",
  lede: "Drafts authored directly or auto-created from recurring conversation gaps. Submit → expert review → publish.",
  statusFilter: "Status",
  statusAll: "All",
  // Queue table.
  empty: "No drafts in this view.",
  colTitle: "Title",
  colStatus: "Status",
  colLang: "Lang",
  colFromChat: "From chat",
  colUpdated: "Updated",
  fromChatYes: "yes",
  fromChatNo: "—",
  // Detail / editor page.
  detail: {
    back: "← Drafts",
    fallbackTitle: "Draft",
    fromConversation: " · from conversation",
    titleLabel: "Title",
    contentLabel: "Content",
    save: "Save changes",
  },
  // Lifecycle action buttons.
  actions: {
    submit: "Submit for review",
    publish: "Publish",
    requestChanges: "Request changes",
    reject: "Reject",
  },
  // Errors / auth.
  errors: {
    signIn: "Please sign in to continue.",
    loadDrafts: "Failed to load drafts.",
    loadDraft: "Failed to load draft.",
    action: "Action failed.",
  },
} satisfies Messages;

export const vi = {
  eyebrow: "Bản nháp",
  title: "Hội thoại thành kiến thức",
  lede: "Bản nháp được soạn trực tiếp hoặc tự động tạo từ các lỗ hổng hội thoại lặp lại. Gửi → chuyên gia duyệt → xuất bản.",
  statusFilter: "Trạng thái",
  statusAll: "Tất cả",
  empty: "Không có bản nháp nào trong chế độ xem này.",
  colTitle: "Tiêu đề",
  colStatus: "Trạng thái",
  colLang: "Ngôn ngữ",
  colFromChat: "Từ hội thoại",
  colUpdated: "Cập nhật",
  fromChatYes: "có",
  fromChatNo: "—",
  detail: {
    back: "← Bản nháp",
    fallbackTitle: "Bản nháp",
    fromConversation: " · từ hội thoại",
    titleLabel: "Tiêu đề",
    contentLabel: "Nội dung",
    save: "Lưu thay đổi",
  },
  actions: {
    submit: "Gửi để duyệt",
    publish: "Xuất bản",
    requestChanges: "Yêu cầu chỉnh sửa",
    reject: "Từ chối",
  },
  errors: {
    signIn: "Vui lòng đăng nhập để tiếp tục.",
    loadDrafts: "Không tải được bản nháp.",
    loadDraft: "Không tải được bản nháp.",
    action: "Hành động thất bại.",
  },
} satisfies Messages;
