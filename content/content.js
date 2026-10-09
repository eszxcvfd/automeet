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
    const targetUrl = utils ? utils.getMeetingUrl() : `https://meet.jit.si/${todayRoom}#config.prejoinConfig.enabled=false`;

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
      autoDismissPopups();
      checkRecordingState();
      checkSlotScheduleAutoRecord();
      updateHUD();
    }, 2000);
  }

  /**
   * Tự động tắt các thông báo / banner che khuất màn hình (như "Invite others", "Dismiss", v.v.)
   */
  function autoDismissPopups() {
    const dismissBtns = Array.from(document.querySelectorAll(
      'button[aria-label="Dismiss"], button[aria-label="Đóng"], button[aria-label="Close"], .close-btn, [data-testid="notifications.dismiss"]'
    )).filter(b => !b.closest('#automeet-hud-container, .automeet-toast, [role="dialog"]'));

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
        if (joinBtn && joinBtn.offsetParent !== null) {
          console.log('[AutoMeet] Phát hiện nút Join meeting, tự động bấm...');
          simulateUserClick(joinBtn);
          joinBtn.click();
          break;
        }
      }
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
   * Tự động kiểm tra và kích hoạt hoặc dừng record theo khung giờ lịch trình
   */
  async function checkSlotScheduleAutoRecord() {
    if (!currentSettings || !currentSettings.enableAutoRecord || !currentSettings.autoRecordIfInSlot) return;
    if (isStartingRecording || isStoppingRecording) return;

    // Không thao tác nếu đang ở màn hình chờ Pre-join
    const prejoinInput = document.querySelector('input[data-testid="prejoin.nameInput"], input[placeholder*="name" i]');
    const prejoinBtn = document.querySelector('[data-testid="prejoin.joinMeeting"], button.prejoin-btn');
    if (prejoinInput || prejoinBtn) return;

    // Đảm bảo đã vào trong cuộc họp (có giao diện họp)
    const inMeeting = document.querySelector('#videoconference_page, #new-toolbox, .toolbox-button, #largeVideoContainer');
    if (!inMeeting) return;

    const { inSlot, activeSchedule } = utils.checkCurrentSlot(currentSettings.schedules);

    if (inSlot && activeSchedule) {
      // Đang trong khung giờ một ca làm việc
      if (!isRecordingActive && currentActiveSlotId !== activeSchedule.id) {
        console.log(`[AutoMeet] Đang trong ${activeSchedule.name} (${activeSchedule.start} - ${activeSchedule.end}), kích hoạt tự động Record...`);
        currentActiveSlotId = activeSchedule.id;
        isStartingRecording = true;
        showToast(`⏰ Đến ${activeSchedule.name} (${activeSchedule.start} - ${activeSchedule.end}), tự động kích hoạt Record...`);
        try {
          await triggerStartRecording();
        } catch (err) {
          console.warn('[AutoMeet] Lỗi khi tự động kích hoạt Record:', err);
        } finally {
          isStartingRecording = false;
        }
      }
    } else {
      // Không nằm trong bất kỳ ca làm việc nào đang bật
      if (isRecordingActive && currentActiveSlotId !== null) {
        console.log(`[AutoMeet] Đã kết thúc ca làm việc, tự động dừng Record...`);
        showToast(`⏰ Đã hết ca làm việc, tự động dừng Record...`);
        isStoppingRecording = true;
        try {
          await triggerStopRecording();
        } catch (err) {
          console.warn('[AutoMeet] Lỗi khi tự động dừng Record:', err);
        } finally {
          isStoppingRecording = false;
          currentActiveSlotId = null;
        }
      } else if (!isRecordingActive) {
        currentActiveSlotId = null;
      }
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
  function isMoreActionsMenuOpen() {
    const moreBtn = findMoreActionsButton();
    const aria = (moreBtn?.getAttribute('aria-label') || '').toLowerCase();
    if (aria.includes('close') || aria.includes('đóng')) return true;
    return !!findRecordMenuItem();
  }

  /**
   * Tìm mục "Record" (Ghi lại) trên toàn trang Jitsi (kể cả trong React Portal)
   * Sử dụng vector SVG M21 12 đặc trưng của Jitsi hoặc aria-label/text
   */
  function findRecordMenuItem() {
    // 1. Tìm theo biểu tượng SVG Record đặc trưng của Jitsi (vòng tròn đồng tâm d*="M21 12")
    const recSvg = document.querySelector('svg path[d*="M21 12"], svg path[d*="21 12"]');
    if (recSvg) {
      const item = recSvg.closest('[role="button"], [role="menuitem"], div[class*="contextMenuItem"], li, button');
      if (item && !item.closest('#automeet-hud-container, .automeet-toast')) return item;
    }

    // 2. Tìm theo role="button" hoặc class contextMenuItem với aria-label chứa Record hoặc Ghi
    const byAria = document.querySelector(
      '[role="button"][aria-label="Record"], [role="button"][aria-label*="Record" i], [role="button"][aria-label*="Ghi" i], div[class*="contextMenuItem"][aria-label*="Record" i]'
    );
    if (byAria && !byAria.closest('#automeet-hud-container, .automeet-toast')) return byAria;

    // 3. Quét các phần tử contextMenuItem trong tài liệu
    const candidates = Array.from(document.querySelectorAll('div[class*="contextMenuItem"], [role="menuitem"], [role="button"]'));
    for (const item of candidates) {
      if (item.closest('#automeet-hud-container, .automeet-toast, #new-toolbox')) continue;
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
   * Kích hoạt Record (Tự động hoặc thủ công)
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
    let startBtn = document.querySelector('[data-testid="recordingDialog.startRecording"], button[aria-label*="Start recording" i]');
    if (startBtn && startBtn.offsetParent !== null) {
      highlightStartButton(startBtn);
      return;
    }

    showToast('⏳ Đang mở menu và chọn Record...');

    // Bước 1: Mở menu 3 chấm More actions (nếu chưa mở)
    let recordItem = findRecordMenuItem();
    if (!recordItem) {
      wakeUpToolbar();
      let moreBtn = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        moreBtn = findMoreActionsButton();
        if (moreBtn) break;
        await sleep(300);
      }

      if (!moreBtn) {
        console.warn('[AutoMeet] Chưa tìm thấy nút 3 chấm More actions!');
        showToast('⚠ Chưa tìm thấy thanh công cụ Jitsi. Vui lòng di chuột vào giữa màn hình cuộc họp.');
        return;
      }

      console.log('[AutoMeet] Đang click nút 3 chấm More actions...');
      simulateUserClick(moreBtn);

      // Chờ menu xuất hiện (tối đa 2.5s)
      for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(250);
        recordItem = findRecordMenuItem();
        if (recordItem) break;
      }
    }

    if (!recordItem) {
      console.warn('[AutoMeet] Không tìm thấy mục Record trong menu Jitsi!');
      showToast('⚠ Không tìm thấy mục "Record" trong danh sách menu!');
      return;
    }

    console.log('[AutoMeet] Đang click mục Record trong menu...');
    simulateUserClick(recordItem);

    // Bước 2: Chờ modal Record xuất hiện và highlight nút Start (tối đa 4s)
    for (let attempt = 0; attempt < 16; attempt++) {
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
      await autoConfirmStartRecording(startBtn);
    } else {
      playNotificationSound();
      showToast('👉 Đang kiểm tra luồng ghi âm...');
    }
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
    startBtn.click();

    // 3. Tự động kiểm tra và bấm xác nhận các hộp thoại phát sinh tiếp theo
    for (let i = 0; i < 6; i++) {
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
        confirmNext.click();
        break;
      }
    }

    playNotificationSound();
    showToast('🎥 ĐÃ TỰ ĐỘNG BẬT VÀ XÁC NHẬN RECORD THÀNH CÔNG!');
  }

  /**
   * Tự động tắt Record (Đa tầng: Hỗ trợ Badge, Menu, Dialog xác nhận và XMPP Protocol)
   */
  async function triggerStopRecording() {
    showToast('⏳ Đang xử lý dừng Record...');

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
    updateHUD();
    playNotificationSound();
    showToast('⏹ ĐÃ DỪNG RECORD! Video đang được lưu về máy (Downloads).');
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
