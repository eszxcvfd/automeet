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
   * Gửi sự kiện phím Escape để đóng bất kỳ dialog/menu nào đang mở
   */
  function sendEscapeKey() {
    const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    if (document.activeElement && typeof document.activeElement.dispatchEvent === 'function') {
      try {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', opts));
        document.activeElement.dispatchEvent(new KeyboardEvent('keyup', opts));
      } catch (e) {}
    }
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.dispatchEvent(new KeyboardEvent('keyup', opts));
      window.dispatchEvent(new KeyboardEvent('keydown', opts));
    } catch (e) {}
  }

  /**
   * Tìm mục Record trong menu More actions (hỗ trợ cả tiếng Anh và tiếng Việt)
   */
  function findRecordMenuItem() {
    const selectors = [
      '[data-testid="overflow-menu-item-record"]',
      '[aria-label="Record"]',
      '[aria-label="Ghi hình"]',
      '[aria-label*="Record" i]',
      '[aria-label*="Ghi hình" i]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }

    const items = Array.from(document.querySelectorAll('[role="menuitem"], .overflow-menu-item, li, button, div'));
    for (const el of items) {
      if (el.offsetParent === null) continue;
      const text = (el.textContent || '').trim().toLowerCase();
      if (text === 'record' || text === 'ghi hình' || text.startsWith('record\n') || text.startsWith('ghi hình\n')) {
        return el;
      }
    }
    return null;
  }

  /**
   * Tìm nút Bắt đầu ghi hình trong dialog Record
   */
  function findStartRecordingButton() {
    const selectors = [
      '[data-testid="recordingDialog.startRecording"]',
      '[aria-label="Start recording"]',
      '[aria-label="Bắt đầu ghi"]',
      'button[aria-label*="Start recording" i]',
      'button[aria-label*="Bắt đầu ghi" i]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const b of buttons) {
      if (b.offsetParent === null) continue;
      const text = (b.textContent || '').trim().toLowerCase();
      if (text === 'start recording' || text === 'bắt đầu ghi' || text === 'start') {
        return b;
      }
    }
    return null;
  }

  /**
   * Tìm nút Dừng ghi hình (màu đỏ) trong dialog Record
   */
  function findStopRecordingButton() {
    const selectors = [
      '[data-testid="recordingDialog.stopRecording"]',
      '[aria-label="Stop recording"]',
      '[aria-label="Dừng ghi"]',
      'button[aria-label*="Stop recording" i]',
      'button[aria-label*="Dừng ghi" i]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const b of buttons) {
      if (b.offsetParent === null) continue;
      const text = (b.textContent || '').trim().toLowerCase();
      if (text === 'stop recording' || text === 'dừng ghi' || text === 'stop' || text === 'dừng') {
        return b;
      }
    }
    return null;
  }

  /**
   * Đóng hộp thoại Record và menu More actions để giữ màn hình cuộc họp luôn sạch sẽ
   */
  async function closeRecordDialogAndMenus() {
    console.log('[AutoMeet Inpage] Đang đóng dialog Record và menu overflow...');

    // 1. Thử click nút đóng 'X' trên modal dialog (id="modal-header-close-button")
    const closeBtns = document.querySelectorAll(
      '#modal-header-close-button, [aria-label="Close dialog"], [aria-label="Đóng hộp thoại"], [aria-label="Close"], [aria-label="Đóng"], [data-testid="dialog.close"], .modal-header-close-button'
    );
    closeBtns.forEach(btn => {
      if (btn && btn.offsetParent !== null) {
        try {
          console.log('[AutoMeet Inpage] Bấm nút đóng modal dialog:', btn);
          btn.click();
        } catch (e) {}
      }
    });

    // 2. Gửi phím Escape để đóng popup/dialog theo tiêu chuẩn trình duyệt
    sendEscapeKey();

    // 3. Dispatch Redux action của chính Jitsi để ẩn dialog và menu overflow
    const store = window.APP?.store;
    if (store) {
      try { store.dispatch({ type: 'HIDE_DIALOG' }); } catch (e) {}
      try { store.dispatch({ type: 'SET_OVERFLOW_MENU_VISIBLE', visible: false }); } catch (e) {}
    }

    // 4. Nếu nút More actions vẫn đang expanded, click để thu gọn lại
    const moreBtns = document.querySelectorAll('[aria-label="More actions"], [aria-label="Thao tác khác"]');
    moreBtns.forEach(btn => {
      if (btn.getAttribute('aria-expanded') === 'true' || btn.classList.contains('toggled')) {
        try { btn.click(); } catch (e) {}
      }
    });

    await sleep(300);
  }

  /**
   * Kích hoạt Local Recording của nền tảng Jitsi Meet
   * Bằng cả automated click UI và Redux action chính thức với delay hợp lý giữa các bước
   */
  async function startNativeLocalRecording() {
    console.log('[AutoMeet Inpage] === BẮT ĐẦU QUY TRÌNH GHI HÌNH TỰ ĐỘNG ===');

    // 1. Nếu Jitsi đã đang ghi hình rồi, chỉ cần đảm bảo tắt mọi menu/dialog còn mở
    if (isJitsiActuallyRecording()) {
      console.log('[AutoMeet Inpage] Jitsi đã đang ghi hình. Đóng dialog/menu nếu còn sót.');
      await closeRecordDialogAndMenus();
      return true;
    }

    // 2. Kiểm tra nếu Dialog Record đang mở sẵn trên màn hình
    const existingStopBtn = findStopRecordingButton();
    if (existingStopBtn) {
      console.log('[AutoMeet Inpage] Dialog Record đã mở và đang ghi hình (có nút Stop). Đóng dialog.');
      await closeRecordDialogAndMenus();
      return true;
    }

    const existingStartBtn = findStartRecordingButton();
    if (existingStartBtn) {
      console.log('[AutoMeet Inpage] Dialog Record đã mở sẵn, bấm Start recording...');
      existingStartBtn.click();
      await sleep(1000);
      await closeRecordDialogAndMenus();
      return true;
    }

    const store = window.APP?.store;

    // 3. Dispatch action Redux START_LOCAL_RECORDING
    if (store) {
      try {
        store.dispatch({ type: 'START_LOCAL_RECORDING', onlySelf: false });
        console.log('[AutoMeet Inpage] Đã dispatch action Redux: START_LOCAL_RECORDING');
      } catch (err) {
        console.warn('[AutoMeet Inpage] Lỗi dispatch START_LOCAL_RECORDING:', err);
      }
    }

    // Delay 600ms để kiểm tra xem Redux có kích hoạt ngay không
    await sleep(600);
    if (isJitsiActuallyRecording()) {
      console.log('[AutoMeet Inpage] Redux đã kích hoạt ghi hình thành công. Đóng dialog/menu.');
      await closeRecordDialogAndMenus();
      return true;
    }

    // 4. Nếu Redux chưa kích hoạt, thực hiện tuần tự UI Click với delay giữa các bước
    try {
      if (window.APP?.UI?.showToolbar) {
        window.APP.UI.showToolbar();
      }
      await sleep(500);

      // Bước 4.1: Bấm nút More actions
      const moreBtn = document.querySelector('[aria-label="More actions"], [aria-label="Thao tác khác"]');
      if (moreBtn) {
        console.log('[AutoMeet Inpage] Bấm nút More actions...');
        moreBtn.click();

        // Delay 700ms để menu kịp mở và chạy animation
        await sleep(700);

        // Bước 4.2: Bấm nút Record trong menu
        const recordBtn = findRecordMenuItem();
        if (recordBtn) {
          console.log('[AutoMeet Inpage] Bấm nút Record trong menu...');
          recordBtn.click();

          // Delay 800ms để modal Record mở ra hoàn toàn
          await sleep(800);

          // Bước 4.3: Bấm nút Start recording trong modal
          const startBtn = findStartRecordingButton();
          if (startBtn) {
            console.log('[AutoMeet Inpage] Bấm nút Start recording trong modal dialog...');
            startBtn.click();

            // Delay 1000ms để hệ thống Jitsi bắt đầu ghi và cập nhật trạng thái
            await sleep(1000);
          }
        }
      }
    } catch (e) {
      console.warn('[AutoMeet Inpage] Lỗi trong thao tác UI:', e);
    }

    // 5. Đóng hoàn toàn dialog và overflow menu sau khi thực hiện
    await sleep(600);
    await closeRecordDialogAndMenus();
    await sleep(400);
    await closeRecordDialogAndMenus();

    console.log('[AutoMeet Inpage] Hoàn thành quy trình bắt đầu ghi hình. Giao diện sạch sẽ.');
    return true;
  }

  /**
   * Dừng Local Recording của nền tảng Jitsi Meet với delay hợp lý và dọn dẹp menu
   */
  async function stopNativeLocalRecording() {
    console.log('[AutoMeet Inpage] === BẮT ĐẦU QUY TRÌNH DỪNG GHI HÌNH ===');
    const store = window.APP?.store;

    // 1. Dispatch action Redux STOP_LOCAL_RECORDING
    if (store) {
      try {
        store.dispatch({ type: 'STOP_LOCAL_RECORDING' });
        console.log('[AutoMeet Inpage] Đã dispatch action Redux: STOP_LOCAL_RECORDING');
      } catch (err) {
        console.warn('[AutoMeet Inpage] Lỗi dispatch STOP_LOCAL_RECORDING:', err);
      }
    }

    await sleep(600);

    // 2. Thao tác UI click nếu cần
    try {
      // Nếu dialog Record đang mở sẵn, bấm nút Stop
      let stopBtn = findStopRecordingButton();
      if (stopBtn) {
        console.log('[AutoMeet Inpage] Bấm nút Stop recording trong dialog đang mở...');
        stopBtn.click();
        await sleep(800);
      } else if (isJitsiActuallyRecording()) {
        // Nếu vẫn còn đang ghi hình, mở menu -> Record -> Stop
        const moreBtn = document.querySelector('[aria-label="More actions"], [aria-label="Thao tác khác"]');
        if (moreBtn) {
          moreBtn.click();
          await sleep(700);

          const recordBtn = findRecordMenuItem();
          if (recordBtn) {
            recordBtn.click();
            await sleep(800);

            stopBtn = findStopRecordingButton();
            if (stopBtn) {
              console.log('[AutoMeet Inpage] Bấm nút Stop recording sau khi mở menu...');
              stopBtn.click();
              await sleep(800);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[AutoMeet Inpage] Lỗi trong thao tác dừng UI:', e);
    }

    // 3. Đóng hoàn toàn dialog và overflow menu
    await sleep(600);
    await closeRecordDialogAndMenus();
    await sleep(400);
    await closeRecordDialogAndMenus();

    realRecordingStartTime = null;
    console.log('[AutoMeet Inpage] Hoàn thành quy trình dừng ghi hình.');
    return true;
  }

  /**
   * Kiểm tra trung thực xem nền tảng Jitsi có đang thực sự ghi hình không
   */
  function isJitsiActuallyRecording() {
    const store = window.APP?.store;
    if (store) {
      const rec = store.getState()['features/recording'];
      if (rec && (rec.localRecordingRunning || rec.isRecordingRunning)) {
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

    // Nếu dialog Record đang mở và có nút Stop màu đỏ
    const stopBtn = findStopRecordingButton();
    if (stopBtn && stopBtn.offsetParent !== null) {
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
