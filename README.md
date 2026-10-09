# 🎥 AutoMeet Jitsi Controller & Recorder (Chrome Extension)

Extension trình duyệt (Manifest V3) tự động hóa tạo phòng họp Jitsi Meet theo định dạng `Staff{Năm}W{Tuần}T{Thứ}` và tự động điều khiển Bật/Tắt ghi hình cục bộ (Local Recording) lưu về máy theo các khung thời gian định sẵn.

---

## 📌 1. Quy tắc Đặt Tên Phòng Họp

Tên phòng họp được tạo tự động theo công thức:
```
Staff{Năm}W{Số tuần trong năm}T{Thứ trong tuần}
```
Trong đó:
- `{Năm}`: Năm hiện tại (ví dụ: `2026`).
- `W{Số tuần trong năm}`: Số thứ tự tuần theo chuẩn quốc tế ISO 8601 (ví dụ tuần `41`).
- `T{Thứ trong tuần}`: Số thứ tự thứ theo quy ước:
  - **Thứ 2**: `2`
  - **Thứ 3**: `3`
  - **Thứ 4**: `4`
  - **Thứ 5**: `5`
  - **Thứ 6**: `6`
  - **Thứ 7**: `7`
  - **Chủ nhật**: `8`

👉 **Ví dụ**: Ngày 08 tháng 10 năm 2026 (Thứ 5, tuần 41) $\rightarrow$ Tên phòng là: **`Staff2026W41T5`**.

---

## ⏰ 2. Lịch Trình Record Mặc Định

| Ca trực | Giờ Bật Record | Giờ Tắt Record | Thời lượng | Ghi chú |
| :--- | :---: | :---: | :---: | :--- |
| **Ca sáng** | `07:30` | `11:30` | 4 tiếng | Tự động tải file video về máy |
| **Ca chiều** | `13:00` | `17:00` | 4 tiếng | Tự động tải file video về máy |
| **Ca tối** | `22:00` | `24:00` | 2 tiếng | Tự động kết thúc lúc nửa đêm |

*(Bạn có thể dễ dàng bật/tắt hoặc chỉnh sửa lại khung giờ trong trang **Cài đặt** của Extension).*

---

## 🚀 3. Hướng Dẫn Cài Đặt Vào Trình Duyệt

Extension tương thích với tất cả trình duyệt nền Chromium (Google Chrome, Microsoft Edge, Cốc Cốc, Brave...):

1. Mở trình duyệt và truy cập vào đường dẫn:
   - Trên Chrome / Cốc Cốc: `chrome://extensions/`
   - Trên Edge: `edge://extensions/`
2. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải màn hình.
3. Nhấp vào nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trên bên trái.
4. Chọn thư mục dự án này:
   ```
   /home/trung/Documents/2026/work/automeet
   ```
5. Tiện ích **AutoMeet Jitsi Controller & Recorder** sẽ xuất hiện trên thanh công cụ của trình duyệt. Nhấp vào biểu tượng ghim (Pin) để tiện theo dõi.

---

## 💻 4. Cách Hoạt Động & Cơ Chế Xử Lý Hoàn Toàn Tự Động (100% Không Cần Người Dùng Can Thiệp)

### 4.1. Mở trình duyệt là tự động chạy theo lịch
- Bất kể bạn mở trình duyệt vào lúc nào:
  - Nếu thời điểm mở nằm trong bất kỳ khung giờ ca trực nào (`07:30 - 11:30`, `13:00 - 17:00`, `22:00 - 24:00`), Extension sẽ **tự động mở tab phòng họp hôm nay** (`Staff...`).
  - Tự động điền tên hiển thị và tự động click nút **Join meeting** vượt qua màn hình Pre-join.
- Nếu bạn mở trình duyệt trước giờ ca hoặc để máy chạy qua đêm:
  - Cứ đến đúng giờ bắt đầu ca, Extension sẽ tự động mở cuộc họp và kích hoạt ghi hình.
  - Đến giờ kết thúc ca, Extension tự động dừng ghi hình và lưu video về máy tính.

### 4.2. Cơ chế Ghi hình kép (Dual-Engine Recording)
Extension kết hợp 2 tầng ghi hình mạnh mẽ:
1. **Engine 1 - Tự động điều khiển Jitsi UI (Auto Confirm)**:
   - Tự mở menu 3 chấm, click **Record**.
   - Tự động tích chọn checkbox đồng ý (Consent) và **tự động click nút Start** mà không chờ người dùng nhấn tay.
   - Khi hết ca, tự động bấm Stop và tự động xác nhận hộp thoại kết thúc.
2. **Engine 2 - Tab Audio/Video Capture ngầm (Offscreen Document)**:
   - Sử dụng API `chrome.tabCapture` và `chrome.offscreen` trong Manifest V3 để thu trực tiếp toàn bộ luồng âm thanh & hình ảnh của tab cuộc họp.
   - **Hoàn toàn không mở popup xin quyền màn hình, không mở hộp thoại chọn tab, không cần bất kỳ thao tác click nào từ con người.**
   - Khi kết thúc ca, video `.webm` chất lượng cao sẽ được tải tự động thẳng vào thư mục `Downloads/AutoMeet/` với cờ `saveAs: false` (không hiện hộp thoại hỏi nơi lưu file).

---

## 📂 5. Cấu Trúc Mã Nguồn

```
automeet/
├── manifest.json            # Cấu hình Manifest V3 (tabCapture, offscreen, downloads)
├── utils.js                 # Tính toán phòng theo ISO 8601, xử lý thời gian & lưu trữ
├── background.js            # Service worker lập lịch tự động, điều phối Tab & TabCapture
├── offscreen/
│   ├── offscreen.html       # Container tài liệu ngầm (Offscreen Document)
│   └── offscreen.js         # Xử lý ghi âm thanh + hình ảnh tab qua MediaRecorder
├── content/
│   ├── content.js           # Điều khiển giao diện Jitsi Meet (vượt pre-join, tự click Record & Start)
│   └── content.css          # Giao diện widget HUD nổi trên phòng họp
├── popup/
│   ├── popup.html           # Giao diện bảng điều khiển nhanh
│   └── popup.js             # Logic xử lý giao diện popup & trạng thái trực tiếp
├── options/
│   ├── options.html         # Trang cài đặt tùy chỉnh ca trực & thông số
│   └── options.js           # Logic lưu cấu hình
├── icons/                   # Bộ icon Extension 16x16, 48x48, 128x128
├── scripts/
│   ├── start-chrome-auto.sh # Khởi chạy Chrome auto-allow trên Linux/macOS
│   └── start-chrome-auto.bat# Khởi chạy Chrome auto-allow trên Windows
└── README.md                # Tài liệu hướng dẫn sử dụng chi tiết
```
