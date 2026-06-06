import type { Messages } from "@expertos/ui";

/** EN/VI strings for the `validation` admin scorecard (M13.3). Keep `en`/`vi` in lockstep. */
export const en = {
  eyebrow: "M10.4 · OD#1 · Go / No-go",
  heading: "Product validation",
  windowLabel: "Window",
  windowOption: "Last {days} days",
  intro: "The core hypothesis:",
  introHypothesis: "will users pay to talk to a digital version of a named expert?",
  introOutro: "Raw numbers, no targets — those come post-launch with real data.",
  // Activation section.
  activationEyebrow: "Activation",
  activationHeading: "Did new users ask a first question?",
  activationDescription: "New users reaching a cited answer within 24h of signing up.",
  activationRate: "Activation rate · {days}d",
  activationDelta: "{activated} of {total} new users",
  newUsers: "New users · {days}d",
  activated: "Activated · {days}d",
  // Engagement section.
  engagementEyebrow: "Engagement",
  engagementHeading: "Did they come back and keep asking?",
  engagementDescription:
    "Questions asked, and whether the new cohort comes back 1–7 days after signup.",
  returnRate: "Return rate · {days}d",
  returnDelta: "{returned} of {total} new users returned",
  activeUsers: "Active users · {days}d",
  questions: "Questions · {days}d",
  medianQuestions: "Median questions / active user",
  // Willingness to pay section.
  wtpEyebrow: "Willingness to pay",
  wtpHeading: "Are they willing to pay?",
  wtpDescription: "Cumulative — paying subscribers against all users (current state).",
  freeToPaid: "Free → paid",
  wtpDelta: "{paying} of {total} users",
  payingUsers: "Paying users",
  trialingUsers: "Trialing users",
  totalUsers: "Total users",
  // Funnel conversion section.
  funnelEyebrow: "Funnel conversion",
  funnelHeading: "Do recommendations turn into booked consultations?",
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
  eyebrow: "M10.4 · OD#1 · Tiếp tục / Dừng",
  heading: "Kiểm chứng sản phẩm",
  windowLabel: "Khoảng thời gian",
  windowOption: "{days} ngày gần nhất",
  intro: "Giả thuyết cốt lõi:",
  introHypothesis:
    "liệu người dùng có trả tiền để trò chuyện với phiên bản số của một chuyên gia có tên tuổi hay không?",
  introOutro:
    "Chỉ là số liệu thô, không có mục tiêu — những mục tiêu đó được đặt sau khi ra mắt với dữ liệu thực tế.",
  // Activation section.
  activationEyebrow: "Kích hoạt",
  activationHeading: "Người dùng mới đã đặt câu hỏi đầu tiên chưa?",
  activationDescription:
    "Người dùng mới nhận được câu trả lời có trích dẫn trong vòng 24h kể từ khi đăng ký.",
  activationRate: "Tỷ lệ kích hoạt · {days} ngày",
  activationDelta: "{activated} trên {total} người dùng mới",
  newUsers: "Người dùng mới · {days} ngày",
  activated: "Đã kích hoạt · {days} ngày",
  // Engagement section.
  engagementEyebrow: "Mức độ tương tác",
  engagementHeading: "Họ có quay lại và tiếp tục đặt câu hỏi không?",
  engagementDescription:
    "Số câu hỏi đã đặt, và liệu nhóm người dùng mới có quay lại trong 1–7 ngày sau khi đăng ký hay không.",
  returnRate: "Tỷ lệ quay lại · {days} ngày",
  returnDelta: "{returned} trên {total} người dùng mới đã quay lại",
  activeUsers: "Người dùng hoạt động · {days} ngày",
  questions: "Câu hỏi · {days} ngày",
  medianQuestions: "Số câu hỏi trung vị / người dùng hoạt động",
  // Willingness to pay section.
  wtpEyebrow: "Mức sẵn lòng chi trả",
  wtpHeading: "Họ có sẵn lòng chi trả không?",
  wtpDescription:
    "Lũy kế — người đăng ký trả phí so với toàn bộ người dùng (trạng thái hiện tại).",
  freeToPaid: "Miễn phí → trả phí",
  wtpDelta: "{paying} trên {total} người dùng",
  payingUsers: "Người dùng trả phí",
  trialingUsers: "Người dùng dùng thử",
  totalUsers: "Tổng số người dùng",
  // Funnel conversion section.
  funnelEyebrow: "Chuyển đổi phễu",
  funnelHeading: "Các đề xuất có dẫn đến lượt đặt lịch tư vấn không?",
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
