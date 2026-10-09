/**
 * AutoMeet - In-page script running in MAIN world
 * Intercepts navigator.mediaDevices.getDisplayMedia and setCaptureHandleConfig to satisfy
 * Jitsi Meet's local recording requirements with ZERO user prompts (no "Allow to see tab" dialog).
 * Intercepts window.showSaveFilePicker to auto-save .webm files directly without file picker dialog.
 * Dispatches Redux actions directly to Jitsi Meet's store.
 */
(function() {
  'use strict';

  if (window.__AUTOMEET_INPAGE_INITIALIZED__) return;
  window.__AUTOMEET_INPAGE_INITIALIZED__ = true;

  let currentCaptureHandle = 'JitsiMeet-automeet';

  // 1. Hook navigator.mediaDevices.setCaptureHandleConfig
  if (navigator.mediaDevices) {
    const origSetCapture = navigator.mediaDevices.setCaptureHandleConfig?.bind(navigator.mediaDevices);
    navigator.mediaDevices.setCaptureHandleConfig = function(config) {
      if (config && config.handle) {
        currentCaptureHandle = config.handle;
      }
      if (origSetCapture) {
        try { origSetCapture(config); } catch (e) {}
      }
    };

    // 2. Hook navigator.mediaDevices.getDisplayMedia to eliminate the Chrome native permission dialog
    navigator.mediaDevices.getDisplayMedia = async function(constraints) {
      console.log('[AutoMeet Inpage] getDisplayMedia called. Providing automated MediaStream for Jitsi...');

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
          try {
            ctx.drawImage(vid, 0, 0, 1280, 720);
          } catch (e) {}
        }
        requestAnimationFrame(drawFrame);
      }
      drawFrame();

      const canvasStream = canvas.captureStream(30);
      const vTrack = canvasStream.getVideoTracks()[0];

      // Thỏa mãn điều kiện kiểm tra của Jitsi Meet:
      // 1. "browser" === e.getSettings().displaySurface
      // 2. e.getCaptureHandle()?.handle === currentCaptureHandle
      const origGetSettings = vTrack.getSettings.bind(vTrack);
      vTrack.getSettings = () => Object.assign({}, origGetSettings(), { displaySurface: 'browser' });
      vTrack.getCaptureHandle = () => ({ handle: currentCaptureHandle });

      // Audio track để Jitsi initializeAudioMixer không ném lỗi
      let aTrack = null;
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = audioCtx.createMediaStreamDestination();
        aTrack = dest.stream.getAudioTracks()[0];
      } catch (e) {
        console.warn('[AutoMeet Inpage] AudioContext init error:', e);
      }

      const tracks = [vTrack];
      if (aTrack) tracks.push(aTrack);

      const stream = new MediaStream(tracks);
      vTrack.addEventListener('ended', () => { animRunning = false; });

      return stream;
    };
  }

  // 3. Hook window.showSaveFilePicker to eliminate the Save As dialog
  window.showSaveFilePicker = async function(options) {
    console.log('[AutoMeet Inpage] showSaveFilePicker intercepted. Auto-saving without prompt:', options);
    const filename = options?.suggestedName || `AutoMeet_${Date.now()}.webm`;
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
          seek: async function(pos) {
            position = pos;
          },
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
              setTimeout(() => {
                a.remove();
                URL.revokeObjectURL(blobUrl);
              }, 60000);
              console.log('[AutoMeet Inpage] Tự động tải video Local Recording:', filename);
            } catch (e) {
              console.error('[AutoMeet Inpage] Lỗi khi lưu file:', e);
            }
          }
        };
      }
    };
  };

  // 4. Lắng nghe điều khiển từ Content Script (ISOLATED world)
  window.addEventListener('message', function(event) {
    if (!event.data || !event.data.type) return;

    if (event.data.type === 'AUTOMEET_DISPATCH_START_LOCAL_REC') {
      try {
        if (window.APP?.store?.dispatch) {
          console.log('[AutoMeet Inpage] Dispatching START_LOCAL_RECORDING to Jitsi Redux...');
          window.APP.store.dispatch({ type: 'START_LOCAL_RECORDING', onlySelf: false });
        }
      } catch (err) {
        console.warn('[AutoMeet Inpage] START_LOCAL_RECORDING error:', err);
      }
    } else if (event.data.type === 'AUTOMEET_DISPATCH_STOP_LOCAL_REC') {
      try {
        if (window.APP?.store?.dispatch) {
          console.log('[AutoMeet Inpage] Stopping Jitsi Local Recording in Redux...');
          window.APP.store.dispatch({ type: 'STOP_LOCAL_RECORDING' });
        }
      } catch (err) {
        console.warn('[AutoMeet Inpage] STOP_LOCAL_RECORDING error:', err);
      }
    }
  });

  // 5. Định kỳ theo dõi trạng thái Redux để thông báo cho Content Script
  setInterval(() => {
    try {
      const state = window.APP?.store?.getState();
      const isRunning = Boolean(state?.['features/recording']?.localRecordingRunning);
      window.postMessage({ type: 'AUTOMEET_SYNC_RECORDING_STATE', isRunning: isRunning }, '*');
    } catch (e) {}
  }, 1000);
})();
