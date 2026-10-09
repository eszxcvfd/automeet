/**
 * AutoMeet - In-page script running in MAIN world
 * 1. Hook navigator.mediaDevices.getDisplayMedia để cung cấp MediaStream họp trực tiếp (KHÔNG MÀN HÌNH ĐEN, KHÔNG POPUP XIN QUYỀN).
 * 2. Hook window.showSaveFilePicker để tự động lưu video vào thư mục Downloads (KHÔNG POPUP LƯU FILE).
 * 3. Tự động điều khiển tính năng Local Recording của chính nền tảng Jitsi Meet (Bật/Tắt, hiện biểu tượng REC đỏ, âm thanh chuông thông báo).
 */
(function () {
  'use strict';

  if (window.__AUTOMEET_INPAGE_INITIALIZED__) {
    console.log('[AutoMeet Inpage] Script already initialized.');
    return;
  }
  window.__AUTOMEET_INPAGE_INITIALIZED__ = true;

  console.log('[AutoMeet Inpage] Initializing hooks in MAIN world...');

  let recordingStartTime = null;
  let isLocalRecordingActive = false;
  let recordingAnimFrameId = null;
  let audioContextInstance = null;

  /**
   * Helper sleep
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Tính initials từ tên người dùng (VD: "MINH VAN" -> "MV")
   */
  function getInitials(name) {
    if (!name) return '??';
    const words = name.trim().split(/\s+/);
    if (words.length > 1) {
      return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
    return words[0].substring(0, 2).toUpperCase();
  }

  /**
   * Tạo màu ngẫu nhiên nhưng cố định theo tên
   */
  function getAvatarColor(name) {
    const colors = ['#73348c', '#1d4ed8', '#0f766e', '#b45309', '#be123c', '#4338ca', '#0369a1'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  }

  let currentCaptureHandle = null;
  if (navigator.mediaDevices && typeof navigator.mediaDevices.setCaptureHandleConfig === 'function') {
    const origSetCaptureHandleConfig = navigator.mediaDevices.setCaptureHandleConfig.bind(navigator.mediaDevices);
    navigator.mediaDevices.setCaptureHandleConfig = function (config) {
      if (config && config.handle) {
        currentCaptureHandle = config.handle;
      }
      try {
        return origSetCaptureHandleConfig(config);
      } catch (e) {}
    };
  }

  /**
   * Tạo Canvas và render giao diện cuộc họp động (30fps, KHÔNG MÀN HÌNH ĐEN)
   * Render camera/màn hình chia sẻ nếu có, hoặc card đại diện người tham gia (Avatar, Initials, Tên, Trạng thái nói).
   */
  function createMeetingCompositeStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');

    let isRunning = true;

    function renderFrame() {
      if (!isRunning) return;

      const W = canvas.width;
      const H = canvas.height;

      // 1. Nền gradient tối sang trọng
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#0a0f1d');
      bgGrad.addColorStop(1, '#1e293b');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // 2. Thanh tiêu đề phía trên
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(0, 0, W, 54);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, 53, W, 1);

      // Badge tên phòng
      const roomName = window.location.pathname.replace(/^\/+|\/+$/g, '') || 'StaffAutoMeet';
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.roundRect(16, 11, Math.max(160, roomName.length * 11 + 24), 32, 6);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(roomName, 28, 27);

      // Thông tin ngày giờ & Trạng thái ca
      const now = new Date();
      const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false });
      const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px monospace';
      ctx.fillText(`AutoMeet Recorder  •  ${timeStr}  ${dateStr}`, Math.max(190, roomName.length * 11 + 48), 27);

      // Chỉ báo REC nhấp nháy góc phải
      const recPulse = Math.sin(Date.now() / 250) > 0;
      ctx.fillStyle = recPulse ? '#ef4444' : '#7f1d1d';
      ctx.beginPath();
      ctx.arc(W - 140, 27, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 13px -apple-system, sans-serif';
      ctx.fillText('REC', W - 128, 27);

      // Thời lượng ghi hình
      let timerStr = '[00:00]';
      if (recordingStartTime) {
        const sec = Math.floor((Date.now() - recordingStartTime) / 1000);
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        timerStr = `[${m}:${s}]`;
      }
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '13px monospace';
      ctx.fillText(timerStr, W - 85, 27);

      // 3. Lưới hiển thị người tham gia cuộc họp
      const store = window.APP?.store;
      const participantsState = store?.getState()['features/base/participants'];
      const localPart = participantsState?.local;
      const remotePartMap = participantsState?.remote;
      const remoteList = remotePartMap instanceof Map 
        ? Array.from(remotePartMap.values()) 
        : (remotePartMap ? Object.values(remotePartMap) : []);

      const list = [];
      if (localPart) {
        list.push({
          id: localPart.id,
          name: localPart.name || 'MINH VAN',
          role: localPart.role,
          local: true
        });
      }
      remoteList.forEach(r => {
        if (r) {
          list.push({
            id: r.id,
            name: r.name || 'Người tham gia',
            role: r.role,
            local: false
          });
        }
      });

      // Nếu chưa có ai trong store, hiển thị ít nhất 1 người
      if (list.length === 0) {
        list.push({ id: 'local', name: 'Thành viên', role: 'participant', local: true });
      }

      // Tìm các thẻ <video> có hình ảnh thực tế trên trang
      const activeVideos = Array.from(document.querySelectorAll('video')).filter(v => 
        v.videoWidth > 0 && !v.paused && !v.ended
      );

      const total = list.length;
      const cols = total > 1 ? 2 : 1;
      const rows = total > 2 ? 2 : 1;

      const pad = 16;
      const startY = 68;
      const availW = W - pad * (cols + 1);
      const availH = H - startY - pad * (rows + 1);
      const cellW = availW / cols;
      const cellH = availH / rows;

      list.slice(0, 4).forEach((part, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = pad + col * (cellW + pad);
        const y = startY + row * (cellH + pad);

        // Khung thẻ người dùng
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.roundRect(x, y, cellW, cellH, 12);
        ctx.fill();
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Kiểm tra xem người này có video feed đang chạy không
        let drawnVideo = false;
        if (activeVideos.length > 0 && activeVideos[idx]) {
          const vid = activeVideos[idx];
          try {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x, y, cellW, cellH, 12);
            ctx.clip();
            ctx.drawImage(vid, x, y, cellW, cellH);
            ctx.restore();
            drawnVideo = true;
          } catch (e) {}
        }

        // Nếu không có video mở camera, vẽ Avatar chuyên nghiệp của nền tảng Jitsi
        if (!drawnVideo) {
          const avatarR = Math.min(cellW, cellH) * 0.17;
          const avX = x + cellW / 2;
          const avY = y + cellH / 2 - 16;

          // Vòng sáng âm thanh (nếu là người nói chính)
          const isDominant = participantsState?.dominantSpeaker === part.id;
          if (isDominant) {
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(avX, avY, avatarR + 6, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Hình tròn Avatar
          ctx.fillStyle = getAvatarColor(part.name);
          ctx.beginPath();
          ctx.arc(avX, avY, avatarR, 0, Math.PI * 2);
          ctx.fill();

          // Ký tự viết tắt (Initials)
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.round(avatarR * 0.85)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(getInitials(part.name), avX, avY);

          // Tên người tham gia
          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 16px sans-serif';
          ctx.fillText(part.name, avX, avY + avatarR + 30);

          // Huy hiệu vai trò
          if (part.role === 'moderator') {
            ctx.fillStyle = '#38bdf8';
            ctx.font = '12px sans-serif';
            ctx.fillText('★ Người chủ trì (Host)', avX, avY + avatarR + 50);
          }
        } else {
          // Nếu có video, vẽ thanh tên nhỏ ở góc dưới
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.beginPath();
          ctx.roundRect(x + 12, y + cellH - 36, Math.min(200, cellW - 24), 26, 4);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(part.name, x + 20, y + cellH - 23);
        }
      });

      recordingAnimFrameId = requestAnimationFrame(renderFrame);
    }

    renderFrame();

    // Thu nhận video track từ canvas ở chuẩn 30 fps mượt mà
    const canvasStream = canvas.captureStream(30);
    const vTrack = canvasStream.getVideoTracks()[0];

    // Gán các hàm settings và handle để Jitsi nhận diện chuẩn xác
    const origGetSettings = vTrack.getSettings.bind(vTrack);
    vTrack.getSettings = () => Object.assign({}, origGetSettings(), { displaySurface: 'browser' });
    vTrack.getCaptureHandle = () => ({
      handle: currentCaptureHandle || `JitsiMeet-${window.location.pathname.replace(/^\/+|\/+$/g, '')}`
    });

    // Thu nhận và hòa âm toàn bộ Audio (Remote participants + Micro cục bộ)
    let aTrack = null;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContextInstance = new AudioCtx();
        const destination = audioContextInstance.createMediaStreamDestination();

        // 1. Hòa âm các thẻ <audio> phát giọng nói người khác
        const audioElements = Array.from(document.querySelectorAll('audio'));
        audioElements.forEach(audioEl => {
          try {
            if (!audioEl.__automeet_hooked__) {
              audioEl.__automeet_hooked__ = true;
              const source = audioContextInstance.createMediaElementSource(audioEl);
              source.connect(destination);
              source.connect(audioContextInstance.destination); // Tiếp tục phát ra loa ngoài
            }
          } catch (e) {}
        });

        // 2. Hòa âm giọng nói từ Micro của chính mình (nếu Jitsi đã có track)
        const localTrack = window.APP?.conference?.getLocalAudioTrack?.();
        if (localTrack?.stream) {
          try {
            const micSource = audioContextInstance.createMediaStreamSource(localTrack.stream);
            micSource.connect(destination);
          } catch (e) {}
        }

        aTrack = destination.stream.getAudioTracks()[0];
      }
    } catch (err) {
      console.warn('[AutoMeet Inpage] Lỗi khởi tạo AudioContext mixer:', err);
    }

    if (!aTrack) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const fallbackCtx = new AudioCtx();
          const dest = fallbackCtx.createMediaStreamDestination();
          aTrack = dest.stream.getAudioTracks()[0];
        }
      } catch (e) {}
    }

    const outputTracks = [vTrack];
    if (aTrack) {
      outputTracks.push(aTrack);
    }

    const stream = new MediaStream(outputTracks);
    vTrack.addEventListener('ended', () => {
      isRunning = false;
      if (recordingAnimFrameId) cancelAnimationFrame(recordingAnimFrameId);
    });

    return stream;
  }

  /**
   * 1. HOOK: navigator.mediaDevices.getDisplayMedia
   * Chặn hộp thoại xin quyền chia sẻ màn hình của Chrome, cung cấp stream hội nghị tự động.
   */
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
    const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getDisplayMedia = async function (constraints) {
      console.log('[AutoMeet Inpage] getDisplayMedia called. Providing automated non-black composite stream...');
      try {
        const stream = createMeetingCompositeStream();
        console.log('[AutoMeet Inpage] Composite stream generated successfully:', stream);
        return stream;
      } catch (err) {
        console.warn('[AutoMeet Inpage] Lỗi tạo composite stream, gọi fallback gốc:', err);
        return await origGetDisplayMedia(constraints);
      }
    };
  }

  /**
   * 2. HOOK: window.showSaveFilePicker
   * Chặn hộp thoại "Save As" của trình duyệt, tự động thu thập chunks và tải file về máy.
   */
  if (typeof window.showSaveFilePicker !== 'undefined') {
    window.showSaveFilePicker = async function (options) {
      console.log('[AutoMeet Inpage] showSaveFilePicker intercepted. Providing auto-save stream...');

      const chunks = [];
      let isClosed = false;

      const mockWritable = {
        write: async function (data) {
          chunks.push(data);
        },
        seek: async function () {},
        truncate: async function () {},
        close: async function () {
          if (isClosed) return;
          isClosed = true;
          console.log('[AutoMeet Inpage] File stream closed. Total chunks collected:', chunks.length);

          if (chunks.length === 0) {
            console.warn('[AutoMeet Inpage] Chunks trống, bỏ qua lưu file.');
            return;
          }

          const blob = new Blob(chunks, { type: 'video/webm' });
          console.log('[AutoMeet Inpage] Recorded file size:', blob.size, 'bytes');

          // Đặt tên file chuẩn: Staff{Năm}W{Tuần}T{Thứ}_{Ca}_{ThờiGian}.webm
          const now = new Date();
          const y = now.getFullYear();
          const mo = String(now.getMonth() + 1).padStart(2, '0');
          const d = String(now.getDate()).padStart(2, '0');
          const h = String(now.getHours()).padStart(2, '0');
          const mi = String(now.getMinutes()).padStart(2, '0');
          const s = String(now.getSeconds()).padStart(2, '0');
          const room = window.location.pathname.replace(/^\/+|\/+$/g, '') || 'StaffMeet';
          const cleanFilename = `${room}_${y}-${mo}-${d}_${h}-${mi}-${s}.webm`;

          // 1. Tự động tải về máy qua thẻ <a>
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = blobUrl;
          a.download = cleanFilename;
          document.body.appendChild(a);
          a.click();
          console.log(`[AutoMeet Inpage] Đã kích hoạt tải video về Downloads: ${cleanFilename}`);

          setTimeout(() => {
            a.remove();
          }, 60000);

          // 2. Gửi thông báo đến Content Script để background cũng tải qua chrome.downloads (bảo đảm 100%)
          window.postMessage({
            type: 'AUTOMEET_FILE_RECORDED',
            url: blobUrl,
            filename: cleanFilename,
            size: blob.size
          }, '*');
        }
      };

      const mockHandle = {
        kind: 'file',
        name: options?.suggestedName || 'recording.webm',
        createWritable: async function () {
          chunks.length = 0;
          isClosed = false;
          return mockWritable;
        }
      };

      return mockHandle;
    };
  }

  /**
   * 3. Bật Local Recording chính thức của Jitsi Meet
   */
  async function startJitsiLocalRecording() {
    const store = window.APP?.store;
    if (!store) {
      console.warn('[AutoMeet Inpage] window.APP.store chưa sẵn sàng.');
      return false;
    }

    const state = store.getState();
    const isRunning = Boolean(state['features/recording']?.localRecordingRunning);
    if (isRunning) {
      console.log('[AutoMeet Inpage] Local Recording đã đang chạy.');
      isLocalRecordingActive = true;
      if (!recordingStartTime) recordingStartTime = Date.now();
      return true;
    }

    console.log('[AutoMeet Inpage] Bắt đầu kích hoạt Local Recording...');
    recordingStartTime = Date.now();

    // 1. Mở toolbox nếu đang ẩn
    store.dispatch({ type: 'SHOW_TOOLBOX' });
    await sleep(200);

    // 2. Bấm More actions
    const moreBtn = document.querySelector('[aria-label="More actions"]');
    if (moreBtn) {
      moreBtn.click();
      await sleep(300);
    }

    // 3. Bấm Record trong overflow menu
    const recordItem = document.querySelector('[aria-label="Record"]');
    if (recordItem) {
      recordItem.click();
      await sleep(300);
    }

    // 4. Bấm Start recording trong dialog
    const startBtn = document.querySelector('[aria-label="Start recording"]');
    if (startBtn) {
      startBtn.click();
      await sleep(500);
    }

    // Fallback: Nếu giao diện Jitsi đóng nhanh hoặc chưa cập nhật Redux, chủ động dispatch
    const updatedRunning = Boolean(store.getState()['features/recording']?.localRecordingRunning);
    if (!updatedRunning) {
      store.dispatch({ type: 'SET_LOCAL_RECORDING_RUNNING', running: true });
      store.dispatch({ type: 'PLAY_SOUND', soundId: 'RECORDING_ON_SOUND' });
    }

    isLocalRecordingActive = true;
    console.log('[AutoMeet Inpage] Đã kích hoạt thành công Local Recording của Jitsi!');
    return true;
  }

  /**
   * 4. Dừng Local Recording chính thức của Jitsi Meet
   */
  async function stopJitsiLocalRecording() {
    const store = window.APP?.store;
    if (!store) return false;

    console.log('[AutoMeet Inpage] Đang dừng Local Recording...');

    // 1. Thử bấm biểu tượng REC đỏ để mở dialog xác nhận dừng
    const recBadge = document.querySelector('.css-1u0rek3-label-clickable-withI18nextTranslation_Connect_Component__-record, [class*="record"]');
    if (recBadge) {
      recBadge.click();
      await sleep(300);
      const stopBtn = document.querySelector('[aria-label="Stop recording"]');
      if (stopBtn) {
        stopBtn.click();
        await sleep(500);
      }
    }

    // 2. Dispatch dừng vào Redux để dọn dẹp sạch sẽ
    store.dispatch({ type: 'SET_LOCAL_RECORDING_RUNNING', running: false });
    store.dispatch({ type: 'PLAY_SOUND', soundId: 'RECORDING_OFF_SOUND' });

    isLocalRecordingActive = false;
    recordingStartTime = null;
    if (recordingAnimFrameId) {
      cancelAnimationFrame(recordingAnimFrameId);
      recordingAnimFrameId = null;
    }

    console.log('[AutoMeet Inpage] Đã dừng Local Recording.');
    return true;
  }

  /**
   * Lắng nghe thông điệp điều khiển từ Content Script
   */
  window.addEventListener('message', async (event) => {
    if (!event.data || !event.data.type) return;

    if (event.data.type === 'AUTOMEET_START_LOCAL_REC') {
      await startJitsiLocalRecording();
    } else if (event.data.type === 'AUTOMEET_STOP_LOCAL_REC') {
      await stopJitsiLocalRecording();
    }
  });

  /**
   * Định kỳ đồng bộ trạng thái thực tế lên Content Script
   */
  setInterval(() => {
    try {
      const store = window.APP?.store;
      let isRunning = isLocalRecordingActive;
      if (store) {
        const stateRunning = Boolean(store.getState()['features/recording']?.localRecordingRunning);
        if (stateRunning) {
          isRunning = true;
          isLocalRecordingActive = true;
          if (!recordingStartTime) recordingStartTime = Date.now();
        } else if (!stateRunning && isLocalRecordingActive) {
          // Bị dừng từ giao diện Jitsi
          isRunning = false;
          isLocalRecordingActive = false;
          recordingStartTime = null;
        }
      }

      const elapsedSec = recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0;

      window.postMessage({
        type: 'AUTOMEET_SYNC_RECORDING_STATE',
        isRunning: isRunning,
        durationSec: elapsedSec
      }, '*');
    } catch (e) {}
  }, 1000);

  console.log('[AutoMeet Inpage] Hooks ready.');
})();
