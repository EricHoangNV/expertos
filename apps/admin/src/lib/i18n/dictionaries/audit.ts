import type { Messages } from "@expertos/ui";

/** Admin audit-log feed (M13.3): page header, table headers, empty/error states. */
export const en = {
  eyebrow: "Every privileged action, recorded",
  title: "Audit log",
  subtitle: "Who did what, when. Immutable — for compliance and incident review.",
  empty: "No admin actions recorded yet.",
  signInError: "Please sign in to continue.",
  loadError: "Failed to load the audit log.",
  actorDeleted: "(deleted)",
  loading: "Loading…",
  loadMore: "Load more",
  col: {
    when: "When",
    actor: "Actor",
    action: "Action",
    target: "Target",
    detail: "Detail",
  },
} satisfies Messages;

export const vi = {
  eyebrow: "Mọi hành động đặc quyền đều được ghi lại",
  title: "Nhật ký kiểm toán",
  subtitle: "Ai đã làm gì, khi nào. Bất biến — phục vụ tuân thủ và điều tra sự cố.",
  empty: "Chưa có hành động quản trị nào được ghi nhận.",
  signInError: "Vui lòng đăng nhập để tiếp tục.",
  loadError: "Không thể tải nhật ký kiểm toán.",
  actorDeleted: "(đã xóa)",
  loading: "Đang tải…",
  loadMore: "Tải thêm",
  col: {
    when: "Thời điểm",
    actor: "Người thực hiện",
    action: "Hành động",
    target: "Đối tượng",
    detail: "Chi tiết",
  },
} satisfies Messages;
