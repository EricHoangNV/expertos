import type { Messages } from "@expertos/ui";

/** EN/VI strings for the `access-control` admin page (M13.3 + private beta). Keep `en`/`vi` in lockstep. */
export const en = {
  eyebrow: "System",
  heading: "Access control",
  intro:
    "Access is invite-only — this list gates both apps. {user} grants the consumer app only (beta testers, while the beta gate is on). {admin} or {expert} also unlocks the admin portal, and each entry's role syncs from this list on every sign-in. Removing an entry blocks access on the next request.",
  // Add-to-whitelist form.
  emailLabel: "Email",
  emailPlaceholder: "person@example.com",
  roleLabel: "Role",
  roleUser: "User",
  roleExpert: "Expert",
  roleAdmin: "Admin",
  add: "Add",
  adding: "Adding…",
  // Table.
  thEmail: "Email",
  thRole: "Role",
  thAddedBy: "Added by",
  thAddedAt: "Added at",
  remove: "Remove",
  // Empty state.
  empty: "No emails are whitelisted yet.",
  // Confirmation + notices.
  confirmRemove: "Remove {email} from the whitelist?",
  noticeRoleChanged: "{email} is now {role}.",
  noticeRemoved: "Removed {email}.",
  noticeAdded: "Added {email}.",
  // Errors.
  errorEnterEmail: "Enter an email to add.",
  errorSignIn: "Please sign in to continue.",
  errorAdd: "Failed to add the email.",
  errorLoad: "Failed to load the whitelist.",
  errorChangeRole: "Failed to change the role.",
  errorRemove: "Failed to remove the email.",
} satisfies Messages;

export const vi = {
  eyebrow: "Hệ thống",
  heading: "Kiểm soát truy cập",
  intro:
    "Quyền truy cập chỉ dành cho người được mời — danh sách này kiểm soát cả hai ứng dụng. {user} chỉ cấp quyền dùng ứng dụng người dùng (người dùng thử beta, khi cổng beta đang bật). {admin} hoặc {expert} còn mở khóa cổng quản trị, và vai trò của mỗi mục được đồng bộ từ danh sách này mỗi lần đăng nhập. Xóa một mục sẽ chặn truy cập ngay ở yêu cầu kế tiếp.",
  // Add-to-whitelist form.
  emailLabel: "Email",
  emailPlaceholder: "person@example.com",
  roleLabel: "Vai trò",
  roleUser: "Người dùng",
  roleExpert: "Chuyên gia",
  roleAdmin: "Quản trị viên",
  add: "Thêm",
  adding: "Đang thêm…",
  // Table.
  thEmail: "Email",
  thRole: "Vai trò",
  thAddedBy: "Người thêm",
  thAddedAt: "Thời điểm thêm",
  remove: "Xóa",
  // Empty state.
  empty: "Chưa có email nào trong danh sách cho phép.",
  // Confirmation + notices.
  confirmRemove: "Xóa {email} khỏi danh sách cho phép?",
  noticeRoleChanged: "{email} hiện là {role}.",
  noticeRemoved: "Đã xóa {email}.",
  noticeAdded: "Đã thêm {email}.",
  // Errors.
  errorEnterEmail: "Nhập một email để thêm.",
  errorSignIn: "Vui lòng đăng nhập để tiếp tục.",
  errorAdd: "Không thể thêm email.",
  errorLoad: "Không thể tải danh sách cho phép.",
  errorChangeRole: "Không thể thay đổi vai trò.",
  errorRemove: "Không thể xóa email.",
} satisfies Messages;
