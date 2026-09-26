import fs from 'fs';
import { execSync } from 'child_process';

console.log('📦 Bắt đầu quy trình đóng gói FB_Automation.exe...');

// 1. Đọc shim tương thích Node 18 & Playwright & Inspector
const rawShim = fs.readFileSync('src/core/entry-shim.cjs', 'utf8');
const minifiedShim = rawShim
  .replace(/\/\/[^\n]*/g, '') // Xóa comment một dòng
  .replace(/\s+/g, ' ')       // Thu gọn khoảng trắng
  .trim();

// 2. Chạy esbuild bundle server.js -> dist/server.cjs với shim gắn ở đầu file
console.log('⚡ Bước 1: Đóng gói mã nguồn với esbuild...');
const esbuildCommand = `npx esbuild server.js --bundle --platform=node --target=node18 --format=cjs --packages=external --banner:js="${minifiedShim.replace(/"/g, '\\"')}" --outfile=dist/server.cjs`;
execSync(esbuildCommand, { stdio: 'inherit' });

// 2.1 Chuẩn bị thư mục tài nguyên tĩnh trong dist để hỗ trợ cả đường dẫn tương đối dist/
console.log('📁 Bước 1.5: Đồng bộ assets sang dist...');
try {
  fs.cpSync('public', 'dist/public', { recursive: true });
  fs.cpSync('src/config', 'dist/config', { recursive: true });
  if (fs.existsSync('template_import_lead.xlsx')) {
    fs.copyFileSync('template_import_lead.xlsx', 'dist/template_import_lead.xlsx');
  }
} catch (copyErr) {
  console.warn('Cảnh báo khi sao chép assets sang dist:', copyErr.message);
}

// 3. Đóng gói binary duy nhất FB_Automation.exe với pkg
console.log('🔨 Bước 2: Đóng gói thành file thực thi duy nhất FB_Automation.exe...');
execSync('npx pkg@5.8.1 . --targets node18-win-x64 --output FB_Automation.exe', { stdio: 'inherit' });

console.log('✅ ĐÓNG GÓI HOÀN TẤT THÀNH CÔNG: FB_Automation.exe sẵn sàng gửi cho khách hàng!');
