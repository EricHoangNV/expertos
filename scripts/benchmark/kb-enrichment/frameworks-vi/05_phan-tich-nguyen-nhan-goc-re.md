# Phân tích Nguyên nhân Gốc rễ và Kỷ luật Kiểm chứng

Tìm ra một nguyên nhân hợp lý không giống với tìm ra nguyên nhân gốc rễ. Lỗi phổ biến nhất trong
giải quyết vấn đề là chấp nhận câu trả lời hợp lý đầu tiên và hành động dựa trên nó trước khi kiểm
chứng bằng bằng chứng.

## 5-Why và những cái bẫy
5-Why hỏi "tại sao?" nhiều lần để đi từ triệu chứng đến nguyên nhân gốc rễ. Nó hữu ích nhưng dễ bị
dùng sai:
- **Bẫy một đường.** Vấn đề thực tế thường có nhiều nguyên nhân góp phần. Một chuỗi "tại sao" đơn lẻ
  thường dừng ở một nguyên nhân tiện lợi (thường là "thiếu đào tạo") và bỏ sót những nguyên nhân khác.
- **Bẫy ý kiến.** Mỗi "tại sao" phải có bằng chứng hỗ trợ, không phải giả định. Một 5-Why chưa kiểm
  chứng chỉ là một chuỗi phỏng đoán.
- **Bẫy đổ lỗi.** Những "tại sao" kết thúc ở một con người ("nhân viên bất cẩn") thường che giấu một
  nguyên nhân hệ thống (thiết kế giao diện, tiêu chuẩn không rõ ràng, quy trình phức tạp).

## "Thiếu đào tạo" hiếm khi là toàn bộ nguyên nhân gốc rễ
Khi 5-Why dừng ở "thiếu đào tạo", hãy xem đó là một giả thuyết, không phải kết luận. Trước khi cam
kết đào tạo như là cách sửa, hãy kiểm chứng:
- **Bằng chứng.** Dữ liệu có cho thấy lỗi tập trung ở những người chưa được đào tạo không, hay người
  đã được đào tạo cũng mắc lỗi? Hãy phân tách dữ liệu.
- **Nguyên nhân thay thế.** Liệu thiết kế giao diện, tiêu chuẩn không rõ, độ phức tạp quy trình, công
  cụ, hay khối lượng công việc có đang gây ra lỗi không? Đào tạo sẽ không sửa được một quy trình được
  thiết kế tồi.
- **Tính bền vững.** Ngay cả khi đào tạo có ích, nếu không có tiêu chuẩn và cơ chế kiểm soát, hiệu
  quả sẽ suy giảm.
Chỉ sau khi kiểm chứng mới nên triển khai, rồi xác nhận cách sửa bằng dữ liệu và chuẩn hóa nó (bước
Control).

## Tương quan không phải là nhân quả
Một mối quan hệ thống kê mạnh giữa hai biến số không chứng minh biến này gây ra biến kia. Trước khi
kết luận "X gây ra Y" và hành động:
- **Kiểm tra biến gây nhiễu (confounder).** Một yếu tố thứ ba có thể đồng thời gây ra cả hai (ví dụ,
  nhu cầu theo mùa làm tăng cả giờ làm thêm lẫn tỷ lệ lỗi).
- **Xét nhân quả ngược và trùng hợp.** Có thể Y gây ra X, hoặc mối liên hệ chỉ là ngẫu nhiên.
- **Trình tự phân tích.** Xác lập mối quan hệ, hình thành giả thuyết nhân quả, kiểm định nó (lý tưởng
  là bằng thay đổi có kiểm soát hoặc loại trừ biến gây nhiễu), và chỉ sau đó mới hành động.
Hành động chỉ dựa trên tương quan — ví dụ, cắt giờ làm thêm để giảm lỗi trong khi cả hai đều do một
đợt tăng nhu cầu hoặc một vấn đề quy trình thượng nguồn gây ra — sẽ lãng phí công sức và có thể làm
mọi thứ tệ hơn.

## Quy tắc
Bằng chứng trước hành động. Kiểm chứng nguyên nhân gốc rễ, xét nhiều nguyên nhân và nguyên nhân hệ
thống, loại trừ biến gây nhiễu, và xác nhận cách sửa đã giữ được kết quả. Sự chặt chẽ trong chẩn đoán
là điều phân biệt một vấn đề đã giải quyết với một vấn đề tái diễn.
