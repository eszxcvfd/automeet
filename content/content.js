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

    // 3. Kiểm tra tự động record nếu đang trong khung giờ
    setTimeout(() => {
      checkAndAutoRecordIfInSlot();
    }, 4000);
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
   * Tìm nút "..." (More actions / Thao tác khác)
   */
  function findMoreActionsButton() {
    // 1. Thử theo aria-label và data-testid phổ biến
    const selectors = [
      'button[aria-label="More actions"]',
      'button[aria-label*="More actions" i]',
      'button[aria-label*="Thao tác khác" i]',
      'button#more-actions-menu-button',
      '[data-testid="overflow-menu-button"]',
      'div[aria-label="More actions"]',
      'div[aria-label*="Thao tác khác" i]'
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) return btn;
    }

    // 2. Tìm theo icon SVG 3 chấm trong thanh toolbar
    const buttons = document.querySelectorAll('div[role="toolbar"] button, .toolbox-content button');
    for (const b of buttons) {
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('more') || aria.includes('thao tác') || aria.includes('overflow')) {
        return b;
      }
      // Nút có 3 dấu chấm tròn SVG
      if (b.querySelector('svg circle') && b.querySelectorAll('svg circle').length >= 3) {
        return b;
      }
    }

    return null;
  }

  /**
   * Tự động bật Record (Khớp với 2 ảnh đính kèm của người dùng)
   */
  async function triggerStartRecording() {
    if (isRecordingActive) {
      showToast('ℹ Cuộc họp đang được Record rồi.');
      return;
    }

    showToast('⏳ Đang mở menu để bật Record...');

    // Bước 1: Mở menu 3 chấm (Ảnh 1)
    const moreBtn = findMoreActionsButton();
    if (!moreBtn) {
      console.warn('[AutoMeet] Không tìm thấy nút 3 chấm More actions!');
      showToast('⚠ Chưa tìm thấy thanh công cụ Jitsi. Vui lòng đảm bảo đã vào phòng.');
      return;
    }

    moreBtn.click();
    await sleep(600);

    // Bước 2: Tìm mục Record trong menu vừa bật lên (Ảnh 1)
    const menuItems = Array.from(document.querySelectorAll(
      '.overflow-menu-item, li[role="menuitem"], div[role="menuitem"], .toolbox-button'
    ));

    let recordItem = null;
    for (const item of menuItems) {
      const text = (item.textContent || '').trim().toLowerCase();
      const aria = (item.getAttribute('aria-label') || '').toLowerCase();

      // Kiểm tra từ khóa "record" hoặc "ghi lại"
      if (text === 'record' || aria === 'record' || text.includes('record') || aria.includes('record') ||
          text.includes('ghi lại') || aria.includes('ghi lại')) {
        // Đảm bảo không phải là stop recording
        if (!text.includes('stop') && !aria.includes('stop')) {
          recordItem = item;
          break;
        }
      }
    }

    if (!recordItem) {
      // Tìm bằng cách duyệt tất cả span/div trong menu
      const allSpans = Array.from(document.querySelectorAll('.overflow-menu span, div[role="menu"] span'));
      for (const s of allSpans) {
        if (s.textContent && s.textContent.trim().toLowerCase() === 'record') {
          recordItem = s.closest('[role="menuitem"]') || s.parentElement;
          break;
        }
      }
    }

    if (recordItem) {
      console.log('[AutoMeet] Tìm thấy nút Record, đang bấm...');
      recordItem.click();

      // Chờ modal Record xuất hiện (nếu có) và tự động bấm nút Start
      await sleep(600);
      const startModalBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(b => {
        const text = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        return (text === 'start' || text === 'start recording' || aria === 'start recording' || text === 'bắt đầu ghi' || text === 'bắt đầu');
      });

      if (startModalBtn) {
        console.log('[AutoMeet] Tìm thấy nút Start trong modal Record, đang bấm...');
        startModalBtn.click();
      }

      // Âm thanh báo hiệu
      playNotificationSound();

      // Thông báo hiển thị nhắc người dùng bấm Allow (Ảnh 2)
      showToast('🎥 ĐÃ BẤM RECORD! Nếu trình duyệt hiện popup hỏi cấp quyền tab, hãy bấm ALLOW.');
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
