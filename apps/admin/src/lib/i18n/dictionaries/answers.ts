import type { Messages } from "@expertos/ui";

/** Expert AI-answer review feed (M8.5) — `apps/admin/app/answers/page.tsx` (M13.3). */
export const en = {
  eyebrow: "Quality",
  heading: "AI answers",
  expertLabel: "Expert",
  selectExpert: "Select an expert…",
  intro:
    "Answers generated in this expert’s voice, newest first — review them for fidelity and feed weak ones back into knowledge.",
  signIn: "Please sign in to continue.",
  loadError: "Failed to load answers.",
  selectExpertPrompt: "Select an expert to review their answers.",
  noAnswers: "No answers have been generated in this voice yet.",
  helpful: "Helpful",
  unhelpful: "Unhelpful",
  insufficient: "Insufficient knowledge",
  confidence: "confidence {value}",
  question: "Question",
  questionNotFound: "— (question not found)",
  answer: "Answer",
  feedback: "Feedback",
  loading: "Loading…",
  loadMore: "Load more",
} satisfies Messages;

export const vi = {
  eyebrow: "Chất lượng",
  heading: "Câu trả lời AI",
  expertLabel: "Chuyên gia",
  selectExpert: "Chọn một chuyên gia…",
  intro:
    "Các câu trả lời được tạo theo giọng văn của chuyên gia này, mới nhất trước — hãy xem xét độ trung thực và đưa những câu yếu trở lại kho kiến thức.",
  signIn: "Vui lòng đăng nhập để tiếp tục.",
  loadError: "Không tải được câu trả lời.",
  selectExpertPrompt: "Chọn một chuyên gia để xem các câu trả lời của họ.",
  noAnswers: "Chưa có câu trả lời nào được tạo theo giọng văn này.",
  helpful: "Hữu ích",
  unhelpful: "Không hữu ích",
  insufficient: "Kiến thức không đủ",
  confidence: "độ tin cậy {value}",
  question: "Câu hỏi",
  questionNotFound: "— (không tìm thấy câu hỏi)",
  answer: "Câu trả lời",
  feedback: "Phản hồi",
  loading: "Đang tải…",
  loadMore: "Tải thêm",
} satisfies Messages;
