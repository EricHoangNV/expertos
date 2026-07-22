import type { Messages } from "@expertos/ui";

/** String extraction (M13.3) for the `settings` runtime answer-tuning admin page (M17.5). */
export const en = {
  eyebrow: "Runtime tuning, not code",
  title: "Answer settings",
  subtitle:
    "Tune the grounded-QA answer path in real time. Changes take effect on the next chat turn — no deploy.",
  signInRequired: "Please sign in to continue.",
  loadFailed: "Failed to load the answer settings.",
  // LLM temperature.
  temperature: "LLM temperature (0–2)",
  temperatureHelp:
    "Sampling temperature for the grounded answer call. Lower is more deterministic — better for cited QA. Default 0.2.",
  // Default chat model.
  defaultChatModel: "Default chat model",
  modelMini: "gpt-4o-mini — standard, lower cost",
  modelFull: "gpt-4o — premium, higher quality",
  defaultChatModelHelp:
    "The standard-tier chat model. The degraded/fair-use mini tier is untouched by this setting.",
  // Retrieval score floor.
  scoreFloor: "Retrieval score floor (0–1)",
  scoreFloorHelp:
    "Minimum fused RRF score a chunk must clear to reach the model. This is the fused rank score (small magnitudes, ~0.016/rank), not a 0–1 cosine similarity. 0 = off.",
  // Retrieval score floor — (i) tooltip with concrete settings.
  scoreFloorTipAria: "About the retrieval score floor",
  scoreFloorTipTitle: "When to raise the floor",
  scoreFloorTipIntro:
    "Scores are small RRF magnitudes (k=60, top-8). A chunk found by only one search ≈ 0.011–0.016; a chunk found by both keyword and vector ≈ 0.022–0.033.",
  scoreFloorTipColFloor: "Floor",
  scoreFloorTipColEffect: "Effect",
  scoreFloorTipOff: "Off — the model sees all retrieved chunks (default).",
  scoreFloorTipGentle: "Gentle — drops weak single-search chunks.",
  scoreFloorTipStrict: "Strict — keeps only chunks found by both keyword and vector.",
  scoreFloorTipKill: "Filters everything — don't.",
  scoreFloorTipFoot: "Start at 0; raise to ~0.015 only when weak chunks degrade answers.",
  // Retrieval score floor — the GUIDE chip beside the label (M19.5.5).
  scoreFloorGuide: "Guide",
  // Private beta gate.
  betaGate: "Private beta gate",
  betaGateOn: "On — invite-only (whitelist required)",
  betaGateOff: "Off — any Google account can use the app",
  betaGateHelp:
    "When on, only emails on the Access control whitelist can use the consumer app. Applies within ~30 seconds of saving. Admin-portal access is always whitelist-only, regardless of this setting.",
  // Embedding provider (read-only).
  embeddingProvider: "Embedding provider",
  embeddingProviderNote:
    "Restart required — set via the EMBEDDING_PROVIDER env var. Switching embedders invalidates existing vectors, so it cannot be changed at runtime.",
  // Validation messages.
  temperatureInvalid: "Temperature must be a number between 0 and 2.",
  scoreFloorInvalid: "Score floor must be a number between 0 and 1.",
  saveFailed: "Save failed.",
  // Save action.
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
} satisfies Messages;

export const vi = {
  eyebrow: "Tinh chỉnh thời gian chạy, không phải mã",
  title: "Cài đặt câu trả lời",
  subtitle:
    "Tinh chỉnh luồng trả lời có dẫn nguồn theo thời gian thực. Thay đổi có hiệu lực ở lượt trò chuyện kế tiếp — không cần triển khai lại.",
  signInRequired: "Vui lòng đăng nhập để tiếp tục.",
  loadFailed: "Không tải được cài đặt câu trả lời.",
  temperature: "Nhiệt độ LLM (0–2)",
  temperatureHelp:
    "Nhiệt độ lấy mẫu cho lệnh gọi trả lời có dẫn nguồn. Thấp hơn thì xác định hơn — tốt hơn cho hỏi đáp có trích dẫn. Mặc định 0.2.",
  defaultChatModel: "Mô hình trò chuyện mặc định",
  modelMini: "gpt-4o-mini — tiêu chuẩn, chi phí thấp hơn",
  modelFull: "gpt-4o — cao cấp, chất lượng cao hơn",
  defaultChatModelHelp:
    "Mô hình trò chuyện ở hạng tiêu chuẩn. Hạng mini suy giảm/sử dụng hợp lý không bị ảnh hưởng bởi cài đặt này.",
  scoreFloor: "Ngưỡng điểm truy hồi (0–1)",
  scoreFloorHelp:
    "Điểm RRF hợp nhất tối thiểu mà một đoạn phải vượt qua để đến mô hình. Đây là điểm xếp hạng hợp nhất (độ lớn nhỏ, ~0.016/hạng), không phải độ tương đồng cosine 0–1. 0 = tắt.",
  scoreFloorTipAria: "Về ngưỡng điểm truy hồi",
  scoreFloorTipTitle: "Khi nào nên nâng ngưỡng",
  scoreFloorTipIntro:
    "Điểm là độ lớn RRF nhỏ (k=60, top-8). Một đoạn chỉ được tìm thấy bởi một loại tìm kiếm ≈ 0.011–0.016; một đoạn được tìm thấy bởi cả từ khóa và vector ≈ 0.022–0.033.",
  scoreFloorTipColFloor: "Ngưỡng",
  scoreFloorTipColEffect: "Tác động",
  scoreFloorTipOff: "Tắt — mô hình thấy mọi đoạn được truy hồi (mặc định).",
  scoreFloorTipGentle: "Nhẹ — loại bỏ các đoạn yếu chỉ từ một loại tìm kiếm.",
  scoreFloorTipStrict: "Nghiêm — chỉ giữ các đoạn được tìm thấy bởi cả từ khóa và vector.",
  scoreFloorTipKill: "Lọc bỏ tất cả — đừng dùng.",
  scoreFloorTipFoot: "Bắt đầu từ 0; chỉ nâng lên ~0.015 khi các đoạn yếu làm giảm chất lượng câu trả lời.",
  scoreFloorGuide: "Hướng dẫn",
  betaGate: "Cổng beta riêng tư",
  betaGateOn: "Bật — chỉ dành cho người được mời (cần danh sách cho phép)",
  betaGateOff: "Tắt — mọi tài khoản Google đều dùng được ứng dụng",
  betaGateHelp:
    "Khi bật, chỉ các email trong danh sách Kiểm soát truy cập mới dùng được ứng dụng người dùng. Có hiệu lực trong khoảng ~30 giây sau khi lưu. Cổng quản trị luôn yêu cầu danh sách cho phép, bất kể cài đặt này.",
  embeddingProvider: "Nhà cung cấp nhúng",
  embeddingProviderNote:
    "Cần khởi động lại — đặt qua biến môi trường EMBEDDING_PROVIDER. Đổi bộ nhúng làm vô hiệu các vector hiện có, nên không thể thay đổi khi đang chạy.",
  temperatureInvalid: "Nhiệt độ phải là một số từ 0 đến 2.",
  scoreFloorInvalid: "Ngưỡng điểm phải là một số từ 0 đến 1.",
  saveFailed: "Lưu thất bại.",
  save: "Lưu",
  saving: "Đang lưu…",
  saved: "Đã lưu",
} satisfies Messages;
