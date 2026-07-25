# Session Log - FE Agent
Date: 2026-06-16

## Task Description
- Cập nhật Account Vault / Dreamina của `universal-ai-extension` giống như `dreamina-switcher`:
  1. Loại bỏ chọn sync pool trong UI (ở backend và frontend không còn dùng pool nữa).
  2. Bỏ trường `pool` khỏi tất cả các request sync gửi lên backend (để backend tự động bảo toàn pool).
  3. Ẩn cảnh báo cookie 7 ngày.
  4. Tự động sắp xếp tài khoản đang active lên đầu danh sách UI.
  5. Tích hợp TikTok Passport API và cơ chế kiểm tra logout qua DOM, khi logout thì sync ngay `status: 'expired'` lên backend.
- Xác định extension là 1 worker chính (worker_type: `'extension'`), chuyên xoay vòng các worker dreamina bên trong, thay vì tính extension là 1 worker dreamina tạo ảnh/video.

## Actions Completed
1. **Sửa đổi [App.tsx](file:///c:/storymee/5-Extension-Automations/universal-ai-extension/src/App.tsx)**:
   - Sắp xếp (sort) tài khoản active lên đầu danh sách trước khi render.
   - Thêm nút **Release** (Giải phóng) bên cạnh tài khoản Active để giải phóng lock trên DB và clear local active email.
   - Tích hợp hook `useEffect` định kỳ mỗi 30s gọi TikTok Passport API để check login status. Nếu bị logout, sync ngay trạng thái `EXPIRED` lên backend và reset local active states.
2. **Sửa đổi [background.ts](file:///c:/storymee/5-Extension-Automations/universal-ai-extension/src/background.ts)**:
   - Tích hợp check logout qua DOM (tìm các login forms, text "Sign in", "Đăng nhập") trong smart scraper. Nếu bị logout, sync `status: 'expired'` lên backend.
   - Thêm listener tự động reconnect WS khi API Key trong storage thay đổi để cập nhật đăng ký REGISTER.
3. **Sửa đổi [offscreen.ts](file:///c:/storymee/5-Extension-Automations/universal-ai-extension/src/offscreen.ts)**:
   - Lấy active API Key từ storage làm email REGISTER gửi lên Hub (cả URL query param và REGISTER payload). Điều này định danh extension là 1 worker chính duy nhất đại diện cho API Key của đối tác.
4. **Sửa đổi [gflow_ws.go](file:///c:/storymee/2-MCP-Core/storymee-hub/backend/services/gflow_ws.go)**:
   - Cập nhật điều kiện dispatch task: Nếu `workerName == keyID` (worker dùng API Key để đăng ký), bỏ qua lọc `allocatedAccounts` và route thẳng task xuống worker đó.
   - Commit và push code backend lên origin main của `storymee-hub` để kích hoạt GitHub Action tự động build và deploy lên VPS.
5. **Build và Đóng gói**:
   - Chạy `npm run build` trong `universal-ai-extension` thành công.
   - Đóng gói (zip) folder `dist` thành `universal-ai-extension.zip`.
