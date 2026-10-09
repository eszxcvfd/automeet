#!/usr/bin/env bash
# ==============================================================================
# Script khởi chạy Google Chrome / Edge với chế độ Tự động cấp quyền Tab Capture (Bypass popup Allow)
# Dành cho hệ điều hành Linux / macOS
# ==============================================================================

# Tìm đường dẫn binary của Chrome / Chromium / Edge
CHROME_BIN=""
if command -v google-chrome &> /dev/null; then
    CHROME_BIN="google-chrome"
elif command -v google-chrome-stable &> /dev/null; then
    CHROME_BIN="google-chrome-stable"
elif [ -f "/opt/google/chrome/google-chrome" ]; then
    CHROME_BIN="/opt/google/chrome/google-chrome"
elif [ -f "/usr/bin/google-chrome" ]; then
    CHROME_BIN="/usr/bin/google-chrome"
elif [ -f "/usr/bin/google-chrome-stable" ]; then
    CHROME_BIN="/usr/bin/google-chrome-stable"
elif [ -f "$HOME/.local/bin/google-chrome" ]; then
    CHROME_BIN="$HOME/.local/bin/google-chrome"
elif [ -f "$HOME/.local/bin/google-chrome-stable" ]; then
    CHROME_BIN="$HOME/.local/bin/google-chrome-stable"
elif command -v chromium-browser &> /dev/null; then
    CHROME_BIN="chromium-browser"
elif command -v chromium &> /dev/null; then
    CHROME_BIN="chromium"
elif [ -f "/snap/bin/chromium" ]; then
    CHROME_BIN="/snap/bin/chromium"
elif [ -f "/snap/bin/chromium-browser" ]; then
    CHROME_BIN="/snap/bin/chromium-browser"
elif [ -f "/usr/bin/chromium" ]; then
    CHROME_BIN="/usr/bin/chromium"
elif [ -f "/usr/bin/chromium-browser" ]; then
    CHROME_BIN="/usr/bin/chromium-browser"
elif command -v microsoft-edge &> /dev/null; then
    CHROME_BIN="microsoft-edge"
elif command -v microsoft-edge-stable &> /dev/null; then
    CHROME_BIN="microsoft-edge-stable"
elif [ -f "/opt/microsoft/msedge/msedge" ]; then
    CHROME_BIN="/opt/microsoft/msedge/msedge"
elif [ -f "/usr/bin/microsoft-edge" ]; then
    CHROME_BIN="/usr/bin/microsoft-edge"
elif command -v flatpak &> /dev/null && flatpak info com.google.Chrome &> /dev/null; then
    CHROME_BIN="flatpak run com.google.Chrome"
elif [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif [ -f "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]; then
    CHROME_BIN="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
else
    echo "❌ Không tìm thấy Google Chrome, Chromium hoặc Microsoft Edge trên máy."
    exit 1
fi

TARGET_URL="${1:-https://meet.jit.si/}"

echo "🚀 Đang khởi chạy trình duyệt với chế độ Auto-Allow Tab Capture..."
echo "Sử dụng binary: $CHROME_BIN"
echo "URL phòng: $TARGET_URL"

$CHROME_BIN \
    --auto-select-tab-capture-source-by-title="Staff" \
    --auto-select-desktop-capture-source="Staff" \
    --auto-select-tab-capture-source-by-title="Jitsi Meet" \
    --auto-select-desktop-capture-source="Jitsi Meet" \
    "$TARGET_URL" &
