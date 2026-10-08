#!/usr/bin/env bash
# ==============================================================================
# Script khởi chạy Google Chrome với chế độ Tự động cấp quyền Tab Capture (Bypass popup Allow)
# Dành cho hệ điều hành Linux / macOS
# ==============================================================================

# Tìm đường dẫn binary của Chrome / Chromium
CHROME_BIN=""
if command -v google-chrome &> /dev/null; then
    CHROME_BIN="google-chrome"
elif command -v google-chrome-stable &> /dev/null; then
    CHROME_BIN="google-chrome-stable"
elif command -v chromium-browser &> /dev/null; then
    CHROME_BIN="chromium-browser"
elif command -v chromium &> /dev/null; then
    CHROME_BIN="chromium"
elif [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
    echo "❌ Không tìm thấy Google Chrome hoặc Chromium trên máy."
    exit 1
fi

echo "🚀 Đang khởi chạy Chrome với chế độ Auto-Allow Tab Capture..."
echo "Sử dụng binary: $CHROME_BIN"

"$CHROME_BIN" \
    --auto-select-desktop-capture-source="Jitsi Meet" \
    --use-fake-ui-for-media-stream \
    --enable-usermedia-screen-capturing \
    https://meet.jit.si/ &
