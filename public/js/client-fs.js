/**
 * Client-Side File System Manager
 * Hỗ trợ chọn thư mục và tự động tạo thư mục, lưu file trực tiếp trên ổ cứng máy Client (Mac / Windows)
 */

let _localDirHandle = null;
const DIR_HANDLE_DB_KEY = 'fb_local_dir_handle';

/**
 * Kiểm tra xem trình duyệt có hỗ trợ File System Access API không (Chrome, Edge trên Mac/Win)
 */
function isFileSystemAccessSupported() {
    return typeof window.showDirectoryPicker === 'function';
}

/**
 * Mở hộp thoại chọn thư mục lưu trữ trên máy Client
 */
async function selectLocalFolder() {
    if (!isFileSystemAccessSupported()) {
        throw new Error('Trình duyệt hiện tại (như Safari) không hỗ trợ chọn thư mục trực tiếp. File sẽ được tải tự động về thư mục Downloads của máy bạn.');
    }

    try {
        const dirHandle = await window.showDirectoryPicker({
            id: 'fb_automation_dir',
            mode: 'readwrite',
            startIn: 'documents'
        });

        _localDirHandle = dirHandle;
        localStorage.setItem('fb_local_folder_name', dirHandle.name);

        // Tự động tạo sẵn 2 thư mục con trên máy Client: "exports" và "data"
        await dirHandle.getDirectoryHandle('exports', { create: true });
        await dirHandle.getDirectoryHandle('data', { create: true });

        console.log(`[ClientFS] Đã kết nối thư mục trên máy Client: ${dirHandle.name}`);
        return dirHandle.name;
    } catch (err) {
        if (err.name === 'AbortError') {
            return null; // Người dùng bấm Hủy
        }
        throw err;
    }
}

/**
 * Lấy tên thư mục đã kết nối trước đó (nếu có)
 */
function getConnectedFolderName() {
    return localStorage.getItem('fb_local_folder_name') || null;
}

/**
 * Hủy kết nối thư mục máy Client
 */
function disconnectLocalFolder() {
    _localDirHandle = null;
    localStorage.removeItem('fb_local_folder_name');
}

/**
 * Ghi file trực tiếp vào thư mục trên máy Client (hoặc fallback tải về)
 * @param {string} subfolder - 'exports' hoặc 'data'
 * @param {string} filename - Tên file (ví dụ: export_2026.xlsx)
 * @param {Blob|ArrayBuffer|string} content - Nội dung file
 * @param {string} mimeType - Kiểu file (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, v.v.)
 */
async function saveFileToClient(subfolder, filename, content, mimeType = 'application/octet-stream') {
    let blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });

    // 1. Thử ghi trực tiếp vào thư mục đã chọn trên máy Client (nếu có quyền)
    if (_localDirHandle) {
        try {
            // Xác minh lại quyền ghi
            const options = { mode: 'readwrite' };
            if ((await _localDirHandle.queryPermission(options)) !== 'granted') {
                if ((await _localDirHandle.requestPermission(options)) !== 'granted') {
                    throw new Error('Quyền ghi vào thư mục bị từ chối');
                }
            }

            // Lấy hoặc tạo thư mục con (exports hoặc data)
            const targetDir = subfolder 
                ? await _localDirHandle.getDirectoryHandle(subfolder, { create: true }) 
                : _localDirHandle;

            // Tạo file và ghi dữ liệu
            const fileHandle = await targetDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            console.log(`[ClientFS] Đã ghi thành công file vào thư mục máy Client: ${subfolder}/${filename}`);
            return { success: true, path: `${_localDirHandle.name}/${subfolder}/${filename}`, directWrite: true };
        } catch (err) {
            console.warn('[ClientFS] Không thể ghi trực tiếp, chuyển sang tải về trình duyệt:', err);
        }
    }

    // 2. Fallback: Kích hoạt tải về tự động (Downloads folder)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    return { success: true, filename, directWrite: false };
}

window.ClientFS = {
    isSupported: isFileSystemAccessSupported,
    selectFolder: selectLocalFolder,
    getFolderName: getConnectedFolderName,
    disconnect: disconnectLocalFolder,
    saveFile: saveFileToClient
};
