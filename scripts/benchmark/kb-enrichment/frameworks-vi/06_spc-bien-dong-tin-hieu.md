# Kiểm soát Quy trình bằng Thống kê (SPC): Biến động, Tín hiệu và Nhiễu

Quản trị bằng dữ liệu đòi hỏi phân biệt tín hiệu thật với biến động thông thường. Phản ứng với nhiễu
như thể đó là tín hiệu ("can thiệp thừa" — tampering) sẽ làm hiệu suất tệ hơn.

## Nguyên nhân thông thường và nguyên nhân đặc biệt
Mọi quy trình đều có biến động. Kiểm soát Quy trình bằng Thống kê (SPC) tách ra hai loại:
- **Nguyên nhân thông thường (nhiễu).** Biến động cố hữu, thường trực của một quy trình ổn định. Đó
  là "tiếng nói của quy trình". Không thể sửa biến động nguyên nhân thông thường bằng cách đuổi theo
  từng điểm dữ liệu; chỉ thay đổi được nó bằng cách thiết kế lại quy trình.
- **Nguyên nhân đặc biệt (tín hiệu).** Biến động từ một sự kiện cụ thể, có thể quy được, nằm ngoài
  mẫu hình bình thường. Đây mới là thứ đáng điều tra và hành động.
Biểu đồ kiểm soát là công cụ phân biệt hai loại: các điểm nằm trong giới hạn kiểm soát và không có
mẫu hình bất thường là nguyên nhân thông thường; các điểm vượt giới hạn hoặc tạo mẫu hình bất thường
là nguyên nhân đặc biệt.

## Trung bình và biến động
Quản trị theo giá trị trung bình che giấu rủi ro. Hai quy trình có cùng trung bình có thể hành xử rất
khác nhau nếu một cái có biến động lớn. Khách hàng và các bước hạ nguồn cảm nhận biến động, không phải
trung bình. Luôn nhìn vào độ phân tán và tính ổn định, không chỉ giá trị trung bình — một "trung bình
đẹp" với biến động cao là một quy trình bất ổn đang chờ đổ vỡ.

## Ổn định trước năng lực
Đưa quy trình vào trạng thái kiểm soát thống kê (ổn định, chỉ còn biến động nguyên nhân thông thường)
**trước** khi cố nâng năng lực (đáp ứng đặc tả). Cải tiến một quy trình mất kiểm soát tạo ra những
thành quả không giữ được, vì quy trình vẫn đang bị các nguyên nhân đặc biệt làm dịch chuyển.

## Tín hiệu trước hành động
Đừng phản ứng với một con số đơn lẻ. Hãy hỏi liệu sự dịch chuyển đó là tín hiệu (nguyên nhân đặc
biệt) hay nhiễu (nguyên nhân thông thường). Phản ứng thái quá với biến động bình thường — điều chỉnh
quy trình sau mỗi điểm dữ liệu xấu — sẽ bơm thêm biến động và làm hiệu suất suy giảm. Hành động dựa
trên tín hiệu đã kiểm chứng; thay đổi hệ thống để xử lý nguyên nhân thông thường.

## Phát hiện để phòng ngừa
Mục tiêu của đo lường không chỉ là phát hiện lỗi sau khi đã xảy ra, mà là phát hiện tín hiệu đủ sớm
để phòng ngừa. Hãy dời các cơ chế kiểm soát lên thượng nguồn (kiểm tra trong quy trình, chỉ số dẫn
dắt, chống lỗi — mistake-proofing) để vấn đề được bắt và ngăn chặn thay vì bị kiểm tra loại bỏ ở cuối.
