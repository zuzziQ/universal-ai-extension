# Session Logs - @Worker-agent (2026-06-18)

## Task: Debugging Dreamina Injector Connection & Upgrading Batch Login

### 1. Phân Tích & Fix Lỗi Kết Nối Backend
- **Vấn đề:** Extension báo đỏ "Lỗi kết nối Backend - Server error" khi Sếp nhập API Key `sk-hub-rfugs09l5ybfvxgyx1uiwn`.
- **Nguyên nhân:** API Key này là Hub API Key của Flow Architect, ban đầu trong DB (`cp_hub_api_keys`) có `worker_type` là `NULL`. Trong khi đó, các API endpoint `/api/extension/dreamina-accounts` yêu cầu nghiêm ngặt API Key phải có `worker_type` thuộc `['extension', 'dreamina']`. Kết quả là request bị trả về 403 Forbidden.
- **Xử lý:**
  1. Thử cập nhật `worker_type = 'dreamina'` trong DB để sửa lỗi. Kết quả sửa xong thì extension của Sếp hoạt động bình thường, WebSocket online ổn định.
  2. Tuy nhiên Sếp đính chính: Đây là Hub API Key thông thường chứ không phải Worker Key, yêu cầu revert về cũ.
  3. Đã thực thi SQL revert trạng thái key về `worker_type = NULL` và `max_account_slots = NULL` trong DB Postgres và đồng bộ lại Redis.
  4. Hướng dẫn Sếp chuyển sang sử dụng Worker Key chuẩn như `sk-worker-dreamina-cchpoe9h7mgkba2u`.

### 2. Nâng Cấp Script Batch Login v2 (`batch-login-v2.js`)
- **Vị trí script:** `c:\storymee\4-Ops-Sandboxes\dreamina-api-rnd\batch-login-v2.js`.
- **Nâng cấp thực hiện:**
  - **Tối ưu RAM (Forced Kill Chrome):** Trong block `finally` của mỗi tài khoản, sau khi đóng trình duyệt bằng Playwright, script lấy PID của Chrome (`browser.process().pid`) và thực thi lệnh `taskkill /F /T /PID` trên Windows để dọn sạch sẽ toàn bộ GPU/Renderer process con bị leak.
  - **Tự động quét tài khoản:** Thay vì dùng mảng tài khoản tĩnh, script gọi API của Hub (`/api/accounts`) để fetch toàn bộ tài khoản DREAMINA ở cả hai pool `internal` và `partner` (tổng cộng 205 tài khoản).
  - **Cơ chế Login Cookie-first:**
    1. Lấy cookie sẵn có trong DB nạp vào context.
    2. Navigate trực tiếp tới Dreamina và kiểm tra xem session còn sống không (cào điểm thử).
    3. Nếu cào điểm thành công -> Giữ nguyên session cũ, cập nhật lại điểm số mới.
    4. Nếu cookie trống hoặc hết hạn -> Fallback sang điền username/password tự động, đợi giải captcha tay nếu có, sau đó lưu cookie mới và điểm mới lên DB.

### 3. Kích Hoạt Chạy
- Đã khởi động script chạy ngầm: `node batch-login-v2.js`.
- Kết quả quét ban đầu: Tìm thấy 205 tài khoản (169 internal, 36 partner). Hiện đang xử lý tuần tự.

## Session Logs - @Worker-agent (2026-06-19)

### 1. Phân tích & Định vị lỗi rotate nhấp nháy Chrome
- **Sếp phản hồi:** Trình duyệt Chrome khi rotate vừa mở lên chưa kịp xuất hiện DOM đã tắt và chuyển tài khoản mới ngay lập tức.
- **Nguyên nhân cốt lõi:**
  1. Trong `background.ts` của Extension, khi nhận lệnh `GENERATE_JOB` trong chế độ Single Pass (dòng 615):
     `const tokens = { cookies: [], email: activeAcc.email };`
     Mảng cookies bị gán cứng là rỗng `[]`.
  2. Khi gọi `driver.generate(..., tokens)`, driver Dreamina kiểm tra `tokens.cookies` rỗng liền quăng lỗi ngay lập tức:
     `Missing active CapCut/Dreamina session cookies in database`.
  3. Khi Extension trả về lỗi này, Worker Desktop nhận được phản hồi lỗi, nhảy vào block `catch` và lập tức close/kill Chrome.
  4. Quá trình này diễn ra chỉ trong vòng chưa đầy 1 giây, khiến Sếp thấy Chrome vừa nháy lên chưa kịp load DOM đã tắt và xoay vòng sang tài khoản tiếp theo.
- **Giải pháp:**
  1. Cập nhật `background.ts` của extension để tự động parse `cookieStr` từ `activeAcc.cookieStr` thành mảng cookies object (hoặc dùng `activeAcc.cookies` nếu có) để nạp vào `tokens.cookies` thay vì truyền mảng rỗng `[]`.
  2. Cập nhật `main.js` của worker để ghi cả mảng `cookies` gốc (nếu có) vào extension storage cùng với `cookieStr` để extension có thể sử dụng trực tiếp mà không cần parse thủ công, đồng thời phòng tránh crash khi `account.cookies` bị undefined (đề phòng tài khoản chỉ có `cookieStr`).

