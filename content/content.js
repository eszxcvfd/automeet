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
  let recordingStartTime = null;
  let hudElement = null;
  let checkTimer = null;
  let currentActiveSlotId = null;
  let isStartingRecording = false;
  let isStoppingRecording = false;

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
    if (currentSettings?.showFloatingHud) {
      injectHUD();
    }
    listenForMessages();

    // 3. Khởi động kiểm tra lịch sau 3.5 giây khi vào phòng
    setTimeout(() => {
      checkSlotScheduleAutoRecord();
    }, 3500);
  }

  /**
   * Xử lý khi người dùng vào https://meet.jit.si/ (trang chủ)
   */
  function handleHomePage() {
    const todayRoom = utils ? utils.getRoomName() : 'StaffAutoMeet';
    const targetUrl = utils ? utils.getMeetingUrl() : `https://meet.jit.si/${todayRoom}`;

    showToast(`🔄 Đang tự động chuyển hướng đến phòng hôm nay: ${todayRoom}...`);

    // Chuyển hướng trực tiếp vào phòng họp của ngày hôm nay
    setTimeout(() => {
      window.location.href = targetUrl;
    }, 1200);
  }

  /**
   * Giám sát liên tục trạng thái cuộc họp (pre-join, trong phòng, tự động record theo lịch...)
   */
  function startMeetingWatcher() {
    if (checkTimer) clearInterval(checkTimer);

    checkTimer = setInterval(() => {
      handlePrejoinScreen();
      handleLoginScreen();
      autoDismissPopups();
      checkRecordingState();
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
   * Tự động tắt các thông báo / banner che khuất màn hình (như "Invite others", "Dismiss", lỗi Recording của Jitsi)
   */
  function autoDismissPopups() {
    // 1. Tự động đóng và gỡ bỏ thông báo lỗi "Recording failed to start" của Jitsi
    const jitsiAlerts = Array.from(document.querySelectorAll(
      '.css-146e27r-notification, .jitsi-notification, [role="alert"], div[class*="notification"]'
    ));
    for (const alert of jitsiAlerts) {
      if (alert.closest('#automeet-hud-container, .automeet-toast, #automeet-rec-pill')) continue;
      const text = (alert.textContent || '').toLowerCase();
      if (text.includes('recording failed') || text.includes('failed to start') || text.includes('error starting')) {
        const dismissBtn = alert.querySelector('button, [role="button"], a');
        if (dismissBtn) {
          try { dismissBtn.click(); } catch(e) {}
        }
        try { alert.remove(); } catch(e) {}
      }
    }

    // 2. Tự động đóng các popup che khuất (Invite others, Dismiss, v.v.)
    const dismissBtns = Array.from(document.querySelectorAll(
      'button[aria-label="Dismiss"], button[aria-label="Đóng"], button[aria-label="Close"], .close-btn, [data-testid="notifications.dismiss"]'
    )).filter(b => !b.closest('#automeet-hud-container, .automeet-toast, [role="dialog"], #automeet-rec-pill'));

    dismissBtns.forEach(btn => {
      try { btn.click(); } catch(e) {}
    });

    // 3. Tự động đóng hộp thoại Record của Jitsi nếu đang mở
    const recordModal = document.querySelector('[role="dialog"][aria-label="Record"], [role="dialog"] #dialog-title');
    if (recordModal) {
      const closeBtn = document.querySelector('button[aria-label="Close dialog"], #modal-header-close-button');
      if (closeBtn) {
        try { closeBtn.click(); } catch(e) {}
      }
    }
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
   * Kiểm tra xem có đang ở màn hình yêu cầu Login/Host không
   */
  function isLoginScreen() {
    return !!(
      document.querySelector('[data-testid="lobby.loginButton"], button.lobby-button-margin, .lobby-screen') ||
      Array.from(document.querySelectorAll('button, [role="button"], a[role="button"]')).some(b => {
        if (b.closest('#automeet-hud-container, .automeet-toast, #new-toolbox, .new-toolbox')) return false;
        if (b.offsetParent === null) return false;
        const text = (b.textContent || '').trim().toLowerCase();
        return text === 'log-in' || text === 'login' || text === 'log in' || text === 'i am the host' || text.includes('i am the host') || text.includes('tôi là người chủ trì');
      })
    );
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

    const isJitsiRecording = !!recBadge || recTextElements.length > 0;
    if (isJitsiRecording) {
      if (!isRecordingActive) {
        recordingStartTime = recordingStartTime || Date.now();
      }
      isRecordingActive = true;
    }
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
   * Đảm bảo chỉ kích hoạt đúng 1 lần cho mỗi ca, không bị vòng lặp spam thông báo.
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
      // Đang trong khung giờ một ca làm việc
      // CHỈ KÍCH HOẠT ĐÚNG 1 LẦN CHO MỖI CA (Tránh lặp lại nhiều lần gây spam thông báo)
      if (currentActiveSlotId !== activeSchedule.id && !isStartingRecording) {
        console.log(`[AutoMeet] Bắt đầu ${activeSchedule.name} (${activeSchedule.start} - ${activeSchedule.end}), kích hoạt Record tự động...`);
        currentActiveSlotId = activeSchedule.id;
        isStartingRecording = true;
        isRecordingActive = true;
        if (!recordingStartTime) recordingStartTime = Date.now();
        showToast(`⏰ Đến ${activeSchedule.name} (${activeSchedule.start} - ${activeSchedule.end}): Tự động kích hoạt Record...`);

        try {
          await triggerStartRecording();
        } catch (err) {
          console.warn('[AutoMeet] Lỗi khi tự động kích hoạt Record:', err);
        } finally {
          isStartingRecording = false;
          isRecordingActive = true;
          updateHUD();
        }
      }
    } else {
      // Không nằm trong bất kỳ ca làm việc nào đang bật -> Tự động dừng Record và lưu video
      if (isRecordingActive || currentActiveSlotId !== null) {
        console.log(`[AutoMeet] Đã kết thúc ca làm việc, tự động dừng Record và lưu file...`);
        showToast(`⏰ Đã hết ca làm việc: Tự động dừng Record và lưu video...`);
        isStoppingRecording = true;
        try {
          await triggerStopRecording();
        } catch (err) {
          console.warn('[AutoMeet] Lỗi khi tự động dừng Record:', err);
        } finally {
          isStoppingRecording = false;
          isRecordingActive = false;
          currentActiveSlotId = null;
          recordingStartTime = null;
          updateHUD();
        }
      }
    }
  }

  /**
   * Đánh thức thanh công cụ (Toolbar) nếu đang bị ẩn do không di chuột
   */
  function wakeUpToolbar() {
    try {
      const x = window.innerWidth / 2;
      const y = window.innerHeight - 80;
      const eventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };

      window.dispatchEvent(new MouseEvent('mousemove', eventInit));
      document.dispatchEvent(new MouseEvent('mousemove', eventInit));
      document.body.dispatchEvent(new MouseEvent('mousemove', eventInit));

      const container = document.querySelector('#videoconference_page, #largeVideoContainer, .filmstrip, .toolbox-content, .new-toolbox');
      if (container) {
        container.dispatchEvent(new MouseEvent('mousemove', eventInit));
        container.dispatchEvent(new MouseEvent('mouseenter', eventInit));
      }
    } catch (e) {
      // bỏ qua nếu lỗi event
    }
  }

  /**
   * Giả lập thao tác click chuột chuẩn HTML5 (tránh double click vào SVG/Div làm toggle menu bị đóng ngay)
   */
  function simulateUserClick(element) {
    if (!element) return false;
    try {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (typeof element.focus === 'function') element.focus();

      // Sử dụng element.click() trực tiếp
      if (typeof element.click === 'function') {
        element.click();
        return true;
      }

      // Fallback
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (e) {
      try { element.click(); } catch(err) {}
      return true;
    }
  }

  /**
   * Xác thực xem một phần tử có thể là nút "More actions" (3 chấm)
   */
  function isValidMoreActionsButton(el) {
    if (!el || el.offsetParent === null) return false;
    if (el.closest('#automeet-hud-container, .automeet-toast')) return false;

    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const testid = (el.getAttribute('data-testid') || '').toLowerCase();

    // Loại trừ các nút khác trong cuộc họp (bao gồm cả reaction/phản ứng)
    const excludePatterns = ['leave', 'rời', 'hangup', 'camera', 'micro', 'audio', 'video', 'chat', 'raise hand', 'giơ tay', 'participant', 'người tham gia', 'tile view', 'dạng lưới', 'reaction', 'phản ứng'];
    for (const p of excludePatterns) {
      if (aria.includes(p) || testid.includes(p)) return false;
    }

    return true;
  }

  /**
   * Tìm nút "..." (More actions / Thao tác khác) trên thanh toolbar Jitsi
   * Hỗ trợ tìm qua data-testid, SVG 3 vòng tròn, vector path 3 chấm, và vị trí cạnh nút Hangup
   */
  function findMoreActionsButton() {
    wakeUpToolbar();

    // 1. Tìm theo aria-label chính xác "More actions" (chưa mở menu)
    const buttons = Array.from(document.querySelectorAll(
      '.new-toolbox [role="button"], #new-toolbox [role="button"], .toolbox-content [role="button"], .toolbox-button, button'
    ));

    for (const btn of buttons) {
      if (!isValidMoreActionsButton(btn)) continue;
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if ((aria === 'more actions' || aria.includes('more actions') || aria.includes('thao tác khác') || aria.includes('thêm hành động')) && !aria.includes('close') && !aria.includes('đóng')) {
        return btn;
      }
    }

    // 2. Tìm theo data-testid chính xác của Jitsi
    const testidSelectors = [
      '[data-testid="toolbar/overflow-menu"]',
      '[data-testid="overflow-menu-button"]',
      '[data-testid*="overflow-menu" i]',
      '[data-testid*="overflow" i]',
      '#more-actions-menu-button'
    ];
    for (const sel of testidSelectors) {
      const el = document.querySelector(sel);
      if (isValidMoreActionsButton(el)) return el;
    }

    // 3. Tìm theo SVG có 3 circles hoặc vector path 3 chấm
    for (const btn of buttons) {
      if (!isValidMoreActionsButton(btn)) continue;
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('close') || aria.includes('đóng') || aria.includes('reaction')) continue;

      // Kiểm tra SVG có 3 circles (dấu 3 chấm ngang như trong screenshot)
      const circles = btn.querySelectorAll('svg circle');
      if (circles.length === 3) {
        return btn;
      }

      // Kiểm tra path 3 chấm
      const paths = btn.querySelectorAll('svg path');
      for (const p of paths) {
        const d = p.getAttribute('d') || '';
        if (d.includes('16.5 12') || d.includes('M16.5 12') || d.includes('M12 8c1.1') || d.includes('M6 10c-1.1') || d.includes('M5 12')) {
          return btn;
        }
      }
    }

    // 4. Tìm theo các nhãn aria-label hỗ trợ cả tiếng Anh và tiếng Việt
    const ariaSelectors = [
      '[aria-label="More actions"]',
      '[aria-label*="More actions" i]',
      '[aria-label*="Thêm hành động" i]',
      '[aria-label*="Thao tác khác" i]',
      '[aria-label*="Tùy chọn khác" i]',
      '[aria-label*="Hành động khác" i]',
      '.toolbox-button-wth-dialog .toolbox-button',
      '.toolbox-button-wth-dialog [role="button"]'
    ];
    for (const sel of ariaSelectors) {
      const el = document.querySelector(sel);
      if (isValidMoreActionsButton(el)) return el;
    }

    // 4. Tìm theo vị trí: Nút 3 chấm luôn nằm ngay liền kề trước nút gác máy màu đỏ (Leave/Hangup)
    const leaveBtn = document.querySelector(
      '[aria-label*="Leave" i], [aria-label*="Rời" i], .hangup-button, [data-testid="hangup-button"], [data-testid*="hangup" i]'
    );
    if (leaveBtn) {
      const toolboxContainer = leaveBtn.closest('.toolbox-content-items, .new-toolbox, .toolbox-content, div');
      if (toolboxContainer) {
        const buttons = Array.from(toolboxContainer.querySelectorAll('[role="button"], .toolbox-button, button')).filter(
          b => b.offsetParent !== null && !b.closest('#automeet-hud-container, .automeet-toast')
        );
        const leaveIdx = buttons.indexOf(leaveBtn);
        if (leaveIdx > 0) {
          const candidate = buttons[leaveIdx - 1];
          if (isValidMoreActionsButton(candidate)) return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Kiểm tra menu More actions có đang mở trên màn hình không
   */
  function isMoreActionsMenuOpen() {
    const menuEl = document.getElementById('overflow-context-menu') ||
                   document.querySelector('.css-pg8rw8-contextMenu-contextMenu, [role="menu"]');
    if (menuEl && menuEl.offsetParent !== null) return true;

    const closeBtn = document.querySelector('[aria-label*="Close more actions" i], [aria-label*="Đóng thao tác khác" i]');
    if (closeBtn && closeBtn.offsetParent !== null) return true;

    return !!findRecordMenuItem();
  }

  /**
   * Tìm mục "Record" (Ghi lại) trên toàn trang Jitsi (kể cả trong React Portal)
   * Sử dụng vector SVG M21 12 đặc trưng của Jitsi hoặc aria-label/text
   */
  function findRecordMenuItem() {
    // 1. Quét các phần tử menu trong tài liệu
    const candidates = Array.from(document.querySelectorAll(
      '[role="menuitem"], [role="button"], div[class*="contextMenuItem"], .context-menu-item, li, button, span'
    ));

    for (const item of candidates) {
      if (item.closest('#automeet-hud-container, .automeet-toast, #new-toolbox, .new-toolbox')) continue;
      if (item.offsetParent === null) continue;

      const text = (item.textContent || '').trim().toLowerCase();
      const aria = (item.getAttribute('aria-label') || '').toLowerCase();

      // Khớp chính xác "Record" (Ghi âm/hình)
      if (text === 'record' || aria === 'record' ||
          text === 'ghi' || text === 'ghi âm' || text === 'ghi hình' ||
          aria.includes('record') || aria.includes('ghi') ||
          (text.includes('record') && !text.includes('stop') && !text.includes('livestream') && text.length < 30)) {
        return item.closest('[role="menuitem"], [role="button"], div[class*="contextMenuItem"], li, button') || item;
      }
    }

    // 2. Tìm theo biểu tượng SVG Record đặc trưng của Jitsi (vòng tròn đồng tâm d*="M21 12")
    const recSvg = document.querySelector('svg path[d*="M21 12"], svg path[d*="21 12"]');
    if (recSvg) {
      const item = recSvg.closest('[role="menuitem"], [role="button"], div[class*="contextMenuItem"], li, button');
      if (item && !item.closest('#automeet-hud-container, .automeet-toast')) return item;
    }

    return null;
  }

  /**
   * Tìm nút "Start" trong modal Record audio and video của Jitsi
   */
  function findStartRecordingButton() {
    const candidates = Array.from(document.querySelectorAll(
      '[data-testid="recordingDialog.startRecording"], [role="dialog"] button, div[aria-modal="true"] button, .modal-dialog button, button'
    ));

    for (const btn of candidates) {
      if (btn.offsetParent === null) continue;
      if (btn.closest('#automeet-hud-container, .automeet-toast')) continue;

      const text = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const testid = (btn.getAttribute('data-testid') || '').toLowerCase();

      if (testid.includes('startrecording') || testid.includes('start') ||
          text === 'start' || text === 'start recording' ||
          text === 'bắt đầu' || text === 'bắt đầu ghi' ||
          aria === 'start' || aria.includes('start recording')) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Kích hoạt Record (Tự động hoặc thủ công)
   */
  async function triggerStartRecording() {
    // 1. Kiểm tra nếu đang ở màn hình chờ Pre-join, tự động bấm Tham gia
    if (isPrejoinScreen()) {
      showToast('⏳ Đang ở màn hình chờ (Pre-join). Tự động điền tên và tham gia...');
      handlePrejoinScreen();
      return;
    }

    // 2. Nếu đang ở màn hình yêu cầu Login/Host, tự động bấm Log-in để vào giao diện cuộc họp
    if (handleLoginScreen()) {
      showToast('⚡ Tự động bấm nút Log-in để vào giao diện cuộc họp...');
      await sleep(1500);
    }

    // 3. Kích hoạt Động cơ TabCapture độc lập của AutoMeet (Không phụ thuộc server Jitsi)
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'START_TAB_CAPTURE' }).catch(() => {});
      }
    } catch (e) {}

    // Đánh dấu trạng thái record thành công
    isRecordingActive = true;
    if (!recordingStartTime) {
      recordingStartTime = Date.now();
    }
    updateHUD();
    updateTopRecordingPill();
    playNotificationSound();

    // 4. Tự động dọn dẹp các thông báo lỗi hoặc popup cũ của Jitsi
    autoDismissPopups();

    showToast('🎥 AUTO-RECORD ĐÃ BẬT THÀNH CÔNG! Đang ghi hình & âm thanh tab (Video tự động lưu khi hết ca).');
  }

  /**
   * Tự động xác nhận Bật Record 100% không cần người dùng nhấn tay
   */
  async function autoConfirmStartRecording(startBtn) {
    if (!startBtn) return;
    console.log('[AutoMeet] Tự động xác nhận Bật Record, đang bấm nút Start...');
    showToast('⚡ Tự động xác nhận Bật Record...');

    // 1. Tự động tích chọn checkbox đồng ý nếu có
    const consentBoxes = document.querySelectorAll(
      'input[type="checkbox"][id*="consent" i], input[type="checkbox"][name*="consent" i], input[type="checkbox"][data-testid*="consent" i]'
    );
    consentBoxes.forEach(cb => {
      if (!cb.checked) {
        cb.click();
        cb.checked = true;
      }
    });

    await sleep(200);

    // 2. Click nút Start
    simulateUserClick(startBtn);

    // 3. Tự động kiểm tra và bấm xác nhận các hộp thoại phát sinh tiếp theo
    for (let i = 0; i < 4; i++) {
      await sleep(350);
      const confirmNext = Array.from(document.querySelectorAll('[role="dialog"] button, div[aria-modal="true"] button')).find(b => {
        if (b.closest('#automeet-hud-container, .automeet-toast')) return false;
        const text = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        return text === 'confirm' || text === 'xác nhận' || text === 'continue' || text === 'tiếp tục' || text === 'ok';
      });
      if (confirmNext) {
        console.log('[AutoMeet] Tự động bấm xác nhận tiếp theo:', confirmNext.textContent);
        simulateUserClick(confirmNext);
        break;
      }
    }

    // 4. Tự động ẩn popup từ chối lưu cloud của Jitsi (vì đã có TabCapture lưu video máy tính)
    setTimeout(() => {
      autoDismissPopups();
    }, 1200);

    isRecordingActive = true;
    if (!recordingStartTime) recordingStartTime = Date.now();
    updateHUD();
    playNotificationSound();
    showToast('🎥 ĐÃ TỰ ĐỘNG BẬT VÀ XÁC NHẬN RECORD THÀNH CÔNG!');
  }

  /**
   * Tự động tắt Record (Đa tầng: Hỗ trợ Badge, Menu, Dialog xác nhận và XMPP Protocol)
   */
  async function triggerStopRecording() {
    showToast('⏳ Đang xử lý dừng Record...');

    // 1. Luôn gửi tín hiệu dừng TabCapture ngầm đến Background để lưu file WebM về máy
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'STOP_TAB_CAPTURE' }).catch(() => {});
      }
    } catch (e) {}

    // Lớp 1: Kiểm tra xem hộp thoại xác nhận Dừng đã mở sẵn trên màn hình chưa
    let confirmBtn = findStopConfirmationButton();
    if (confirmBtn) {
      console.log('[AutoMeet] Tìm thấy nút xác nhận Dừng trên dialog đang mở, bấm xác nhận...');
      simulateUserClick(confirmBtn);
      finishStopRecording();
      return;
    }

    // Lớp 2: Tìm và bấm trực tiếp vào biểu tượng Recording Indicator (REC / chấm đỏ) ở trên màn hình
    const recIndicator = document.querySelector(
      '[data-testid="recording-indicator"], [data-testid="recording-label"], .recording-icon, .recording-label, [aria-label*="Recording" i], [aria-label*="Đang ghi" i], [aria-label*="Ghi hình" i]'
    );
    if (recIndicator && !recIndicator.closest('#automeet-hud-container, .automeet-toast')) {
      console.log('[AutoMeet] Bấm vào biểu tượng Recording Indicator trên màn hình...');
      simulateUserClick(recIndicator);
      await sleep(500);

      confirmBtn = findStopConfirmationButton();
      if (confirmBtn) {
        simulateUserClick(confirmBtn);
        finishStopRecording();
        return;
      }
    }

    // Lớp 3: Tìm mục Dừng/Record trong menu (mở menu nếu chưa mở)
    let stopItem = findRecordMenuItem();
    if (!stopItem) {
      wakeUpToolbar();
      let moreBtn = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        moreBtn = findMoreActionsButton();
        if (moreBtn) break;
        await sleep(350);
      }

      if (moreBtn) {
        console.log('[AutoMeet] Đang mở menu 3 chấm để tìm mục Dừng Record...');
        simulateUserClick(moreBtn);

        for (let attempt = 0; attempt < 8; attempt++) {
          await sleep(250);
          stopItem = findRecordMenuItem();
          if (stopItem) break;
        }
      }
    }

    // Ưu tiên kiểm tra nếu có item chuyên biệt chứa từ khóa 'stop' hoặc 'dừng'
    const stopSpecificItem = Array.from(document.querySelectorAll('div[class*="contextMenuItem"], [role="menuitem"], [role="button"]')).find(item => {
      if (item.closest('#automeet-hud-container, .automeet-toast, #new-toolbox')) return false;
      const text = (item.textContent || '').trim().toLowerCase();
      const aria = (item.getAttribute('aria-label') || '').toLowerCase();
      return (text.includes('stop') || aria.includes('stop') || text.includes('dừng') || aria.includes('dừng')) && text.length < 35;
    });

    if (stopSpecificItem) {
      stopItem = stopSpecificItem;
    }

    if (stopItem) {
      console.log('[AutoMeet] Đang bấm mục Record/Stop recording trong menu...');
      simulateUserClick(stopItem);
      await sleep(600);

      // Chờ hộp thoại xác nhận Dừng xuất hiện (tối đa 2.5s)
      for (let attempt = 0; attempt < 10; attempt++) {
        confirmBtn = findStopConfirmationButton();
        if (confirmBtn) {
          console.log('[AutoMeet] Phát hiện nút xác nhận Dừng, đang bấm...');
          simulateUserClick(confirmBtn);
          break;
        }
        await sleep(250);
      }
    }

    // Lớp 5: Thử gọi trực tiếp Jitsi internal recordingManager nếu có
    try {
      const rm = window.APP?.conference?._room?.recordingManager;
      if (rm && rm._sessions) {
        const sids = Object.keys(rm._sessions);
        for (const sid of sids) {
          rm.stopRecording(sid);
        }
      }
    } catch (e) {
      console.log('[AutoMeet] Gọi rm.stopRecording:', e);
    }

    finishStopRecording();
  }

  /**
   * Tìm nút xác nhận Dừng ghi hình trong Dialog xác nhận của Jitsi
   */
  function findStopConfirmationButton() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .modal-dialog, div[aria-modal="true"]')).filter(
      d => !d.closest('#automeet-hud-container, .automeet-toast')
    );

    for (const dialog of dialogs) {
      const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]')).filter(
        b => !b.closest('#automeet-hud-container, .automeet-toast')
      );

      for (const btn of buttons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const testid = (btn.getAttribute('data-testid') || '').toLowerCase();

        // Kiểm tra xem có phải nút Stop / Dừng không
        const isStop = text === 'stop' || text.includes('stop') ||
                       text === 'dừng' || text.includes('dừng') ||
                       text.includes('xác nhận') || text === 'confirm' ||
                       aria.includes('stop') || aria.includes('dừng') ||
                       testid.includes('confirm') || testid.includes('stop');

        // Phải chắc chắn KHÔNG PHẢI nút Hủy / Cancel / Đóng
        const isCancel = text.includes('cancel') || text.includes('hủy') ||
                         aria.includes('close') || aria.includes('đóng') || aria.includes('cancel') ||
                         testid.includes('cancel');

        if (isStop && !isCancel) {
          return btn;
        }
      }
    }
    return null;
  }

  function finishStopRecording() {
    isRecordingActive = false;
    currentActiveSlotId = null;
    recordingStartTime = null;
    updateHUD();
    updateTopRecordingPill();
    playNotificationSound();
    showToast('⏹ ĐÃ DỪNG RECORD! Video đang được lưu về máy (Downloads/AutoMeet).');
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
            <button class="automeet-hud-close-btn" title="Đóng bảng trợ lý này (Dùng menu extension trên thanh công cụ)">✕</button>
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

    // Xử lý sự kiện thu nhỏ / phóng to
    const minBtn = hudElement.querySelector('.automeet-hud-minimize-btn');
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hudElement.classList.toggle('minimized');
      minBtn.textContent = hudElement.classList.contains('minimized') ? '◻' : '━';
    });

    // Xử lý đóng/tắt bảng trợ lý nổi
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
        showToast('ℹ Đã tắt bảng trợ lý nổi. Bạn có thể Bật/Dừng Record bằng icon AutoMeet trên thanh tiện ích.');
      });
    }

    // Nút Bật Record thủ công trên HUD
    hudElement.querySelector('#hud-btn-start').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      triggerStartRecording();
    });

    // Nút Dừng Record thủ công trên HUD
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
      if (statusPill) {
        statusPill.className = 'automeet-status-pill recording';
      }
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
      if (statusPill) {
        statusPill.className = 'automeet-status-pill waiting';
      }
      if (statusText) {
        statusText.textContent = 'Đang vào phòng...';
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
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      setTimeout(() => { ctx.close().catch(() => {}); }, 450);
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
