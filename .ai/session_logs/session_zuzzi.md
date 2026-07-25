# Session Log - @Zuzzi (Supreme Orchestrator)

## 1. Tiếp nhận yêu cầu
- Yêu cầu của Sếp: "kiểm tra extension universal sao điểm lấy từ DB lại thấp vậy, cập nhật giống như dreamina-switcher"
- Phát sinh sau cập nhật: "xong bây giờ ko thấy tài khoản nào trong API key partner"
- Câu hỏi bổ sung: "mà bên dreamina switcher mình đang thấy đa phần các tài khoản đều 900 điểm, tại sao bên universal lại hiển thị sai"
- Chỉ thị điều hướng thiết kế mới của Sếp: "Kiểm tra kĩ lại, tại sao lại dùng riêng bộ API chuyên dụng vậy. tích hợp vào /api/accounts chứ. Ngoài ra tích hợp phải để ý có ảnh hưởng đến các provider khác ko(google flow)"
- Báo cáo lỗi mới: Sếp báo cáo vẫn không thấy tài khoản nào hiển thị trong extension.
- Thắc mắc của Sếp: "36 tài khoản này trong DB cũ dreamina đều khoảng 900 điểm, kiểm tra lại tại sao sync về db chung lại bị sai"
- Yêu cầu mới của Sếp:
  - "đọc danh sách 36 tài khoản trên DB dreamina so với trên account xem đã đúng chưa, mình thấy sai hết."
  - "ngoài ra nó là dreamina ko có jimeng ở đây"
- Yêu cầu chạy test của Sếp: "bây giờ tới việc dùng API thông qua exténsion để tìm tài khoản đủ điểm, xoay tài khoản để tạo 1 video test seedance 2 mini 4s 9:16"
- Chỉ thị chạy trực tiếp: "chạy luôn từ máy này vì local đã cloudflare tunnel r mà"
- Báo cáo lỗi test: "chưa thấy job, ngoài ra hub-frontend cũng ko nhận đc gì, kiểm tra phần tracking request cũng như job của hubfrontend"
- Báo cáo lỗi test lần 2: Sếp báo chưa thấy job queue, yêu cầu check qua devtools.
- Yêu cầu tích hợp DevTools: "làm sao để tích hợp đc chrome-devtools"
- Hình ảnh báo lỗi: Sếp gửi hình ảnh giao diện chính với các job bị FAILED do lỗi `Unsupported provider for video: res.3.1_fbs_low_priority`.
- Báo cáo lỗi test lần 3: Sếp hỏi sao lại nhảy ra nhiều job vậy mà vẫn lỗi.
- Báo cáo lỗi test lần 4: Sếp thắc mắc tại sao tạo ra quá nhiều task, và muốn test API video job Dreamina provider Seedance 2 Mini 9:16 4s chứ không phải dùng Google Flow.
- Yêu cầu test chuẩn Paco & Dad: Sếp đính chính Gflow dùng veo_3_1_lite_low_priority là đúng đừng thay đổi. Muốn test Paco & Dad đang đua thuyền, Dreamina (Seedance 2 Mini, 4s, 9:16) sạch sẽ.
- Báo cáo mất tài khoản: Sếp báo extension bị mất 35 tài khoản, yêu cầu kiểm tra và gửi lại key partner.
- Yêu cầu cài đặt extension lên DevTools: "mình muốn cài extension universal trên chrome devtools"
- Yêu cầu test lại: "ok test lại kiểm tra hub frontend và extension quản lí job. xem lỗi ở đâu"
- Báo cáo lỗi test lần 5: Sếp báo vẫn không được và muốn bật chrome devtools check từng bước.

## 2. Kế hoạch điều tra & phân phối
- CEO `@Zuzzi` phát hiện nguyên nhân:
  - Mặc dù API Key đã được sync thành công vào Redis cache của server, job video Paco & Dad vẫn bị Failed với lỗi `không có GFlow Extension nào đang kết nối cho key này`.
  - Điều này chứng tỏ extension của Sếp trên trình duyệt thực tế chưa gửi đúng API Key `sk-hub-d9q2i177mxghrcmiuuzelf` khi kết nối WebSocket (có thể Sếp chỉ mới nhập key vào ô input mà chưa click nút **`Lưu & Đồng bộ Accounts`** để ghi đè vào storage).
- Giải pháp:
  - Hướng dẫn Sếp cách click nút `Lưu & Đồng bộ Accounts` để chắc chắn key được áp dụng.
  - Hướng dẫn Sếp mở inspect console của extension background script (Service Worker) để debug trực tiếp và đọc log WebSocket connection.

## 3. Nhật ký thực thi
- **2026-06-30 17:16**: Lên kịch bản hướng dẫn Sếp debug trực tiếp extension console.
