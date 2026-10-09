/**
 * AutoMeet - In-page script running in MAIN world
 * Tuân thủ tuyệt đối:
 * 1. KHÔNG thay thế bất kỳ chức năng nào của hệ thống (KHÔNG đụng vào getDisplayMedia -> Chia sẻ màn hình 100% nguyên bản).
 * 2. Tự động hóa hoàn toàn: Tham gia vào click & dispatch các lệnh Native Local Recording của chính nền tảng Jitsi Meet.
 * 3. Chặn hộp thoại "Save As" khi lưu: Tự động lưu video thẳng vào thư mục đã chọn trước đó qua Chrome Downloads API.
 * 4. Đồng bộ trung thực trạng thái REC từ Redux và nhãn REC thật trên màn hình.
 */
(function () {
  'use strict';

  if (window.__AUTOMEET_INPAGE_INITIALIZED__) {
    console.log('[AutoMeet Inpage] Script already initialized.');
    return;
  }
  window.__AUTOMEET_INPAGE_INITIALIZED__ = true;

  console.log('[AutoMeet Inpage] Initializing native hooks in MAIN world...');

  let realRecordingStartTime = null;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * IndexedDB Helper để lấy DirectoryHandle đã cấp quyền (nếu có)
   */
  async function getSavedDirectoryHandle() {
    try {
      if (typeof indexedDB === 'undefined') return null;
      return new Promise((resolve) => {
        const req = indexedDB.open('AutoMeetStorage', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('handles');
        };
        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction('handles', 'readonly');
            const getReq = tx.objectStore('handles').get('recordingDir');
            getReq.onsuccess = () => resolve(getReq.result || null);
            getReq.onerror = () => resolve(null);
          } catch (e) {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  /**
   * HOOK: window.showSaveFilePicker
   * Jitsi Meet Local Recording gọi hàm này để mở hộp thoại "Save As".
   * Chúng ta thu thập chunks ghi hình và tự động lưu vào thư mục người dùng đã chọn trước,
   * hoàn toàn tự động, người dùng KHÔNG cần phải thao tác chọn file thủ công khi ca bắt đầu.
   */
  if (typeof window.showSaveFilePicker !== 'undefined') {
    window.showSaveFilePicker = async function (options) {
      console.log('[AutoMeet Inpage] showSaveFilePicker called by Jitsi. Providing automatic stream to saved location...');

      const chunks = [];
      let isClosed = false;

      // 1. Thử ghi trực tiếp vào FileSystemDirectoryHandle nếu người dùng đã cấp quyền trên trang
      let directWritable = null;
      try {
        const dirHandle = await getSavedDirectoryHandle();
        if (dirHandle && typeof dirHandle.getFileHandle === 'function') {
          const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            const now = new Date();
            const y = now.getFullYear();
            const mo = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const h = String(now.getHours()).padStart(2, '0');
            const mi = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            const room = window.location.pathname.replace(/^\/+|\/+$/g, '') || 'StaffMeet';
            const cleanFilename = `${room}_${y}-${mo}-${d}_${h}-${mi}-${s}.webm`;

            const targetFileHandle = await dirHandle.getFileHandle(cleanFilename, { create: true });
            directWritable = await targetFileHandle.createWritable();
            console.log('[AutoMeet Inpage] Đã mở luồng ghi trực tiếp vào thư mục đã chọn:', cleanFilename);
          }
        }
      } catch (err) {
        console.log('[AutoMeet Inpage] Bỏ qua ghi trực tiếp thư mục, dùng luồng Downloads:', err);
      }

      const mockWritable = {
        write: async function (data) {
          chunks.push(data);
          if (directWritable) {
            try { await directWritable.write(data); } catch (e) {}
          }
        },
        seek: async function (pos) {
          if (directWritable) {
            try { await directWritable.seek(pos); } catch (e) {}
          }
        },
        truncate: async function (size) {
          if (directWritable) {
            try { await directWritable.truncate(size); } catch (e) {}
          }
        },
        close: async function () {
          if (isClosed) return;
          isClosed = true;
          console.log('[AutoMeet Inpage] Writable stream closed. Collected chunks:', chunks.length);

          if (directWritable) {
            try { await directWritable.close(); } catch (e) {}
          }

          if (chunks.length === 0) {
            console.warn('[AutoMeet Inpage] Chunks trống, bỏ qua lưu file.');
            return;
          }

          const blob = new Blob(chunks, { type: 'video/webm' });
          console.log('[AutoMeet Inpage] Video hoàn tất, dung lượng:', blob.size, 'bytes');

          // Đặt tên file chuẩn: Staff{Năm}W{Tuần}T{Thứ}_{ThờiGian}.webm
          const now = new Date();
          const y = now.getFullYear();
          const mo = String(now.getMonth() + 1).padStart(2, '0');
          const d = String(now.getDate()).padStart(2, '0');
          const h = String(now.getHours()).padStart(2, '0');
          const mi = String(now.getMinutes()).padStart(2, '0');
          const s = String(now.getSeconds()).padStart(2, '0');
          const room = window.location.pathname.replace(/^\/+|\/+$/g, '') || 'StaffMeet';
          const cleanFilename = `${room}_${y}-${mo}-${d}_${h}-${mi}-${s}.webm`;

          const blobUrl = URL.createObjectURL(blob);

          // 1. Tải về máy qua thẻ <a>
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = blobUrl;
          a.download = cleanFilename;
          document.body.appendChild(a);
          a.click();
          console.log(`[AutoMeet Inpage] Đã kích hoạt lưu video: ${cleanFilename}`);

          setTimeout(() => {
            a.remove();
          }, 60000);

          // 2. Gửi thông điệp đến Content Script -> Background để tải vào thư mục con đã cấu hình
          window.postMessage({
            type: 'AUTOMEET_FILE_RECORDED',
            url: blobUrl,
            filename: cleanFilename,
            size: blob.size
          }, '*');
        }
      };

      return {
        kind: 'file',
        name: options?.suggestedName || 'recording.webm',
        createWritable: async function () {
          chunks.length = 0;
          isClosed = false;
          return mockWritable;
        }
      };
    };
  }

  /**
   * Kích hoạt Local Recording của nền tảng Jitsi Meet
   * Bằng cả automated click UI và Redux action chính thức
   */
  async function startNativeLocalRecording() {
    console.log('[AutoMeet Inpage] Kích hoạt Native Local Recording của Jitsi Meet...');
    const store = window.APP?.store;

    // 1. Nếu Redux store đã sẵn sàng, dispatch action START_LOCAL_RECORDING
    if (store) {
      try {
        store.dispatch({ type: 'START_LOCAL_RECORDING', onlySelf: false });
        console.log('[AutoMeet Inpage] Đã dispatch action START_LOCAL_RECORDING.');
      } catch (err) {
        console.warn('[AutoMeet Inpage] Lỗi dispatch START_LOCAL_RECORDING:', err);
      }
    }

    // 2. Automated click UI: Nếu hộp thoại Record đang mở hoặc cần mở
    try {
      if (window.APP?.UI?.showToolbar) {
        window.APP.UI.showToolbar();
      }

      // Nếu nút Start recording trong dialog đang có, bấm ngay
      let startBtn = document.querySelector('[data-testid="recordingDialog.startRecording"], [aria-label="Start recording"]');
      if (startBtn) {
        startBtn.click();
        return true;
      }

      // Nếu chưa mở dialog, mở More actions -> Record -> Start
      const moreBtn = document.querySelector('[aria-label="More actions"]');
      if (moreBtn) {
        moreBtn.click();
        await sleep(300);
        const recordBtn = Array.from(document.querySelectorAll('*')).find(
          el => el.getAttribute('aria-label') === 'Record' || el.innerText === 'Record'
        );
        if (recordBtn) {
          recordBtn.click();
          await sleep(400);
          startBtn = document.querySelector('[data-testid="recordingDialog.startRecording"], [aria-label="Start recording"]');
          if (startBtn) {
            startBtn.click();
          }
        }
      }
    } catch (e) {
      console.warn('[AutoMeet Inpage] Lỗi automated click UI:', e);
    }

    return true;
  }

  /**
   * Dừng Local Recording của nền tảng Jitsi Meet
   */
  async function stopNativeLocalRecording() {
    console.log('[AutoMeet Inpage] Dừng Native Local Recording của Jitsi Meet...');
    const store = window.APP?.store;

    // 1. Dispatch action STOP_LOCAL_RECORDING
    if (store) {
      try {
        store.dispatch({ type: 'STOP_LOCAL_RECORDING' });
        console.log('[AutoMeet Inpage] Đã dispatch action STOP_LOCAL_RECORDING.');
      } catch (err) {
        console.warn('[AutoMeet Inpage] Lỗi dispatch STOP_LOCAL_RECORDING:', err);
      }
    }

    // 2. Automated click: Bấm nút dừng nếu dialog mở
    try {
      const stopBtn = document.querySelector('[aria-label="Stop recording"], [data-testid="recordingDialog.stopRecording"]');
      if (stopBtn) {
        stopBtn.click();
      }
    } catch (e) {}

    realRecordingStartTime = null;
    return true;
  }

  /**
   * Kiểm tra trung thực xem nền tảng Jitsi có đang thực sự ghi hình không
   */
  function isJitsiActuallyRecording() {
    const store = window.APP?.store;
    if (store) {
      const rec = store.getState()['features/recording'];
      if (rec && rec.localRecordingRunning) {
        return true;
      }
    }

    // Kiểm tra nhãn REC đỏ chính thức của Jitsi trên giao diện
    const recBadge = document.querySelector(
      '[data-testid="recording-label"], .recording-label, [aria-label*="Recording" i], .css-1u0rek3-label-clickable-withI18nextTranslation_Connect_Component__-record'
    );
    if (recBadge && recBadge.offsetParent !== null) {
      return true;
    }

    return false;
  }

  /**
   * Lắng nghe thông điệp điều khiển từ Content Script
   */
  window.addEventListener('message', async (event) => {
    if (!event.data || !event.data.type) return;

    if (event.data.type === 'AUTOMEET_START_LOCAL_REC') {
      await startNativeLocalRecording();
    } else if (event.data.type === 'AUTOMEET_STOP_LOCAL_REC') {
      await stopNativeLocalRecording();
    }
  });

  /**
   * Định kỳ đồng bộ trạng thái thực tế lên Content Script (100% trung thực)
   */
  setInterval(() => {
    try {
      const isRunning = isJitsiActuallyRecording();

      if (isRunning) {
        if (!realRecordingStartTime) {
          realRecordingStartTime = Date.now();
        }
      } else {
        realRecordingStartTime = null;
      }

      const elapsedSec = realRecordingStartTime ? Math.floor((Date.now() - realRecordingStartTime) / 1000) : 0;

      window.postMessage({
        type: 'AUTOMEET_SYNC_RECORDING_STATE',
        isRunning: isRunning,
        durationSec: elapsedSec
      }, '*');
    } catch (e) {}
  }, 1000);

  console.log('[AutoMeet Inpage] Native hooks ready.');
})();
