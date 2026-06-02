import type { Messages } from "@expertos/ui";

/** EN/VI strings for the `access-control` admin page (M13.3). Keep `en`/`vi` in lockstep. */
export const en = {
  eyebrow: "System",
  heading: "Access control",
  intro:
    "The admin portal is invite-only. Only the emails below can sign in; each one's role is synced from this list on every sign-in. Removing an entry blocks access on the next sign-in. The consumer app is unaffected.",
  // Add-to-whitelist form.
  emailLabel: "Email",
  emailPlaceholder: "person@example.com",
  roleLabel: "Role",
  roleExpert: "Expert",
  roleAdmin: "Admin",
  add: "Add",
  adding: "Adding…",
  // Table.
  thEmail: "Email",
  thRole: "Role",
  thAddedBy: "Added by",
  thAddedAt: "Added at",
  makeExpert: "Make expert",
  makeAdmin: "Make admin",
  remove: "Remove",
  // Empty state.
  empty: "No emails are whitelisted yet.",
  // Confirmation + notices.
  confirmRemove: "Remove {email} from the admin portal whitelist?",
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
    "Cổng quản trị chỉ dành cho người được mời. Chỉ những email dưới đây mới có thể đăng nhập; vai trò của mỗi email được đồng bộ từ danh sách này mỗi lần đăng nhập. Xóa một mục sẽ chặn truy cập ở lần đăng nhập kế tiếp. Ứng dụng người dùng không bị ảnh hưởng.",
  // Add-to-whitelist form.
  emailLabel: "Email",
  emailPlaceholder: "person@example.com",
  roleLabel: "Vai trò",
  roleExpert: "Chuyên gia",
  roleAdmin: "Quản trị viên",
  add: "Thêm",
  adding: "Đang thêm…",
  // Table.
  thEmail: "Email",
  thRole: "Vai trò",
  thAddedBy: "Người thêm",
  thAddedAt: "Thời điểm thêm",
  makeExpert: "Đổi thành chuyên gia",
  makeAdmin: "Đổi thành quản trị viên",
  remove: "Xóa",
  // Empty state.
  empty: "Chưa có email nào trong danh sách cho phép.",
  // Confirmation + notices.
  confirmRemove: "Xóa {email} khỏi danh sách cho phép của cổng quản trị?",
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
