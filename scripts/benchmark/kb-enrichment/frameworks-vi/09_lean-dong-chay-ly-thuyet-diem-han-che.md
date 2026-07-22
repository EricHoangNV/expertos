# Lean, Dòng chảy và Lý thuyết Điểm hạn chế (TOC)

Hiệu suất vận hành được chi phối bởi cách giá trị chảy từ đầu đến cuối, không phải bởi mức độ bận rộn
của từng nguồn lực. Tối ưu tốc độ hay công suất sử dụng cục bộ thường làm suy giảm toàn thể.

## Dòng chảy trước tốc độ; dòng chảy hơn công suất sử dụng
- **Dòng chảy trước tốc độ.** Mục tiêu là dòng chảy giá trị mượt mà, nhanh, từ đầu đến cuối tới khách
  hàng, không phải tốc độ tối đa ở một bước đơn lẻ. Tăng tốc một trạm phía trước điểm hạn chế chỉ tạo
  ra tồn kho trước nút thắt kế tiếp.
- **Dòng chảy hơn công suất sử dụng.** Ép mọi nguồn lực đạt mức tận dụng cao sẽ tạo ra hàng chờ. Lý
  thuyết hàng chờ (và Định luật Little) cho thấy khi mức tận dụng tiến tới 100%, thời gian chờ và tồn
  kho dở dang bùng nổ. Sự chùng có chủ đích tại các điểm không phải điểm hạn chế mới là điều cho phép
  giá trị chảy. Tận dụng cao không đồng nghĩa với thông lượng cao.

## Định luật Little
Tồn kho dở dang (WIP) = thông lượng × thời gian dẫn (lead time). Muốn giảm thời gian dẫn, hãy giảm
WIP (giới hạn lượng công việc trong hệ thống cùng lúc) thay vì đẩy thêm việc vào. Ít WIP nghĩa là dòng
chảy nhanh hơn và dễ dự đoán hơn.

## Lý thuyết Điểm hạn chế (TOC)
Mọi hệ thống đều có một điểm hạn chế (nút thắt) giới hạn tổng thông lượng. Năm bước tập trung:
1. **Nhận diện** điểm hạn chế.
2. **Khai thác** nó — tận dụng tối đa (đừng bao giờ để nó bị bỏ đói hay ngồi không).
3. **Phụ thuộc** mọi thứ khác theo nhịp của điểm hạn chế — đừng chạy các điểm không hạn chế nhanh hơn
   mức điểm hạn chế có thể hấp thụ.
4. **Nâng** năng lực điểm hạn chế (thêm công suất) chỉ khi các bước 1–3 chưa đủ.
5. **Lặp lại** — điểm hạn chế sẽ dịch chuyển; đừng để quán tính đóng băng.
Cải tiến một điểm không phải điểm hạn chế không giúp ích gì cho thông lượng; nó chỉ thêm chi phí và
tồn kho. Hãy tập trung cải tiến vào điểm hạn chế.

## Từ lô lớn đến dòng chảy
Lô lớn tạo ra sự chờ đợi, che giấu lỗi, và kéo dài thời gian dẫn. Chuyển dần sang lô nhỏ và dòng chảy
từng đơn vị (nơi khả thi) sẽ rút ngắn thời gian dẫn, phơi bày vấn đề nhanh hơn, và giảm tồn kho — với
điều kiện chi phí chuyển đổi (changeover) được xử lý (xem kinh tế học về lô). Kích thước lô là một lựa
chọn thiết kế có hệ quả toàn hệ thống, không phải một tiện lợi cục bộ.

## Tồn kho như tín hiệu và bộ đệm
Tồn kho vừa là **bộ đệm** (bảo vệ trước biến động và tách rời các bước) vừa là **tín hiệu** (sự tích
tụ của nó cho thấy dòng chảy đang gãy ở đâu). Đừng cắt tồn kho một cách đại trà; hãy đặt bộ đệm có chủ
đích ở nơi biến động cần được hấp thụ (ví dụ tại điểm tách rời — decoupling point — ngăn giữa hoạt
động chạy theo dự báo và hoạt động chạy theo nhu cầu), và đọc tồn kho tăng như một tín hiệu của vấn
đề dòng chảy ở thượng nguồn cần sửa từ gốc.
