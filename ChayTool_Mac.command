#!/bin/bash
# Script khởi chạy FB Automation Lite trên macOS
cd "$(dirname "$0")"

clear
echo "============================================================"
echo "        FB AUTOMATION LITE - KHỞI CHẠY TRÊN MACOS"
echo "============================================================"
echo ""

# 1. Kiểm tra Node.js
if ! command -v node &> /dev/null; then
    echo "[LỖI] Máy Mac của bạn chưa cài đặt Node.js!"
    echo "Vui lòng truy cập https://nodejs.org để tải và cài đặt Node.js (bản LTS)."
    echo ""
    read -p "Nhấn Enter để thoát..."
    exit 1
fi

echo "Đã tìm thấy Node.js: $(node -v)"

# 2. Kiểm tra node_modules
if [ ! -d "node_modules" ]; then
    echo "[1/3] Lần đầu chạy, đang tự động cài đặt thư viện..."
    npm install --omit=dev
fi

# 3. Kiểm tra Chromium của Playwright trên macOS
echo "[2/3] Đảm bảo trình duyệt Chromium sẵn sàng..."
npx playwright install chromium 2>/dev/null || true

# 4. Khởi động Web App & Tự mở trình duyệt
echo "[3/3] Đang khởi động FB Automation Lite trên cổng 3001..."
echo "Ứng dụng sẽ tự động mở tại: http://localhost:3001"
echo "Dữ liệu (session, cookie, data, exports) được lưu trực tiếp trên máy Mac này."
echo ""

sleep 2
open "http://localhost:3001" 2>/dev/null || true

npm start
