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
  let lastRecordAttemptTime = 0;

  // Khởi tạo
  init();

  async function init() {
    injectInpageHooks();

    if (utils) {
      currentSettings = await utils.loadSettings();
    }

    // Luôn dọn dẹp HUD cũ trên màn hình theo yêu cầu người dùng (chỉ dùng menu extension)
    const existingHud = document.getElementById('automeet-hud-container');
    if (existingHud) existingHud.remove();
    hudElement = null;

    // Lắng nghe sự kiện đồng bộ từ In-page script (chạy ở MAIN world)
    window.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'AUTOMEET_SYNC_RECORDING_STATE') {
        if (typeof event.data.isRunning === 'boolean') {
          const wasRunning = isRecordingActive;
          isRecordingActive = event.data.isRunning;
          if (isRecordingActive && !wasRunning) {
            recordingStartTime = Date.now();
            updateTopRecordingPill();
          } else if (!isRecordingActive && wasRunning) {
            recordingStartTime = null;
            updateTopRecordingPill();
          }
        }
      } else if (event.data.action === 'AUTOMEET_LOCAL_REC_SAVED') {
        showToast(`💾 Đã lưu video Local Recording của Jitsi: ${event.data.filename}`);
        if (event.data.blobUrl && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'SAVE_RECORDING_BLOB',
            blobUrl: event.data.blobUrl,
            filename: event.data.filename
          });
        }
      }
    });

    // 1. Đảm bảo script inpage luôn được nhúng vào trang web
    injectInpageHooks();

    // 2. Kiểm tra nếu đang ở trang chủ (chưa vào phòng)
    const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (!pathname) {
      handleHomePage();
      return;
    }

    // 3. Nếu đang ở trang phòng họp
    startMeetingWatcher();
    listenForMessages();

    // 4. Khởi động kiểm tra lịch sau 3 giây khi vào phòng
    setTimeout(() => {
      checkSlotScheduleAutoRecord();
    }, 3000);
  }

  /**
   * Đảm bảo inpage hooks luôn được nhúng vào MAIN world của Jitsi Meet
   * Sử dụng kỹ thuật inline injection để chạy tức thì và chắc chắn 100% không phụ thuộc network/CSP.
   */
  function injectInpageHooks() {
    if (document.getElementById('automeet-inpage-inline')) return;
    try {
      const script = document.createElement('script');
      script.id = 'automeet-inpage-inline';
      script.textContent = `(${function() {
        if (window.__AUTOMEET_INPAGE_INITIALIZED__) return;
        window.__AUTOMEET_INPAGE_INITIALIZED__ = true;
        console.log('[AutoMeet Inpage] Hooks activated in MAIN world.');

        let currentCaptureHandle = 'JitsiMeet-automeet';

        function hookSetCaptureHandleConfig(obj) {
          if (!obj || typeof obj.setCaptureHandleConfig !== 'function') return;
          const orig = obj.setCaptureHandleConfig.bind(obj);
          obj.setCaptureHandleConfig = function(config) {
            if (config && config.handle) currentCaptureHandle = config.handle;
            try { return orig(config); } catch (e) {}
          };
        }
        if (typeof MediaDevices !== 'undefined' && MediaDevices.prototype) {
          hookSetCaptureHandleConfig(MediaDevices.prototype);
        }
        if (navigator.mediaDevices) {
          hookSetCaptureHandleConfig(navigator.mediaDevices);
        }

        async function automatedGetDisplayMedia(constraints) {
          console.log('[AutoMeet Inpage] getDisplayMedia intercepted. Providing automated MediaStream...');
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#1e1e1e';
          ctx.fillRect(0, 0, 1280, 720);

          let animRunning = true;
          function drawFrame() {
            if (!animRunning) return;
            const vid = document.querySelector('#largeVideo, video');
            if (vid && vid.videoWidth > 0 && !vid.paused && !vid.ended) {
              try { ctx.drawImage(vid, 0, 0, 1280, 720); } catch (e) {}
            }
            requestAnimationFrame(drawFrame);
          }
          drawFrame();

          const canvasStream = canvas.captureStream(30);
          const vTrack = canvasStream.getVideoTracks()[0];

          const origGetSettings = vTrack.getSettings.bind(vTrack);
          vTrack.getSettings = () => Object.assign({}, origGetSettings(), { displaySurface: 'browser' });
          vTrack.getCaptureHandle = () => ({ handle: currentCaptureHandle });

          let aTrack = null;
          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
              const audioCtx = new AudioCtx();
              const dest = audioCtx.createMediaStreamDestination();
              aTrack = dest.stream.getAudioTracks()[0];
            }
          } catch (e) {}

          const tracks = [vTrack];
          if (aTrack) tracks.push(aTrack);

          const stream = new MediaStream(tracks);
          vTrack.addEventListener('ended', () => { animRunning = false; });
          return stream;
        }

        if (typeof MediaDevices !== 'undefined' && MediaDevices.prototype) {
          MediaDevices.prototype.getDisplayMedia = automatedGetDisplayMedia;
        }
        if (navigator.mediaDevices) {
          navigator.mediaDevices.getDisplayMedia = automatedGetDisplayMedia;
        }

        window.showSaveFilePicker = async function(options) {
          console.log('[AutoMeet Inpage] showSaveFilePicker intercepted:', options);
          const filename = options?.suggestedName || ('AutoMeet_' + Date.now() + '.webm');
          const chunks = [];
          let position = 0;

          return {
            kind: 'file',
            name: filename,
            createWritable: async function() {
              return {
                write: async function(chunk) {
                  if (position === 0 && chunks.length > 0) {
                    chunks[0] = chunk;
                  } else {
                    chunks.push(chunk);
                  }
                  position += (chunk.byteLength || chunk.size || 0);
                },
                seek: async function(pos) { position = pos; },
                close: async function() {
                  try {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    const blobUrl = URL.createObjectURL(blob);
                    window.postMessage({
                      action: 'AUTOMEET_LOCAL_REC_SAVED',
                      blobUrl: blobUrl,
                      filename: filename
                    }, '*');
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => { a.remove(); URL.revokeObjectURL(blobUrl); }, 60000);
                    console.log('[AutoMeet Inpage] Tự động tải video Local Recording:', filename);
                  } catch (e) {
                    console.error('[AutoMeet Inpage] Lỗi khi lưu file:', e);
                  }
                }
              };
            }
          };
        };

        async function startLocalRecordingWithRetry() {
          console.log('[AutoMeet Inpage] Bắt đầu tiến trình kích hoạt Local Recording...');
          for (let attempt = 0; attempt < 30; attempt++) {
            const store = window.APP?.store;
            const state = store?.getState();
            const confState = state?.['features/base/conference'];
            const isJoined = Boolean(confState?.conference);

            if (store && isJoined) {
              const isAlreadyRunning = Boolean(state?.['features/recording']?.localRecordingRunning);
              if (isAlreadyRunning) {
                console.log('[AutoMeet Inpage] Local Recording đã đang chạy!');
                return;
              }
              console.log('[AutoMeet Inpage] Đã vào phòng họp. Dispatch START_LOCAL_RECORDING vào Jitsi Redux...');
              try {
                store.dispatch({ type: 'START_LOCAL_RECORDING', onlySelf: false });
              } catch (err) {
                console.warn('[AutoMeet Inpage] Dispatch error:', err);
              }
              return;
            }
            await new Promise(r => setTimeout(r, 500));
          }
          console.warn('[AutoMeet Inpage] Timeout chờ vào phòng họp (15s).');
        }

        function stopLocalRecording() {
          const store = window.APP?.store;
          if (store) {
            console.log('[AutoMeet Inpage] Dispatch STOP_LOCAL_RECORDING vào Jitsi Redux...');
            try { store.dispatch({ type: 'STOP_LOCAL_RECORDING' }); } catch (err) {}
          }
        }

        window.addEventListener('message', function(event) {
          if (!event.data || !event.data.type) return;
          if (event.data.type === 'AUTOMEET_DISPATCH_START_LOCAL_REC') {
            startLocalRecordingWithRetry();
          } else if (event.data.type === 'AUTOMEET_DISPATCH_STOP_LOCAL_REC') {
            stopLocalRecording();
          }
        });

        setInterval(() => {
          try {
            const state = window.APP?.store?.getState();
            const isRunning = Boolean(state?.['features/recording']?.localRecordingRunning);
            window.postMessage({ type: 'AUTOMEET_SYNC_RECORDING_STATE', isRunning: isRunning }, '*');
          } catch (e) {}
        }, 1000);
      }.toString()})();`;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      console.log('[AutoMeet Content] Đã nhúng inpage hooks inline thành công');
    } catch (e) {
      console.warn('[AutoMeet Content] Không thể nhúng inpage hooks:', e);
    }
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
    // 1. Tự động đóng và gỡ bỏ thông báo lỗi "Recording failed to start" của Jitsi nếu có
    const jitsiAlerts = Array.from(document.querySelectorAll(
      '.css-146e27r-notification, .jitsi-notification, [role="alert"], div[class*="notification"]'
    ));
    for (const alert of jitsiAlerts) {
      if (alert.closest('.automeet-toast, [role="dialog"], #automeet-rec-pill')) continue;
      const text = (alert.textContent || '').toLowerCase();
      if (text.includes('recording failed') || text.includes('failed to start') || text.includes('error starting')) {
        const dismissBtn = alert.querySelector('button, [role="button"], a');
        if (dismissBtn) {
          try { dismissBtn.click(); } catch(e) {}
        }
        try { alert.remove(); } catch(e) {}
      }
    }

    // 2. Tự động đóng các popup che khuất không phải là dialog Record
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
    // 1. Tìm các chỉ báo ghi âm trên giao diện Jitsi (bao gồm cả class -record của Jitsi)
    const recBadge = document.querySelector(
      '[data-testid="recording-indicator"], .recording-icon, [class*="-record"], [aria-label*="Recording is on" i], [aria-label*="Đang ghi" i]'
    );
    
    // 2. Hoặc kiểm tra badge REC màu đỏ
    const recTextElements = Array.from(document.querySelectorAll('span, div')).filter(el => {
      if (el.closest('.automeet-toast, #automeet-rec-pill')) return false;
      return el.textContent && el.textContent.trim() === 'REC' && el.offsetParent !== null;
    });

    const isJitsiRecording = !!recBadge || recTextElements.length > 0;
    const wasRecording = isRecordingActive;
    isRecordingActive = isJitsiRecording;

    if (isRecordingActive && !wasRecording) {
      if (!recordingStartTime) recordingStartTime = Date.now();
      updateTopRecordingPill();
    } else if (!isRecordingActive && wasRecording) {
      recordingStartTime = null;
      updateTopRecordingPill();
    }

    return isRecordingActive;
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
      // Đang trong khung giờ một ca làm việc: Nếu chưa ghi hình thì thử lại sau mỗi 5s cho tới khi thành công
      if (!isRecordingActive && !isStartingRecording) {
        const now = Date.now();
        if (now - lastRecordAttemptTime > 5000) {
          lastRecordAttemptTime = now;
          console.log(`[AutoMeet] Đang trong ${activeSchedule.name} (${activeSchedule.start} - ${activeSchedule.end}), tự động kích hoạt Record...`);
          isStartingRecording = true;
          showToast(`⏰ Đang trong ${activeSchedule.name} (${activeSchedule.start} - ${activeSchedule.end}): Tự động kích hoạt Record...`);

          try {
            await triggerStartRecording();
          } catch (err) {
            console.warn('[AutoMeet] Lỗi khi tự động kích hoạt Record:', err);
          } finally {
            isStartingRecording = false;
          }
        }
      }
    } else {
      // Không nằm trong bất kỳ ca làm việc nào đang bật -> Tự động dừng Record và lưu video
      if (isRecordingActive) {
        console.log(`[AutoMeet] Đã kết thúc ca làm việc, tự động dừng Record và lưu file...`);
        showToast(`⏰ Đã hết ca làm việc: Tự động dừng Record và lưu video...`);
        isStoppingRecording = true;
        try {
          await triggerStopRecording();
        } catch (err) {
          console.warn('[AutoMeet] Lỗi khi tự động dừng Record:', err);
        } finally {
          isStoppingRecording = false;
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
   * Kích hoạt Record của chính nền tảng Jitsi Meet (Local Recording lưu về máy)
   * Sử dụng cơ chế hook Redux & MediaStreams để chạy tự động 100%, không hiện popup xin quyền
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

    // 3. Nếu Jitsi đã đang trong trạng thái Record, không kích hoạt lại
    if (checkRecordingState()) {
      showToast('🎥 Jitsi Meet hiện đang trong trạng thái ghi hình (Local Recording)!');
      return;
    }

    showToast('🎥 Đang kích hoạt Local Recording của Jitsi (Lưu local về máy)...');

    // 4. Gửi tín hiệu kích hoạt trực tiếp tới inpage script (chạy trong MAIN world)
    window.postMessage({ type: 'AUTOMEET_DISPATCH_START_LOCAL_REC' }, '*');

    // Đợi cập nhật trạng thái
    await sleep(1500);
    checkRecordingState();
    updateHUD();
    updateTopRecordingPill();
  }

  /**
   * Tự động tắt Record trên Jitsi Meet (Dừng Local Recording và lưu video về máy)
   */
  async function triggerStopRecording() {
    showToast('⏳ Đang xử lý dừng Local Recording trên Jitsi...');

    // 1. Gửi lệnh Redux stop trực tiếp tới inpage script (chạy trong MAIN world)
    window.postMessage({ type: 'AUTOMEET_DISPATCH_STOP_LOCAL_REC' }, '*');

    await sleep(1000);
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
