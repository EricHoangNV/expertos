# Kinh tế học về Lô và Tổng Chi phí Hệ thống

Nhiều quyết định "tiết kiệm chi phí" tối ưu một con số hữu hình trong khi làm tăng chi phí ẩn ở nơi
khác trong hệ thống. Kỷ luật ở đây là đánh giá **tổng chi phí hệ thống**, không phải chi phí đơn vị
cục bộ.

## Cái bẫy kinh tế học về lô
Gộp công việc thành lô lớn hơn (chờ đầy xe tải hoặc container, chạy mẻ sản xuất dài hơn, gộp đơn
hàng) làm giảm một chi phí đơn vị hữu hình — cước vận chuyển trên mỗi đơn vị, chi phí thiết lập trên
mỗi đơn vị. Nhưng lô lớn hơn làm tăng những chi phí không xuất hiện trên cùng dòng đó:
- **Thời gian dẫn và khả năng đáp ứng** trở nên tệ hơn (mọi thứ phải chờ lô đầy).
- **Tồn kho và vốn lưu động** tăng lên (giữ nhiều hơn, lâu hơn).
- **Khuếch đại biến động** — các lô lớn, thưa tạo ra nhu cầu giật cục lên thượng nguồn (hiệu ứng roi
  da — bullwhip).
- **Rủi ro chất lượng** — lỗi ẩn trong lô lớn và bị phát hiện muộn, nên phải loại bỏ/làm lại nhiều hơn.
- **Lỗi thời và mất linh hoạt** — các lô đã cam kết không thể thích ứng với thay đổi nhu cầu.
Trước khi gộp lô, hãy đánh giá toàn bộ đánh đổi: khoản tiết kiệm cước/thiết lập so với chi phí tồn
kho, thời gian dẫn, rủi ro chất lượng và mất linh hoạt tăng thêm. Thường thì việc gộp lô "hiển nhiên"
lại là một khoản lỗ ròng khi tính đủ các chi phí ẩn. Câu trả lời hiếm khi là "luôn gộp" hay "không
bao giờ gộp" — nó phụ thuộc vào độ biến động của nhu cầu, chi phí lưu giữ, và chi phí chuyển đổi.

## Giảm chi phí chuyển đổi mở khóa lô nhỏ
Nếu lô nhỏ là điều mong muốn (vì dòng chảy và khả năng đáp ứng) nhưng chi phí chuyển đổi/thiết lập cao,
thì đòn bẩy là **giảm chi phí chuyển đổi** (SMED) thay vì chấp nhận lô lớn. Chuyển đổi rẻ hơn kéo kích
thước lô kinh tế xuống và để dòng chảy cải thiện mà không bị phạt về chi phí.

## Giá mua so với tổng chi phí sở hữu
Giá mua thấp nhất thường là tổng chi phí cao nhất. Hãy đánh giá quyết định mua sắm và thiết bị trên
**tổng chi phí hệ thống**: giá cộng chi phí chất lượng/lỗi, logistics và tồn kho, độ tin cậy và thời
gian ngừng máy, làm lại, chi phí chuyển đổi và phối hợp, và rủi ro. Một đơn vị rẻ hơn nhưng làm tăng
lỗi, thời gian ngừng máy hay cước vận chuyển, hoặc buộc phải giữ bộ đệm lớn hơn, sẽ tốn của hệ thống
nhiều hơn một lựa chọn giá cao hơn nhưng phù hợp hơn.

## Cụ thể về cước vận chuyển và gộp lô
Với câu hỏi "có nên gộp lô hàng và chờ đầy xe tải không?": hãy tính khoản tiết kiệm cước-trên-đơn-vị
so với chi phí của thời gian vận chuyển/chờ tăng thêm, lượng tồn kho giữ thêm ở hai đầu, tác động đến
mức dịch vụ, và độ biến động của nhu cầu. Gộp lô ở nơi nhu cầu ổn định và chi phí lưu giữ thấp; giữ
các chuyến nhỏ, thường xuyên hơn ở nơi khả năng đáp ứng và tồn kho thấp quan trọng hơn giá cước.

## Quy tắc
Tối ưu tổng chi phí và giá trị của hệ thống, không phải một chi phí đơn vị cục bộ. Bất kỳ tối ưu cục
bộ nào cũng cần được kiểm tra về những chi phí nó đẩy sang nơi khác trước khi được áp dụng.
