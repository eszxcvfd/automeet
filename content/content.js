/**
 * AutoMeet - Content Script for meet.jit.si
 * Tự động hóa điều hướng, vượt pre-join, bấm log-in chủ trì, đồng bộ bật/tắt record và hiển thị HUD.
 * KHÔNG sử dụng inline script để tuân thủ 100% Content Security Policy (CSP) của Jitsi.
 */

(function () {
  'use strict';

  // Tránh inject nhiều lần
  if (window.__AUTOMEET_INJECTED__) return;
  window.__AUTOMEET_INJECTED__ = true;

  const utils = window.AutoMeetUtils;
  let currentSettings = utils ? utils.DEFAULT_SETTINGS : null;
  let isRecordingActive = false;
  let recordingStartTime = null;
  let hudElement = null;
  let checkTimer = null;
  let isStartingRecording = false;
  let isStoppingRecording = false;
  let lastRecordAttemptTime = 0;

  // Khởi tạo
  init();

  async function init() {
    if (utils) {
      currentSettings = await utils.loadSettings();
    }

    // Dọn dẹp HUD cũ trên màn hình
    const existingHud = document.getElementById('automeet-hud-container');
    if (existingHud) existingHud.remove();
    hudElement = null;

    // Lắng nghe sự kiện đồng bộ từ In-page script (chạy ở MAIN world qua manifest.json)
    window.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'AUTOMEET_SYNC_RECORDING_STATE') {
        if (typeof event.data.isRunning === 'boolean') {
          const wasRunning = isRecordingActive;
          isRecordingActive = event.data.isRunning;
          if (isRecordingActive && !wasRunning) {
            if (!recordingStartTime) recordingStartTime = Date.now();
            updateTopRecordingPill();
          } else if (!isRecordingActive && wasRunning) {
            recordingStartTime = null;
            updateTopRecordingPill();
          }
        }
      }
    });

    // 1. Kiểm tra nếu đang ở trang chủ (chưa vào phòng)
    const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (!pathname) {
      handleHomePage();
      return;
    }

    // 2. Nếu đang ở trang phòng họp
    startMeetingWatcher();
    listenForMessages();

    // 3. Khởi động kiểm tra lịch sau 2 giây khi vào phòng
    setTimeout(() => {
      checkSlotScheduleAutoRecord();
    }, 2000);
  }

  /**
   * Xử lý khi người dùng vào https://meet.jit.si/ (trang chủ)
   */
  function handleHomePage() {
    const todayRoom = utils ? utils.getRoomName() : 'StaffAutoMeet';
    const targetUrl = utils ? utils.getMeetingUrl() : `https://meet.jit.si/${todayRoom}`;

    showToast(`🔄 Đang tự động chuyển hướng đến phòng hôm nay: ${todayRoom}...`);

    setTimeout(() => {
      window.location.href = targetUrl;
    }, 1000);
  }

  /**
   * Giám sát liên tục trạng thái cuộc họp (pre-join, login host, tự động record theo ca...)
   */
  function startMeetingWatcher() {
    if (checkTimer) clearInterval(checkTimer);

    checkTimer = setInterval(() => {
      handlePrejoinScreen();
      handleLoginScreen();
      autoDismissPopups();
      checkSlotScheduleAutoRecord();
      updateHUD();
      updateTopRecordingPill();
    }, 1500);
  }

  /**
   * Cập nhật hoặc xóa chỉ báo REC nổi ở giữa trên cùng màn hình
   */
  function updateTopRecordingPill() {
    let pill = document.getElementById('automeet-rec-pill');
    if (isRecordingActive) {
      if (!pill) {
        pill = document.createElement('div');
        pill.id = 'automeet-rec-pill';
        document.body.appendChild(pill);
      }
      let timerStr = '';
      if (recordingStartTime) {
        const elapsedSec = Math.floor((Date.now() - recordingStartTime) / 1000);
        const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
        const s = String(elapsedSec % 60).padStart(2, '0');
        timerStr = ` [${m}:${s}]`;
      }
      const { inSlot, activeSchedule } = utils ? utils.checkCurrentSlot(currentSettings?.schedules) : { inSlot: false };
      const caName = inSlot && activeSchedule ? ` - ${activeSchedule.name}` : '';
      pill.innerHTML = `<span class="rec-dot"></span><span>REC ĐANG GHI HÌNH${timerStr}${caName} (Tự động lưu khi hết ca)</span>`;
    } else {
      if (pill) {
        pill.remove();
      }
    }
  }

  /**
   * Tự động tắt các thông báo che khuất màn hình (như "Invite others", "Dismiss", thông báo Jitsi)
   */
  function autoDismissPopups() {
    const dismissBtns = Array.from(document.querySelectorAll(
      'button[aria-label="Dismiss"], button[aria-label="Đóng"], button[aria-label="Close"], .close-btn, [data-testid="notifications.dismiss"]'
    )).filter(b => !b.closest('.automeet-toast, [role="dialog"], #automeet-rec-pill'));

    dismissBtns.forEach(btn => {
      try { btn.click(); } catch(e) {}
    });
  }

  /**
   * Tự động điền tên và bấm nút tham gia nếu gặp màn hình Pre-join (100% tự động)
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
    const joinSelectors = [
      '[data-testid="prejoin.joinMeeting"]',
      'button.prejoin-btn',
      'button[aria-label*="Join meeting" i]',
      'button[aria-label*="Tham gia" i]',
      '[data-testid="prejoin.joinWithoutAudio"]',
      '.prejoin-input-area button[type="submit"]',
      'button[aria-label*="Join without" i]'
    ];

    if (currentSettings?.autoJoinPrejoin) {
      for (const sel of joinSelectors) {
        const joinBtn = document.querySelector(sel);
        if (joinBtn && joinBtn.offsetParent !== null && !joinBtn.classList.contains('disabled')) {
          console.log('[AutoMeet] Phát hiện nút Join meeting, tự động bấm...', joinBtn);
          simulateUserClick(joinBtn);
          joinBtn.click();
          break;
        }
      }
    }
  }

  /**
   * Tự động bấm nút Log-in nếu gặp màn hình yêu cầu đăng nhập/chủ trì để vào phòng họp
   */
  function handleLoginScreen() {
    const loginSelectors = [
      '[data-testid="lobby.loginButton"]',
      'button.lobby-button-margin',
      '.lobby-screen button',
      'button[data-testid*="login" i]',
      'button[data-testid*="moderator" i]',
      'button[data-testid*="auth" i]',
      '.login-button',
      '#login_button'
    ];

    for (const sel of loginSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null && !btn.classList.contains('disabled')) {
        console.log('[AutoMeet] Phát hiện nút Log-in theo selector, tự động bấm để vào phòng họp:', btn);
        showToast('🔑 Tự động bấm nút Log-in để vào phòng họp...');
        simulateUserClick(btn);
        btn.click();
        return true;
      }
    }

    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"], a.button'));
    for (const b of buttons) {
      if (b.closest('#automeet-hud-container, .automeet-toast, #new-toolbox, .new-toolbox')) continue;
      if (b.offsetParent === null) continue;

      const text = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const testid = (b.getAttribute('data-testid') || '').toLowerCase();

      const isLogin = 
        text === 'log-in' || text === 'login' || text === 'log in' ||
        text === 'đăng nhập' || text === 'i am the host' || text === 'tôi là người chủ trì' ||
        text.includes('i am the host') || text.includes('tôi là người chủ trì') ||
        (text.includes('log-in') && text.length < 35) ||
        (text.includes('login') && text.length < 35) ||
        aria.includes('log-in') || aria.includes('login') || aria.includes('i am the host') ||
        testid.includes('login') || testid.includes('moderator');

      if (isLogin) {
        console.log('[AutoMeet] Phát hiện nút Log-in/Chủ trì theo nội dung, tự động bấm:', b);
        showToast('🔑 Tự động bấm nút Log-in / Host để vào phòng họp...');
        simulateUserClick(b);
        b.click();
        return true;
      }
    }

    return false;
  }

  /**
   * Kiểm tra xem có đang ở màn hình Pre-join (Nhập tên & bấm Tham gia)
   */
  function isPrejoinScreen() {
    return !!document.querySelector(
      'input[data-testid="prejoin.nameInput"], [data-testid="prejoin.joinMeeting"], button.prejoin-btn, .prejoin-input-area'
    );
  }

  /**
   * Tự động kiểm tra và kích hoạt hoặc dừng record theo khung giờ lịch trình
   */
  async function checkSlotScheduleAutoRecord() {
    if (!currentSettings || !currentSettings.enableAutoRecord || !currentSettings.autoRecordIfInSlot) return;
    if (isStartingRecording || isStoppingRecording) return;

    // Nếu đang ở màn hình chờ Pre-join, ưu tiên bấm Tham gia
    if (isPrejoinScreen()) {
      handlePrejoinScreen();
      return;
    }

    // Nếu đang ở màn hình chờ Login/Host, ưu tiên bấm Log-in
    if (handleLoginScreen()) {
      return;
    }

    const { inSlot, activeSchedule } = utils.checkCurrentSlot(currentSettings.schedules);

    if (inSlot && activeSchedule) {
      // Đang trong ca làm việc: nếu chưa ghi hình, kích hoạt ngầm qua background
      if (!isRecordingActive && !isStartingRecording) {
        const now = Date.now();
        if (now - lastRecordAttemptTime > 5000) {
          lastRecordAttemptTime = now;
          isStartingRecording = true;
          console.log(`[AutoMeet] Đang trong ${activeSchedule.name} (${activeSchedule.start} - ${activeSchedule.end}), kích hoạt Record...`);

          try {
            await triggerStartRecording(activeSchedule);
          } catch (err) {
            console.warn('[AutoMeet] Lỗi kích hoạt Record:', err);
          } finally {
            isStartingRecording = false;
          }
        }
      }
    } else {
      // Hết ca làm việc -> tự động dừng
      if (isRecordingActive && !isStoppingRecording) {
        console.log(`[AutoMeet] Đã kết thúc ca làm việc, tự động dừng Record...`);
        isStoppingRecording = true;
        try {
          await triggerStopRecording();
        } catch (err) {
          console.warn('[AutoMeet] Lỗi dừng Record:', err);
        } finally {
          isStoppingRecording = false;
        }
      }
    }
  }

  /**
   * Giả lập click chuột chuẩn HTML5
   */
  function simulateUserClick(element) {
    if (!element) return false;
    try {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (typeof element.focus === 'function') element.focus();
      element.click();
      return true;
    } catch (e) {
      try { element.click(); } catch(err) {}
      return true;
    }
  }

  /**
   * Kích hoạt Record: Yêu cầu background bắt đầu TabCapture ngầm và đồng bộ giao diện Jitsi
   */
  async function triggerStartRecording(activeSchedule) {
    if (isPrejoinScreen()) {
      handlePrejoinScreen();
      return;
    }
    if (handleLoginScreen()) {
      await sleep(1000);
    }

    if (isRecordingActive) return;

    console.log('[AutoMeet] Yêu cầu Background bắt đầu TabCapture...');
    chrome.runtime.sendMessage({
      action: 'START_TAB_CAPTURE',
      schedule: activeSchedule
    }, (response) => {
      if (response && response.success) {
        console.log('[AutoMeet] Background xác nhận TabCapture đã bắt đầu.');
      } else {
        console.warn('[AutoMeet] Background báo lỗi TabCapture:', response?.error);
      }
    });
  }

  /**
   * Dừng Record: Yêu cầu background kết thúc TabCapture và lưu file
   */
  async function triggerStopRecording() {
    console.log('[AutoMeet] Yêu cầu Background dừng TabCapture...');
    chrome.runtime.sendMessage({ action: 'STOP_TAB_CAPTURE' }, () => {});
  }

  function finishStopRecording() {
    isRecordingActive = false;
    recordingStartTime = null;
    updateHUD();
    updateTopRecordingPill();
    playNotificationSound();
    showToast('⏹ ĐÃ DỪNG RECORD! Video đã được tự động lưu vào thư mục Downloads.');
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
          <div class="automeet-hud-header-btns">
            <button class="automeet-hud-minimize-btn" title="Thu nhỏ/Mở rộng">━</button>
            <button class="automeet-hud-close-btn" title="Đóng bảng trợ lý này">✕</button>
          </div>
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

    const minBtn = hudElement.querySelector('.automeet-hud-minimize-btn');
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hudElement.classList.toggle('minimized');
      minBtn.textContent = hudElement.classList.contains('minimized') ? '◻' : '━';
    });

    const closeBtn = hudElement.querySelector('.automeet-hud-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        hudElement.remove();
        hudElement = null;
        if (utils && currentSettings) {
          currentSettings.showFloatingHud = false;
          await utils.saveSettings(currentSettings);
        }
      });
    }

    hudElement.querySelector('#hud-btn-start').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      triggerStartRecording();
    });

    hudElement.querySelector('#hud-btn-stop').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
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
      if (statusPill) statusPill.className = 'automeet-status-pill recording';
      if (statusText) {
        let timerStr = '';
        if (recordingStartTime) {
          const elapsedSec = Math.floor((Date.now() - recordingStartTime) / 1000);
          const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
          const s = String(elapsedSec % 60).padStart(2, '0');
          timerStr = ` [${m}:${s}]`;
        }
        statusText.textContent = inSlot 
          ? `🔴 ĐANG GHI HÌNH${timerStr} (${activeSchedule?.name})` 
          : `🔴 ĐANG GHI HÌNH${timerStr}`;
      }
    } else if (isPrejoinScreen()) {
      if (statusPill) statusPill.className = 'automeet-status-pill waiting';
      if (statusText) statusText.textContent = 'Đang vào phòng...';
    } else {
      if (statusPill) statusPill.className = 'automeet-status-pill waiting';
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
    }, 4000);
  }

  /**
   * Phát âm thanh thông báo
   */
  function playNotificationSound() {
    if (!currentSettings?.soundAlert) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.close().catch(() => {});
        return;
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      setTimeout(() => { ctx.close().catch(() => {}); }, 450);
    } catch (e) {}
  }

  /**
   * Lắng nghe thông điệp từ Service Worker (background.js) hoặc Popup
   */
  function listenForMessages() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('[AutoMeet] Nhận lệnh từ background:', request);

      if (request.action === 'ON_RECORDING_STARTED') {
        isRecordingActive = true;
        recordingStartTime = Date.now();
        window.postMessage({ type: 'AUTOMEET_SET_RECORDING_UI_ACTIVE' }, '*');
        updateTopRecordingPill();
        updateHUD();
        playNotificationSound();
        const schedName = request.schedule?.name || '';
        showToast(`🔴 ĐÃ BẬT RECORD! Đang ghi hình ${schedName} (Lưu vào Downloads khi kết thúc)`);
        sendResponse({ success: true });
      } else if (request.action === 'ON_RECORDING_STOPPED') {
        window.postMessage({ type: 'AUTOMEET_SET_RECORDING_UI_INACTIVE' }, '*');
        finishStopRecording();
        sendResponse({ success: true });
      } else if (request.action === 'START_RECORDING') {
        triggerStartRecording(request.schedule);
        sendResponse({ success: true });
      } else if (request.action === 'STOP_RECORDING') {
        triggerStopRecording();
        sendResponse({ success: true });
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
            if (currentSettings?.showFloatingHud) {
              injectHUD();
              updateHUD();
            } else {
              const existing = document.getElementById('automeet-hud-container');
              if (existing) existing.remove();
              hudElement = null;
            }
          });
        }
        sendResponse({ success: true });
      }

      return true;
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
