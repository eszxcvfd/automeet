#!/usr/bin/env bash
# ==============================================================================
# AutoMeet - Create Desktop Shortcut / Launcher on Linux
# Cài đặt file .desktop vào ~/.local/share/applications và Desktop
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ICON_PATH="$PROJECT_ROOT/icons/icon-128.png"
LAUNCHER_SCRIPT="$PROJECT_ROOT/scripts/start-chrome-auto.sh"

echo "======================================================"
echo "   AutoMeet - Cài đặt Desktop Shortcut trên Linux"
echo "======================================================"
echo "Thư mục dự án: $PROJECT_ROOT"

# Đảm bảo launcher script có quyền thực thi
chmod +x "$LAUNCHER_SCRIPT"

# 1. Tạo nội dung file .desktop
DESKTOP_CONTENT="[Desktop Entry]
Version=1.0
Type=Application
Name=AutoMeet Chrome
Comment=Khởi chạy Google Chrome với chế độ Tự động cấp quyền Tab Capture AutoMeet
Exec=/bin/bash \"$LAUNCHER_SCRIPT\"
Icon=$ICON_PATH
Terminal=false
Categories=Network;WebBrowser;
StartupNotify=true
"

# 2. Cài đặt vào ~/.local/share/applications/ (Menu ứng dụng của hệ thống)
APP_DIR="$HOME/.local/share/applications"
mkdir -p "$APP_DIR"
APP_DESKTOP_FILE="$APP_DIR/automeet.desktop"
echo "$DESKTOP_CONTENT" > "$APP_DESKTOP_FILE"
chmod +x "$APP_DESKTOP_FILE"
echo "✅ Đã cài đặt launcher vào menu ứng dụng: $APP_DESKTOP_FILE"

# Cập nhật desktop database nếu công cụ có sẵn
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database "$APP_DIR" 2>/dev/null || true
fi

# 3. Cài đặt ra màn hình Desktop (nếu thư mục Desktop tồn tại)
DESKTOP_DIR=""
if command -v xdg-user-dir &> /dev/null; then
    DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
fi
if [ -z "$DESKTOP_DIR" ] || [ ! -d "$DESKTOP_DIR" ]; then
    DESKTOP_DIR="$HOME/Desktop"
fi

if [ -d "$DESKTOP_DIR" ]; then
    DESKTOP_SHORTCUT="$DESKTOP_DIR/automeet.desktop"
    echo "$DESKTOP_CONTENT" > "$DESKTOP_SHORTCUT"
    chmod +x "$DESKTOP_SHORTCUT"

    # Cho phép chạy trên môi trường GNOME / KDE nếu có lệnh gio
    if command -v gio &> /dev/null; then
        gio set "$DESKTOP_SHORTCUT" metadata::trusted true 2>/dev/null || true
    fi
    echo "✅ Đã tạo shortcut ra màn hình Desktop: $DESKTOP_SHORTCUT"
else
    echo "ℹ️  Không tìm thấy thư mục Desktop ($DESKTOP_DIR). Đã cài đặt vào menu ứng dụng."
fi

echo ""
echo "🎉 Hoàn tất! Bạn có thể khởi động AutoMeet trực tiếp từ Desktop hoặc Menu ứng dụng."
