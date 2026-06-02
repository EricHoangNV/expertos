import type { Messages } from "@expertos/ui";

/** Admin audit-log feed (M13.3): page header, table headers, empty/error states. */
export const en = {
  eyebrow: "Security",
  title: "Audit log",
  subtitle:
    "Every admin mutation — role changes, fair-use flags, deletions — newest first. Immutable and append-only.",
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
  eyebrow: "Bảo mật",
  title: "Nhật ký kiểm toán",
  subtitle:
    "Mọi thay đổi của quản trị viên — đổi vai trò, gắn cờ sử dụng hợp lý, xóa dữ liệu — mới nhất trước. Bất biến và chỉ ghi thêm.",
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
