import type { Messages } from "@expertos/ui";

/** EN/VI strings for the `validation` admin scorecard (M13.3). Keep `en`/`vi` in lockstep. */
export const en = {
  eyebrow: "Analytics",
  heading: "Validation scorecard",
  windowLabel: "Window",
  windowOption: "Last {days} days",
  intro:
    "The core go/no-go signals — activation, engagement, willingness to pay, and funnel conversion. Raw numbers only: targets are set post-launch once real usage exists. Willingness-to-pay is cumulative (current platform state); the rest cover the selected window.",
  // Activation section.
  activationHeading: "Activation",
  activationDescription: "New users reaching a cited answer within 24h of signing up.",
  activationRate: "Activation rate · {days}d",
  activationDelta: "{activated} of {total} new users",
  newUsers: "New users · {days}d",
  activated: "Activated · {days}d",
  // Engagement section.
  engagementHeading: "Engagement",
  engagementDescription:
    "Questions asked, and whether the new cohort comes back 1–7 days after signup.",
  returnRate: "Return rate · {days}d",
  returnDelta: "{returned} of {total} new users returned",
  activeUsers: "Active users · {days}d",
  questions: "Questions · {days}d",
  medianQuestions: "Median questions / active user",
  // Willingness to pay section.
  wtpHeading: "Willingness to pay",
  wtpDescription: "Cumulative — paying subscribers against all users (current state).",
  freeToPaid: "Free → paid",
  wtpDelta: "{paying} of {total} users",
  payingUsers: "Paying users",
  trialingUsers: "Trialing users",
  totalUsers: "Total users",
  // Funnel conversion section.
  funnelHeading: "Funnel conversion",
  funnelDescription: "In-chat recommendation → booked consultation, and booked revenue per buyer.",
  recommendationToBooking: "Recommendation → booking · {days}d",
  funnelDelta: "{bookings} of {recommendations} recommendations",
  bookings: "Bookings · {days}d",
  bookedRevenue: "Booked revenue · {days}d",
  revenuePerBuyer: "Revenue / buyer",
  revenuePerBuyerDelta: "{buyers} buyers",
  // Errors.
  errorSignIn: "Please sign in to continue.",
  errorLoad: "Failed to load validation analytics.",
} satisfies Messages;

export const vi = {
  eyebrow: "Phân tích",
  heading: "Bảng điểm kiểm chứng",
  windowLabel: "Khoảng thời gian",
  windowOption: "{days} ngày gần nhất",
  intro:
    "Các tín hiệu cốt lõi để quyết định tiếp tục hay dừng — kích hoạt, mức độ tương tác, mức sẵn lòng chi trả và chuyển đổi phễu. Chỉ là số liệu thô: mục tiêu được đặt sau khi ra mắt khi đã có dữ liệu sử dụng thực tế. Mức sẵn lòng chi trả là lũy kế (trạng thái hiện tại của nền tảng); phần còn lại tính theo khoảng thời gian đã chọn.",
  // Activation section.
  activationHeading: "Kích hoạt",
  activationDescription:
    "Người dùng mới nhận được câu trả lời có trích dẫn trong vòng 24h kể từ khi đăng ký.",
  activationRate: "Tỷ lệ kích hoạt · {days} ngày",
  activationDelta: "{activated} trên {total} người dùng mới",
  newUsers: "Người dùng mới · {days} ngày",
  activated: "Đã kích hoạt · {days} ngày",
  // Engagement section.
  engagementHeading: "Mức độ tương tác",
  engagementDescription:
    "Số câu hỏi đã đặt, và liệu nhóm người dùng mới có quay lại trong 1–7 ngày sau khi đăng ký hay không.",
  returnRate: "Tỷ lệ quay lại · {days} ngày",
  returnDelta: "{returned} trên {total} người dùng mới đã quay lại",
  activeUsers: "Người dùng hoạt động · {days} ngày",
  questions: "Câu hỏi · {days} ngày",
  medianQuestions: "Số câu hỏi trung vị / người dùng hoạt động",
  // Willingness to pay section.
  wtpHeading: "Mức sẵn lòng chi trả",
  wtpDescription:
    "Lũy kế — người đăng ký trả phí so với toàn bộ người dùng (trạng thái hiện tại).",
  freeToPaid: "Miễn phí → trả phí",
  wtpDelta: "{paying} trên {total} người dùng",
  payingUsers: "Người dùng trả phí",
  trialingUsers: "Người dùng dùng thử",
  totalUsers: "Tổng số người dùng",
  // Funnel conversion section.
  funnelHeading: "Chuyển đổi phễu",
  funnelDescription:
    "Đề xuất trong chat → đặt lịch tư vấn, và doanh thu đặt lịch trên mỗi người mua.",
  recommendationToBooking: "Đề xuất → đặt lịch · {days} ngày",
  funnelDelta: "{bookings} trên {recommendations} đề xuất",
  bookings: "Lượt đặt lịch · {days} ngày",
  bookedRevenue: "Doanh thu đặt lịch · {days} ngày",
  revenuePerBuyer: "Doanh thu / người mua",
  revenuePerBuyerDelta: "{buyers} người mua",
  // Errors.
  errorSignIn: "Vui lòng đăng nhập để tiếp tục.",
  errorLoad: "Không thể tải dữ liệu phân tích kiểm chứng.",
} satisfies Messages;
