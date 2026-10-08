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
   * Giả lập thao tác click chuột đầy đủ (pointerdown -> mousedown -> pointerup -> mouseup -> click)
   * Giúp tương thích 100% với cơ chế Event Delegation của React 18 / Jitsi Meet
   */
  function simulateUserClick(element) {
    if (!element) return false;
    try {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus();

      const rect = element.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 1,
        clientX: clientX,
        clientY: clientY,
        button: 0,
        buttons: 1
      };

      const target = element.querySelector('svg, .toolbox-icon') || element;
      target.dispatchEvent(new PointerEvent('pointerdown', eventInit));
      target.dispatchEvent(new MouseEvent('mousedown', eventInit));
      target.dispatchEvent(new PointerEvent('pointerup', eventInit));
      target.dispatchEvent(new MouseEvent('mouseup', eventInit));
      target.dispatchEvent(new MouseEvent('click', eventInit));
      if (typeof element.click === 'function') {
        element.click();
      }
      return true;
    } catch (e) {
      if (typeof element.click === 'function') element.click();
      return true;
    }
  }

  /**
   * Tìm nút "..." (More actions / Thao tác khác) trên thanh toolbar Jitsi
   * Sử dụng kết hợp CSS class đặc trưng, vector SVG 3 chấm, vị trí cạnh nút Rời phòng (Hangup), và aria-label đa ngôn ngữ
   */
  function findMoreActionsButton() {
    wakeUpToolbar();

    // 1. Tìm theo class container đặc trưng của nút 3 chấm trong Jitsi Meet
    let btn = document.querySelector('.toolbox-button-wth-dialog .toolbox-button, .context-menu .toolbox-button');
    if (btn && !btn.closest('#automeet-hud-container, .automeet-toast')) return btn;

    // 2. Tìm theo vector path SVG của 3 dấu chấm tròn ngang (M16.5 12)
    const svgPath = document.querySelector('svg path[d*="M16.5 12"], svg path[d*="16.5 12"]');
    btn = svgPath?.closest('[role="button"], .toolbox-button, button');
    if (btn && !btn.closest('#automeet-hud-container, .automeet-toast')) return btn;

    // 3. Tìm theo vị trí: Nút 3 chấm luôn nằm ngay liền kề trước nút gác máy màu đỏ (Leave/Hangup)
    const leaveBtn = document.querySelector(
      '[aria-label*="Leave" i], [aria-label*="Rời" i], .hangup-button, [data-testid="hangup-button"]'
    );
    if (leaveBtn) {
      const candidate = leaveBtn.closest('.toolbox-content-items, .new-toolbox, div')?.querySelector('.toolbox-button-wth-dialog .toolbox-button') ||
        leaveBtn.parentElement?.previousElementSibling?.querySelector('[role="button"]') ||
        leaveBtn.previousElementSibling?.querySelector('[role="button"]');
      if (candidate && !candidate.closest('#automeet-hud-container, .automeet-toast')) return candidate;
    }

    // 4. Tìm theo các nhãn aria-label hỗ trợ cả tiếng Anh và tiếng Việt
    const selectors = [
      '[aria-label="More actions"]',
      '[aria-label*="More actions" i]',
      '[aria-label*="Close more actions" i]',
      '[aria-label*="Thêm hành động" i]',
      '[aria-label*="Thao tác khác" i]',
      '[aria-label*="Tùy chọn khác" i]',
      '[aria-label*="Hành động khác" i]',
      '[data-testid="overflow-menu-button"]',
      '#more-actions-menu-button',
      '.toolbox-button[aria-label*="More" i]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && !el.closest('#automeet-hud-container, .automeet-toast')) return el;
    }

    return null;
  }

  /**
   * Kiểm tra menu More actions có đang mở trên màn hình không
   */
  function findOpenMoreMenu() {
    const menu = document.querySelector('[aria-label="More actions menu"], .popover-content');
    return (menu && menu.offsetParent !== null) ? menu : null;
  }

  /**
   * Tìm mục "Record" (Ghi lại) bên trong menu More actions
   * Hỗ trợ tìm qua SVG biểu tượng Record (vòng tròn đồng tâm) và qua aria-label/text đa ngôn ngữ
   */
  function findRecordMenuItem(menuContainer) {
    if (!menuContainer) return null;

    // 1. Tìm theo biểu tượng SVG Record đặc trưng của Jitsi (vòng tròn tâm d*="M21 12")
    const recSvg = menuContainer.querySelector('svg path[d*="M21 12"], svg path[d*="12 15.5a3.5"]');
    if (recSvg) {
      const item = recSvg.closest('[role="button"], [role="menuitem"], .contextMenuItem, li, button');
      if (item && !item.closest('#automeet-hud-container, .automeet-toast')) return item;
    }

    // 2. Tìm theo aria-label hoặc nội dung text của từng item
    const candidates = Array.from(menuContainer.querySelectorAll('[role="button"], [role="menuitem"], .contextMenuItem, li, button'));
    for (const item of candidates) {
      if (item.closest('#automeet-hud-container, .automeet-toast')) continue;
      const text = (item.textContent || '').trim().toLowerCase();
      const aria = (item.getAttribute('aria-label') || '').toLowerCase();

      if (aria === 'record' || text === 'record' ||
          aria.includes('ghi') || text.includes('ghi') ||
          (text.includes('record') && !text.includes('stop') && text.length < 25)) {
        return item;
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

    // Kiểm tra nếu đang ở màn hình chờ Pre-join
    const isPrejoin = document.querySelector('[data-testid="prejoin.joinMeeting"], .prejoin-input-area, input[placeholder*="name" i]');
    if (isPrejoin) {
      showToast('⚠ Bạn đang ở màn hình chờ. Vui lòng bấm Tham gia cuộc họp trước.');
      return;
    }

    // Kiểm tra nếu modal Record đã mở sẵn trên màn hình
    const existingStartBtn = document.querySelector('[data-testid="recordingDialog.startRecording"], button[aria-label*="Start recording" i]');
    if (existingStartBtn && existingStartBtn.offsetParent !== null) {
      highlightStartButton(existingStartBtn);
      return;
    }

    showToast('⏳ Đang mở menu và chọn Record...');

    // Bước 1: Mở menu 3 chấm More actions (nếu chưa mở)
    let moreMenu = findOpenMoreMenu();
    if (!moreMenu) {
      let menuOpened = false;

      // Thử tối đa 3 lượt (mỗi lượt tìm nút và click bằng chuỗi Pointer/Mouse Event)
      for (let retry = 0; retry < 3 && !menuOpened; retry++) {
        wakeUpToolbar();
        let moreBtn = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          moreBtn = findMoreActionsButton();
          if (moreBtn) break;
          await sleep(350);
        }

        if (!moreBtn) {
          console.warn(`[AutoMeet] Chưa tìm thấy nút 3 chấm More actions (lần thử ${retry + 1})`);
          await sleep(500);
          continue;
        }

        console.log('[AutoMeet] Đang click nút 3 chấm More actions...');
        simulateUserClick(moreBtn);

        // Chờ menu More actions xuất hiện (tối đa 2s)
        for (let attempt = 0; attempt < 8; attempt++) {
          await sleep(250);
          moreMenu = findOpenMoreMenu();
          if (moreMenu) {
            menuOpened = true;
            break;
          }
        }
      }

      if (!moreMenu) {
        console.warn('[AutoMeet] Không mở được menu More actions!');
        showToast('⚠ Chưa mở được menu thanh công cụ. Hãy di chuột vào giữa màn hình cuộc họp và bấm lại!');
        return;
      }
    }

    // Bước 2: Tìm chính xác mục "Record" trong menu
    let recordItem = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      recordItem = findRecordMenuItem(moreMenu);
      if (recordItem) break;
      await sleep(250);
      moreMenu = findOpenMoreMenu();
    }

    if (!recordItem) {
      console.warn('[AutoMeet] Không tìm thấy mục Record trong menu Jitsi!');
      showToast('⚠ Không tìm thấy mục "Record" trong danh sách menu!');
      return;
    }

    console.log('[AutoMeet] Đang click mục Record trong menu...');
    simulateUserClick(recordItem);

    // Bước 3: Chờ modal Record xuất hiện và highlight nút Start (tối đa 3.5s)
    let startBtn = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      await sleep(250);
      startBtn = document.querySelector('[data-testid="recordingDialog.startRecording"], button[aria-label*="Start recording" i]') ||
        Array.from(document.querySelectorAll('[role="dialog"] button, div[aria-modal="true"] button')).find(b => {
          const text = (b.textContent || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return text === 'start' || text.includes('start recording') || aria.includes('start recording') || text === 'bắt đầu';
        });
      if (startBtn && !startBtn.closest('#automeet-hud-container, .automeet-toast')) break;
    }

    if (startBtn) {
      highlightStartButton(startBtn);
    } else {
      playNotificationSound();
      showToast('👉 Vui lòng bấm nút Start trong bảng Record để bắt đầu ghi hình!');
    }
  }

  /**
   * Làm nổi bật nút Start màu xanh để người dùng bấm kích hoạt cấp quyền trình duyệt
   */
  function highlightStartButton(startBtn) {
    startBtn.style.outline = '4px solid #38bdf8';
    startBtn.style.boxShadow = '0 0 35px rgba(56, 189, 248, 1)';
    startBtn.style.transform = 'scale(1.08)';
    startBtn.style.transition = 'all 0.3s ease';
    startBtn.focus();

    // Lắng nghe khi người dùng bấm nút Start thật
    startBtn.addEventListener('click', () => {
      showToast('📁 Trình duyệt đang mở cửa sổ... Hãy chọn nơi lưu file và bấm Cho phép (Allow) để bắt đầu!');
    }, { once: true });

    playNotificationSound();
    showToast('👉 Bấm nút START màu xanh ở giữa màn hình để mở cửa sổ chọn nơi lưu & cấp quyền trình duyệt!');
  }

  /**
   * Tự động tắt Record
   */
  async function triggerStopRecording() {
    showToast('⏳ Đang dừng Record...');

    // Bước 1: Mở menu 3 chấm (nếu chưa mở)
    let moreMenu = findOpenMoreMenu();
    if (!moreMenu) {
      const moreBtn = findMoreActionsButton();
      if (moreBtn) {
        simulateUserClick(moreBtn);
        for (let i = 0; i < 8; i++) {
          await sleep(200);
          moreMenu = findOpenMoreMenu();
          if (moreMenu) break;
        }
      }
    }

    // Bước 2: Tìm mục Stop recording
    let stopItem = null;
    if (moreMenu) {
      const candidates = Array.from(moreMenu.querySelectorAll('[role="button"], [role="menuitem"], .contextMenuItem'));
      for (const item of candidates) {
        if (item.closest('#automeet-hud-container, .automeet-toast')) continue;
        const text = (item.textContent || '').trim().toLowerCase();
        const aria = (item.getAttribute('aria-label') || '').toLowerCase();
        if ((text.includes('stop recording') || aria.includes('stop recording') ||
            text.includes('dừng ghi') || aria.includes('dừng ghi')) && text.length < 30) {
          stopItem = item;
          break;
        }
      }
    }

    if (stopItem) {
      simulateUserClick(stopItem);
      await sleep(500);

      // Nếu có hộp thoại xác nhận Dừng
      const confirmBtn = document.querySelector(
        '[data-testid="confirm-dialog-ok"], button[aria-label*="Stop" i], button[aria-label*="Dừng" i]'
      );
      if (confirmBtn && !confirmBtn.closest('#automeet-hud-container, .automeet-toast')) {
        simulateUserClick(confirmBtn);
      }

      showToast('⏹ ĐÃ DỪNG RECORD! Video đang được lưu về máy (Downloads).');
    } else {
      // Thử bấm trực tiếp vào biểu tượng Recording ở góc trên nếu có
      const recIcon = document.querySelector('[data-testid="recording-indicator"], .recording-icon');
      if (recIcon) {
        simulateUserClick(recIcon);
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
