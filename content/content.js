/**
 * AutoMeet - Content Script for meet.jit.si
 * Tự động hóa điều hướng, vượt pre-join, bật/tắt record và hiển thị HUD.
 */

(function () {
  'use strict';

  // Tránh inject nhiều lần
  if (window.__AUTOMEET_INJECTED__) return;
  window.__AUTOMEET_INJECTED__ = true;

  const utils = window.AutoMeetUtils;
  let currentSettings = utils ? utils.DEFAULT_SETTINGS : null;
  let isRecordingActive = false;
  let hudElement = null;
  let checkTimer = null;

  // Khởi tạo
  init();

  async function init() {
    if (utils) {
      currentSettings = await utils.loadSettings();
    }

    // 1. Kiểm tra nếu đang ở trang chủ (chưa vào phòng)
    const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (!pathname) {
      handleHomePage();
      return;
    }

    // 2. Nếu đang ở trang phòng họp
    startMeetingWatcher();
    injectHUD();
    listenForMessages();
  }

  /**
   * Xử lý khi người dùng vào https://meet.jit.si/ (trang chủ)
   */
  function handleHomePage() {
    const todayRoom = utils ? utils.getRoomName() : 'StaffAutoMeet';
    const targetUrl = utils ? utils.getMeetingUrl() : `https://meet.jit.si/${todayRoom}#config.prejoinConfig.enabled=false`;

    showToast(`🔄 Đang tự động chuyển hướng đến phòng hôm nay: ${todayRoom}...`);

    // Chuyển hướng trực tiếp vào phòng họp của ngày hôm nay
    setTimeout(() => {
      window.location.href = targetUrl;
    }, 1200);
  }

  /**
   * Giám sát liên tục trạng thái cuộc họp (pre-join, trong phòng, đang record...)
   */
  function startMeetingWatcher() {
    if (checkTimer) clearInterval(checkTimer);

    checkTimer = setInterval(() => {
      handlePrejoinScreen();
      checkRecordingState();
      updateHUD();
    }, 1000);
  }

  /**
   * Tự động điền tên và bấm nút tham gia nếu gặp màn hình Pre-join
   */
  function handlePrejoinScreen() {
    // 1. Điền tên hiển thị
    const nameInput = document.querySelector(
      'input[data-testid="prejoin.nameInput"], input[placeholder*="name" i], .prejoin-input-area input'
    );
    if (nameInput && currentSettings?.displayName) {
      if (nameInput.value !== currentSettings.displayName) {
        nameInput.value = currentSettings.displayName;
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // 2. Bấm nút Tham gia
    const joinBtn = document.querySelector(
      '[data-testid="prejoin.joinMeeting"], button.prejoin-btn, button[aria-label*="Join meeting" i], button[aria-label*="Tham gia" i]'
    );
    if (joinBtn && currentSettings?.autoJoinPrejoin) {
      console.log('[AutoMeet] Phát hiện nút Join meeting, đang bấm...');
      joinBtn.click();
    }
  }

  /**
   * Kiểm tra xem Jitsi Meet hiện tại có đang trong trạng thái Record hay không
   */
  function checkRecordingState() {
    // Tìm các chỉ báo ghi âm trên giao diện Jitsi
    const recBadge = document.querySelector(
      '[data-testid="recording-indicator"], .recording-icon, [aria-label*="Recording is on" i], [aria-label*="Đang ghi" i]'
    );
    
    // Hoặc kiểm tra badge REC màu đỏ
    const recTextElements = Array.from(document.querySelectorAll('span, div')).filter(el => {
      return el.textContent && el.textContent.trim() === 'REC' && el.offsetParent !== null;
    });

    isRecordingActive = !!recBadge || recTextElements.length > 0;
  }

  /**
   * Tự động kích hoạt Record nếu đang nằm trong khung giờ quy định (chỉ chạy khi được bật)
   */
  function checkAndAutoRecordIfInSlot() {
    if (!currentSettings || !currentSettings.enableAutoRecord || !currentSettings.autoRecordIfInSlot) return;
    if (isRecordingActive) return;

    const { inSlot, activeSchedule } = utils.checkCurrentSlot(currentSettings.schedules);
    if (inSlot) {
      console.log(`[AutoMeet] Đang trong ${activeSchedule.name} (${activeSchedule.start} - ${activeSchedule.end}), kích hoạt record...`);
      showToast(`⏰ Đang trong khung giờ ${activeSchedule.name}, tự động kích hoạt Record...`);
      triggerStartRecording();
    }
  }

  /**
   * Đánh thức thanh công cụ (Toolbar) nếu đang bị ẩn do không di chuột
   */
  function wakeUpToolbar() {
    try {
      const evt = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight - 50
      });
      document.body.dispatchEvent(evt);
      const container = document.querySelector('#videoconference_page, #largeVideoContainer, .filmstrip, .toolbox-content');
      if (container) container.dispatchEvent(evt);
    } catch (e) {
      // bỏ qua nếu lỗi event
    }
  }

  /**
   * Tìm nút "..." (More actions / Thao tác khác) - Hỗ trợ cả thẻ DIV và BUTTON
   */
  function findMoreActionsButton() {
    wakeUpToolbar();

    // 1. Tìm bằng selector bao gồm cả DIV và BUTTON
    const selectors = [
      '[aria-label="More actions"]',
      '[aria-label*="More actions" i]',
      '[aria-label*="Thao tác khác" i]',
      '[data-testid="overflow-menu-button"]',
      '#more-actions-menu-button',
      '.toolbox-button[aria-label*="More" i]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // 2. Tìm theo icon SVG 3 chấm trong thanh toolbar
    const buttons = document.querySelectorAll(
      'div[role="toolbar"] [role="button"], .toolbox-content [role="button"], div[role="toolbar"] button, .toolbox-content button, .toolbox-button'
    );
    for (const b of buttons) {
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('more') || aria.includes('thao tác') || aria.includes('overflow')) {
        return b;
      }
      if (b.querySelector('svg circle') && b.querySelectorAll('svg circle').length >= 3) {
        return b;
      }
    }

    return null;
  }

  /**
   * Kích hoạt Record thủ công (hoặc theo lệnh người dùng)
   */
  async function triggerStartRecording() {
    if (isRecordingActive) {
      showToast('ℹ Cuộc họp đang được Record rồi.');
      return;
    }

    // Kiểm tra nếu đang ở màn hình chờ Pre-join hoặc chờ Moderator
    const isPrejoin = document.querySelector('[data-testid="prejoin.joinMeeting"], .prejoin-input-area, input[placeholder*="name" i]');
    if (isPrejoin) {
      showToast('⚠ Bạn đang ở màn hình chờ. Vui lòng bấm Tham gia cuộc họp trước.');
      return;
    }

    showToast('⏳ Đang chuẩn bị mở menu Record...');

    // Retry tìm nút More actions tối đa 5 lần (mỗi lần 800ms) để đợi giao diện Jitsi render
    let moreBtn = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      moreBtn = findMoreActionsButton();
      if (moreBtn) break;
      await sleep(800);
    }

    if (!moreBtn) {
      console.warn('[AutoMeet] Chưa tìm thấy thanh công cụ Jitsi. Vui lòng đảm bảo bạn đã vào hẳn trong phòng họp.');
      showToast('⚠ Chưa tìm thấy thanh công cụ. Hãy đảm bảo bạn đã vào hẳn trong phòng họp.');
      return;
    }

    // Click mở menu 3 chấm
    moreBtn.click();
    await sleep(600);

    // Tìm mục Record trong menu vừa bật lên (hỗ trợ cả thẻ div role="menuitem", li, button)
    let recordItem = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const menuItems = Array.from(document.querySelectorAll(
        '[role="menuitem"], .overflow-menu-item, .toolbox-button, li[role="menuitem"], button, div'
      ));

      for (const item of menuItems) {
        const text = (item.textContent || '').trim().toLowerCase();
        const aria = (item.getAttribute('aria-label') || '').toLowerCase();

        // Kiểm tra từ khóa "record" hoặc "ghi lại"
        if (text === 'record' || aria === 'record' || text.includes('record') || aria.includes('record') ||
            text.includes('ghi lại') || aria.includes('ghi lại')) {
          if (!text.includes('stop') && !aria.includes('stop')) {
            recordItem = item;
            break;
          }
        }
      }
      if (recordItem) break;
      await sleep(300);
    }

    if (recordItem) {
      console.log('[AutoMeet] Tìm thấy mục Record, đang bấm...');
      recordItem.click();

      // Chờ modal Record xuất hiện (tối đa 3s) và làm nổi bật nút Start để người dùng bấm
      let startModalBtn = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(300);
        startModalBtn = document.querySelector('[data-testid="recordingDialog.startRecording"], button[aria-label*="Start recording" i]') ||
          Array.from(document.querySelectorAll('[role="dialog"] button, div[aria-modal="true"] button, button')).find(b => {
            const text = (b.textContent || '').trim().toLowerCase();
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            return text === 'start' || text.includes('start recording') || aria.includes('start recording') || text === 'bắt đầu ghi';
          });
        if (startModalBtn) break;
      }

      if (startModalBtn) {
        // Làm nổi bật nút Start bằng viền sáng xanh neon để người dùng nhận diện ngay
        startModalBtn.style.outline = '4px solid #38bdf8';
        startModalBtn.style.boxShadow = '0 0 30px rgba(56, 189, 248, 1)';
        startModalBtn.style.transform = 'scale(1.05)';
        startModalBtn.style.transition = 'all 0.3s ease';
        startModalBtn.focus();

        // Lắng nghe khi người dùng bấm nút Start thật
        startModalBtn.addEventListener('click', () => {
          showToast('📁 Trình duyệt đang mở cửa sổ... Hãy chọn nơi lưu file và bấm Cho phép (Allow) để bắt đầu!');
        }, { once: true });

        playNotificationSound();
        showToast('👉 Bấm nút START màu xanh ở giữa màn hình để mở cửa sổ chọn nơi lưu & cấp quyền trình duyệt!');
      } else {
        playNotificationSound();
        showToast('👉 Vui lòng bấm nút Start trong bảng Record để bắt đầu ghi hình!');
      }
    } else {
      console.warn('[AutoMeet] Không tìm thấy mục Record trong menu!');
      showToast('⚠ Không tìm thấy mục "Record" trong danh sách menu!');
    }
  }

  /**
   * Tự động tắt Record
   */
  async function triggerStopRecording() {
    showToast('⏳ Đang dừng Record...');

    // Mở menu 3 chấm
    const moreBtn = findMoreActionsButton();
    if (moreBtn) {
      moreBtn.click();
      await sleep(600);
    }

    // Tìm mục Stop recording
    const menuItems = Array.from(document.querySelectorAll(
      '.overflow-menu-item, li[role="menuitem"], div[role="menuitem"], .toolbox-button'
    ));

    let stopItem = null;
    for (const item of menuItems) {
      const text = (item.textContent || '').trim().toLowerCase();
      const aria = (item.getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('stop recording') || aria.includes('stop recording') ||
          text.includes('dừng ghi') || aria.includes('dừng ghi')) {
        stopItem = item;
        break;
      }
    }

    if (stopItem) {
      stopItem.click();
      await sleep(500);

      // Nếu có hộp thoại xác nhận Dừng
      const confirmBtn = document.querySelector(
        '[data-testid="confirm-dialog-ok"], button[aria-label*="Stop" i], button[aria-label*="Dừng" i]'
      );
      if (confirmBtn) {
        confirmBtn.click();
      }

      showToast('⏹ ĐÃ DỪNG RECORD! Video đang được lưu về máy (Downloads).');
    } else {
      // Thử bấm trực tiếp vào biểu tượng Recording ở góc trên nếu có
      const recIcon = document.querySelector('[data-testid="recording-indicator"], .recording-icon');
      if (recIcon) {
        recIcon.click();
      }
      showToast('⏹ Đã gửi yêu cầu dừng Record.');
    }
  }

  /**
   * Khởi tạo giao diện HUD nổi trên màn hình Jitsi Meet
   */
  function injectHUD() {
    if (document.getElementById('automeet-hud-container')) return;

    hudElement = document.createElement('div');
    hudElement.id = 'automeet-hud-container';
    hudElement.innerHTML = `
      <div class="automeet-hud-card">
        <div class="automeet-hud-header">
          <div class="automeet-hud-title">
            <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
            AutoMeet Assistant
          </div>
          <button class="automeet-hud-minimize-btn" title="Thu nhỏ/Mở rộng">━</button>
        </div>
        <div class="automeet-hud-body">
          <div class="automeet-hud-row">
            <span class="automeet-hud-label">Phòng hôm nay:</span>
            <span class="automeet-hud-val room-badge" id="hud-room-name">...</span>
          </div>
          <div class="automeet-hud-row">
            <span class="automeet-hud-label">Trạng thái:</span>
            <span id="hud-status-pill" class="automeet-status-pill waiting">
              <span class="status-dot"></span>
              <span id="hud-status-text">Đang kết nối...</span>
            </span>
          </div>
          <div class="automeet-hud-row">
            <span class="automeet-hud-label">Lịch trình:</span>
            <span class="automeet-hud-val" id="hud-schedule-text">...</span>
          </div>
          <div class="automeet-hud-actions">
            <button class="automeet-btn automeet-btn-record" id="hud-btn-start">⏺ Bật Record</button>
            <button class="automeet-btn automeet-btn-stop" id="hud-btn-stop">⏹ Dừng</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(hudElement);

    // Xử lý sự kiện thu nhỏ / phóng to
    const minBtn = hudElement.querySelector('.automeet-hud-minimize-btn');
    minBtn.addEventListener('click', () => {
      hudElement.classList.toggle('minimized');
      minBtn.textContent = hudElement.classList.contains('minimized') ? '◻' : '━';
    });

    // Nút Bật Record thủ công trên HUD
    hudElement.querySelector('#hud-btn-start').addEventListener('click', () => {
      triggerStartRecording();
    });

    // Nút Dừng Record thủ công trên HUD
    hudElement.querySelector('#hud-btn-stop').addEventListener('click', () => {
      triggerStopRecording();
    });

    updateHUD();
  }

  /**
   * Cập nhật thông tin trên HUD theo thời gian thực
   */
  function updateHUD() {
    if (!hudElement || !utils) return;

    const todayRoom = utils.getRoomName();
    const roomSpan = hudElement.querySelector('#hud-room-name');
    if (roomSpan) roomSpan.textContent = todayRoom;

    const statusPill = hudElement.querySelector('#hud-status-pill');
    const statusText = hudElement.querySelector('#hud-status-text');
    const schedText = hudElement.querySelector('#hud-schedule-text');

    const { inSlot, activeSchedule } = utils.checkCurrentSlot(currentSettings?.schedules);

    if (isRecordingActive) {
      if (statusPill) {
        statusPill.className = 'automeet-status-pill recording';
      }
      if (statusText) {
        statusText.textContent = inSlot ? `Đang Record (${activeSchedule?.name})` : 'Đang Record';
      }
    } else {
      if (statusPill) {
        statusPill.className = 'automeet-status-pill waiting';
      }
      if (statusText) {
        statusText.textContent = currentSettings?.enableAutoRecord
          ? (inSlot ? `Sẵn sàng (${activeSchedule?.name})` : 'Đang chờ ca')
          : 'Sẵn sàng (Thủ công)';
      }
    }

    if (schedText) {
      if (!currentSettings?.enableAutoRecord) {
        schedText.textContent = 'Ghi hình thủ công (Tự động: TẮT)';
      } else {
        const nextEvt = utils.getNextEvent(currentSettings?.schedules);
        if (nextEvt) {
          const action = nextEvt.type === 'start' ? 'Bật' : 'Tắt';
          const hours = Math.floor(nextEvt.minutesLeft / 60);
          const mins = nextEvt.minutesLeft % 60;
          const timeRemaining = hours > 0 ? `${hours}h ${mins}p` : `${mins} phút`;
          schedText.textContent = `${action} lúc ${nextEvt.timeStr} (sau ${timeRemaining})`;
        } else {
          schedText.textContent = 'Chưa đặt lịch';
        }
      }
    }
  }

  /**
   * Hiển thị thông báo Toast nổi
   */
  function showToast(msg) {
    const existing = document.querySelector('.automeet-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'automeet-toast';
    toast.innerHTML = `
      <span>🎥</span>
      <span>${escapeHtml(msg)}</span>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s ease';
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  /**
   * Phát âm thanh thông báo nhẹ nhàng
   */
  function playNotificationSound() {
    if (!currentSettings?.soundAlert) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) {
      // AudioContext có thể bị block nếu chưa có tương tác
    }
  }

  /**
   * Lắng nghe thông điệp từ Service Worker (background.js) hoặc Popup
   */
  function listenForMessages() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('[AutoMeet] Nhận lệnh từ background:', request);

      if (request.action === 'START_RECORDING') {
        triggerStartRecording();
        sendResponse({ success: true, message: 'Đã gửi lệnh bật Record' });
      } else if (request.action === 'STOP_RECORDING') {
        triggerStopRecording();
        sendResponse({ success: true, message: 'Đã gửi lệnh dừng Record' });
      } else if (request.action === 'GET_STATUS') {
        sendResponse({
          isRecording: isRecordingActive,
          roomName: utils ? utils.getRoomName() : '',
          settings: currentSettings
        });
      } else if (request.action === 'RELOAD_SETTINGS') {
        if (utils) {
          utils.loadSettings().then(s => {
            currentSettings = s;
            updateHUD();
          });
        }
        sendResponse({ success: true });
      }

      return true; // Giữ channel async mở
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
