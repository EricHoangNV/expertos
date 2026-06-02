import type { Messages } from "@expertos/ui";

/** EN/VI strings for the `reconcile` booking page (M13.3). Keep `en`/`vi` in lockstep. */
export const en = {
  eyebrow: "Consultations",
  heading: "Bookings",
  intro:
    "Booking confirmations arrive by webhook. Re-poll TidyCal to recover any the webhook missed, and review bookings that couldn't be tied to a user — kept here so none silently vanish.",
  // Run reconcile card.
  runReconcile: "Run reconcile",
  reconciling: "Reconciling…",
  sinceLabel: "Since (optional)",
  // Result stats.
  polled: "Polled",
  applied: "Applied",
  matched: "Matched",
  alreadySeen: "Already seen",
  // Unmatched bookings list.
  unmatchedHeading: "Unmatched bookings",
  emptyUnmatched: "No unmatched bookings — every booking has been correlated.",
  unmatchedBadge: "Unmatched",
  bookingReference: "Booking reference",
  contactEmail: "Contact email",
  scheduled: "Scheduled",
  none: "— (none)",
  loadMore: "Load more",
  loadingMore: "Loading…",
  // Errors.
  errorSignIn: "Please sign in to continue.",
  errorLoad: "Failed to load unmatched bookings.",
  errorReconcile: "Reconcile failed.",
} satisfies Messages;

export const vi = {
  eyebrow: "Tư vấn",
  heading: "Lịch hẹn",
  intro:
    "Xác nhận đặt lịch được gửi qua webhook. Truy vấn lại TidyCal để khôi phục những lịch mà webhook bỏ sót, và xem lại các lịch không thể gắn với người dùng — được giữ lại ở đây để không có lịch nào âm thầm biến mất.",
  // Run reconcile card.
  runReconcile: "Chạy đối soát",
  reconciling: "Đang đối soát…",
  sinceLabel: "Kể từ (tùy chọn)",
  // Result stats.
  polled: "Đã truy vấn",
  applied: "Đã áp dụng",
  matched: "Đã khớp",
  alreadySeen: "Đã xử lý trước đó",
  // Unmatched bookings list.
  unmatchedHeading: "Lịch chưa khớp",
  emptyUnmatched: "Không có lịch nào chưa khớp — mọi lịch đã được liên kết.",
  unmatchedBadge: "Chưa khớp",
  bookingReference: "Mã tham chiếu lịch hẹn",
  contactEmail: "Email liên hệ",
  scheduled: "Thời gian hẹn",
  none: "— (không có)",
  loadMore: "Tải thêm",
  loadingMore: "Đang tải…",
  // Errors.
  errorSignIn: "Vui lòng đăng nhập để tiếp tục.",
  errorLoad: "Không thể tải các lịch chưa khớp.",
  errorReconcile: "Đối soát thất bại.",
} satisfies Messages;
