# 🎥 AutoMeet Jitsi Controller & Recorder (Chrome Extension)

Extension trình duyệt (Manifest V3) tự động hóa tạo phòng họp Jitsi Meet theo định dạng `Staff{Năm}W{Tuần}T{Thứ}` và tự động điều khiển Bật/Tắt ghi hình cục bộ (Local Recording) lưu về máy theo các khung thời gian định sẵn, hoạt động **100% tự động, zero-prompt** trên cả hai hệ điều hành **Windows** và **Linux**.

---

## 📌 1. Quy tắc Đặt Tên Phòng Họp & Tệp Video

### 1.1. Tên phòng họp
Tên phòng họp được tạo tự động theo công thức ISO 8601:
```
Staff{Năm}W{Số tuần trong năm}T{Thứ trong tuần}
```
Trong đó:
- `{Năm}`: Năm hiện tại (ví dụ: `2026`).
- `W{Số tuần trong năm}`: Số thứ tự tuần theo chuẩn quốc tế ISO 8601 (ví dụ tuần `41`).
- `T{Thứ trong tuần}`: Số thứ tự thứ theo quy ước:
  - **Thứ 2**: `2`, **Thứ 3**: `3`, **Thứ 4**: `4`, **Thứ 5**: `5`, **Thứ 6**: `6`, **Thứ 7**: `7`, **Chủ nhật**: `8`.

👉 **Ví dụ**: Ngày 09/10/2026 (Thứ 6, tuần 41) $\rightarrow$ Tên phòng là: **`Staff2026W41T6`**.

### 1.2. Định dạng tên tệp video ghi hình
Tệp video xuất ra tuân thủ nghiêm ngặt chuẩn hệ thống tệp **Windows NTFS** và **Linux POSIX** (không chứa ký tự cấm `:`, `\`, `/`, `?`, `*`, `|`, `"`, `<`, `>`):
```
Staff{Year}W{Week}T{Day}_{YYYY-MM-DD}_{HH-MM-SS}.webm
```
👉 **Ví dụ**: `Staff2026W41T6_2026-10-09_10-32-31.webm`.
- Tệp được lưu trực tiếp vào thư mục con: `Downloads/AutoMeet_Recordings/`.
- Không kích hoạt hộp thoại "Save As" hỏi vị trí lưu file (Zero-Prompt Automation).

---

## ⏰ 2. Lịch Trình Record Mặc Định

| Ca trực | Giờ Bật Record | Giờ Tắt Record | Thời lượng | Ghi chú |
| :--- | :---: | :---: | :---: | :--- |
| **Ca sáng** | `07:30` | `11:30` | 4 tiếng | Tự động ghi và lưu video vào thư mục Downloads |
| **Ca chiều** | `13:00` | `17:00` | 4 tiếng | Tự động ghi và lưu video vào thư mục Downloads |
| **Ca tối** | `22:00` | `24:00` | 2 tiếng | Tự động kết thúc lúc nửa đêm |

*(Bạn có thể dễ dàng bật/tắt hoặc tùy biến thêm ca trong trang **Cài đặt (Options)** của Extension).*

---

## 🪟 3. Hướng Dẫn Dành Cho Người Dùng Windows

### Bước 1: Nạp Extension vào Google Chrome hoặc Microsoft Edge
1. Mở trình duyệt và truy cập:
   - Trên Google Chrome: `chrome://extensions/`
   - Trên Microsoft Edge: `edge://extensions/`
2. Bật công tắc **Developer mode (Chế độ dành cho nhà phát triển)** ở góc trên bên phải.
3. Nhấp vào nút **Load unpacked (Tải tiện ích đã giải nén)** ở góc trên bên trái.
4. Chọn thư mục dự án `automeet`.
5. Ghim (Pin) biểu tượng AutoMeet lên thanh tiện ích để dễ dàng theo dõi trạng thái.

### Bước 2: Tạo Desktop Shortcut tự động hóa
1. Mở thư mục `automeet\scripts\`.
2. Bạn có thể sử dụng một trong hai công cụ:
   - **Tùy chọn A (Khuyến nghị)**: Nhấp đúp chuột vào file:
     ```cmd
     scripts\create-windows-shortcut.bat
     ```
   - **Tùy chọn B (VBScript độc lập)**: Nhấp đúp chuột vào file:
     ```cmd
     scripts\create-windows-shortcut.vbs
     ```
3. Script sẽ tự động dò tìm vị trí cài đặt Google Chrome hoặc Microsoft Edge (hỗ trợ cả bản 64-bit, 32-bit, User-local và Registry App Paths), sau đó tạo shortcut **AutoMeet Chrome** ngay trên màn hình Desktop của bạn.
4. Tự động hỗ trợ đồng bộ Desktop khi người dùng kích hoạt sao lưu **OneDrive**: shortcut xuất hiện đồng thời trên cả màn hình Desktop cá nhân lẫn thư mục Desktop của OneDrive.

### Bước 3: Khởi chạy và kiểm tra
1. Nhấp đúp vào shortcut **AutoMeet Chrome** trên Desktop (hoặc chạy trực tiếp `scripts\start-chrome-auto.bat`).
   *(Bạn cũng có thể truyền URL phòng cụ thể nếu muốn: `scripts\start-chrome-auto.bat https://meet.jit.si/TenPhongTuyChon`).*
2. Trình duyệt sẽ khởi chạy với các cờ bypass tự động cấp quyền:
   ```cmd
   --auto-select-tab-capture-source-by-title="Staff"
   --auto-select-desktop-capture-source="Staff"
   --auto-select-tab-capture-source-by-title="Jitsi Meet"
   --auto-select-desktop-capture-source="Jitsi Meet"
   ```
   *(Tuyệt đối không dùng cờ `--use-fake-ui-for-media-stream` để đảm bảo micro và webcam thật của bạn hoạt động bình thường).*
3. Trình duyệt tự động mở phòng họp của ngày hôm nay, tự vượt qua màn hình Pre-join và bắt đầu ghi hình khi tới ca mà không hiện bất kỳ popup hay yêu cầu chọn nguồn màn hình nào.
4. Khi kết thúc ca, video WebM sẽ tự động tải vào:
   ```cmd
   C:\Users\<Tên_bạn>\Downloads\AutoMeet_Recordings\
   ```

---

## 🐧 4. Hướng Dẫn Dành Cho Người Dùng Linux

### Bước 1: Nạp Extension vào Chrome / Chromium
1. Mở Google Chrome hoặc Chromium và truy cập `chrome://extensions/`.
2. Bật công tắc **Developer mode**.
3. Nhấp vào **Load unpacked** và chọn thư mục dự án `automeet`.

### Bước 2: Tạo Desktop Shortcut / Application Launcher
1. Mở Terminal trong thư mục dự án và chạy script cài đặt shortcut:
   ```bash
   ./scripts/create-linux-shortcut.sh
   ```
2. Script sẽ:
   - Cài đặt launcher `automeet.desktop` vào `~/.local/share/applications/` (xuất hiện trong Menu ứng dụng hệ thống GNOME, KDE, XFCE).
   - Tạo shortcut ra màn hình Desktop (`~/Desktop/automeet.desktop`) và cấp quyền thực thi `trusted`.

### Bước 3: Khởi chạy và kiểm tra
1. Bạn có thể mở AutoMeet từ:
   - Shortcut trên màn hình Desktop.
   - Tìm kiếm "AutoMeet Chrome" trong App Launcher.
   - Hoặc chạy script từ dòng lệnh (hỗ trợ cả Snap, Flatpak, deb/rpm):
     ```bash
     ./scripts/start-chrome-auto.sh
     ```
     *(Có thể truyền tham số URL tùy chọn: `./scripts/start-chrome-auto.sh https://meet.jit.si/TenPhongTuyChon`).*
2. Trình duyệt sẽ khởi động với 4 cờ `--auto-select-*` bypass hoàn toàn hộp thoại cấp quyền ghi hình.
3. Video xuất ra được lưu tự động tại:
   ```bash
   ~/Downloads/AutoMeet_Recordings/
   ```

---

## 🎬 5. Khả Năng Tương Thích & Tua Video (Seekable WebM)

Jitsi Meet Local Recording mặc định có lỗi đặt thời lượng dự trữ là `240:00:00` (864 triệu mili-giây) dẫn đến video không thể tua và hiển thị sai thời lượng.

AutoMeet tích hợp lớp **`VirtualFileStream`** xử lý chuyên sâu:
1. **Xử lý ghi đè `seek(0)`**: Bắt đúng thao tác của Jitsi khi kết thúc phiên ghi để cập nhật kích thước và header chính xác.
2. **Vá trường EBML Duration (`0x44 0x89`)**: Tự động quét và vá nhị phân độ dài chính xác tính theo mili-giây thời lượng thực tế của phiên họp.
3. **Kiểm chứng đa nền tảng**:
   - **Windows**: Chạy mượt mà trên Windows Media Player, VLC for Windows, Chrome, Edge. Tua đến bất kỳ mốc thời gian nào không bị giật, lag.
   - **Linux**: Phát chuẩn xác trên VLC, mpv, ffplay, Chrome/Chromium. Kiểm tra qua `ffprobe` hiển thị đúng bitrate và duration chuẩn đến từng mili-giây.

---

## 📂 6. Cấu Trúc Mã Nguồn

```
automeet/
├── manifest.json                  # Cấu hình Manifest V3 (downloads, alarms, storage, tabs)
├── utils.js                       # Tiện ích ISO 8601, lịch trình và chuẩn hóa đường dẫn cross-platform
├── background.js                  # Service Worker lập lịch, điều phối tab và quản lý downloads
├── content/
│   ├── inpage.js                  # Chạy tại MAIN world: VirtualFileStream, vá EBML, hook showSaveFilePicker
│   ├── content.js                 # Điều khiển giao diện Jitsi (pre-join, auto-click, HUD đồng bộ)
│   └── content.css                # Style HUD hiển thị trạng thái
├── popup/
│   ├── popup.html                 # Giao diện điều khiển nhanh
│   └── popup.js                   # Logic Popup & chọn thư mục lưu trữ
├── options/
│   ├── options.html               # Trang cài đặt cấu hình nâng cao
│   └── options.js                 # Quản lý danh sách ca trực & lưu trữ
├── icons/                         # Biểu tượng 16x16, 48x48, 128x128
├── scripts/
│   ├── start-chrome-auto.bat      # Windows: Khởi chạy Chrome/Edge với 4 cờ auto-select
│   ├── start-chrome-auto.sh       # Linux: Khởi chạy Chrome/Chromium với 4 cờ auto-select
│   ├── create-windows-shortcut.bat# Windows: Tạo Desktop Shortcut với cờ auto-select (Batch)
│   ├── create-windows-shortcut.vbs# Windows: Tạo Desktop Shortcut với cờ auto-select (VBScript)
│   └── create-linux-shortcut.sh   # Linux: Tạo .desktop launcher cho Desktop và App Menu
└── README.md                      # Tài liệu hướng dẫn chi tiết đa nền tảng
```
