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

## 💻 4. Cách Hoạt Động & Cơ Chế Xử Lý Record

### 4.1. Điều hướng và Vượt Pre-join tự động
- Khi người dùng truy cập `https://meet.jit.si/`, Extension sẽ tự tính toán tên phòng hôm nay và tự động chuyển hướng vào `https://meet.jit.si/Staff...#config.prejoinConfig.enabled=false`.
- Nếu Jitsi xuất hiện màn hình chờ (Pre-join screen), Extension tự động điền Tên hiển thị (Display Name) và tự động click nút **"Join meeting"** để vào phòng ngay lập tức.

### 4.2. Quá trình Bật / Tắt Record
1. **Đến giờ Bật**:
   - Extension tìm và click nút **3 chấm (`...`)** ở thanh công cụ phía dưới màn hình phòng họp.
   - Menu mở ra, Extension tự động tìm và click mục **Record** (có biểu tượng chấm tròn).
   - Phát âm thanh chuông báo và hiển thị thông báo trạng thái.
2. **Đến giờ Tắt**:
   - Extension mở lại menu và chọn **Stop recording** -> xác nhận dừng.
   - Jitsi Meet sẽ tự động đóng gói file video `.webm` và lưu trực tiếp về máy tính (thư mục Downloads).

---

## ⚡ 5. Chế Độ Tự Động 100% Không Cần Người Bấm "Allow"

Khi Jitsi kích hoạt tính năng Record cục bộ (Local Recording), trình duyệt Chrome theo chính sách bảo mật mặc định sẽ hiện popup:
> *"Allow meet.jit.si to see this tab?"* $\rightarrow$ Nút **Allow**.

Để hệ thống có thể **chạy hoàn toàn tự động 24/7 mà không cần người ngồi bấm nút "Allow"**:
- **Trên Linux / macOS**: Chạy script:
  ```bash
  cd /home/trung/Documents/2026/work/automeet
  ./scripts/start-chrome-auto.sh
  ```
- **Trên Windows**: Nhấp đúp vào file:
  ```cmd
  scripts\start-chrome-auto.bat
  ```

*Script này sẽ khởi chạy Chrome kèm 2 cờ `--auto-select-desktop-capture-source="Jitsi Meet" --use-fake-ui-for-media-stream`, giúp Chrome tự động chọn tab Jitsi và tự động chấp thuận (Auto-Allow) ngay lập tức.*

---

## 📂 6. Cấu Trúc Mã Nguồn

```
automeet/
├── manifest.json            # Cấu hình Manifest V3
├── utils.js                 # Tính toán phòng theo ISO 8601, xử lý thời gian & lưu trữ
├── background.js            # Service worker lập lịch Chrome Alarms & điều phối Tab
├── content/
│   ├── content.js           # Điều khiển giao diện Jitsi Meet (vượt pre-join, bấm menu, record)
│   └── content.css          # Giao diện widget HUD nổi trên phòng họp
├── popup/
│   ├── popup.html           # Giao diện bảng điều khiển nhanh
│   └── popup.js             # Logic xử lý giao diện popup
├── options/
│   ├── options.html         # Trang cài đặt tùy chỉnh ca trực & thông số
│   └── options.js           # Logic lưu cấu hình
├── icons/                   # Bộ icon Extension 16x16, 48x48, 128x128
├── scripts/
│   ├── start-chrome-auto.sh # Khởi chạy Chrome auto-allow trên Linux/macOS
│   └── start-chrome-auto.bat# Khởi chạy Chrome auto-allow trên Windows
└── README.md                # Tài liệu hướng dẫn sử dụng chi tiết
```
