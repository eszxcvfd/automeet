/**
 * AutoMeet - In-page script running in MAIN world
 * Wraps window.showSaveFilePicker to prevent unhandled rejections/crashes
 * and provides seamless direct dispatching to Jitsi's Redux store.
 */
(function() {
  'use strict';

  // 1. Hook window.showSaveFilePicker
  const originalPicker = window.showSaveFilePicker;
  window.showSaveFilePicker = async function(options) {
    try {
      if (originalPicker) {
        return await originalPicker.call(window, options);
      }
    } catch (err) {
      console.warn('[AutoMeet Inpage] Native showSaveFilePicker failed or aborted, using automated writer fallback:', err);
    }

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
              window.postMessage({ action: 'AUTOMEET_LOCAL_REC_SAVED', filename: filename }, '*');
            } catch (e) {
              console.error('[AutoMeet Inpage] Lỗi khi lưu file:', e);
            }
          }
        };
      }
    };
  };

  // 2. Lắng nghe điều khiển từ Content Script (ISOLATED world)
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
          console.log('[AutoMeet Inpage] Dispatching STOP_LOCAL_RECORDING to Jitsi Redux...');
          window.APP.store.dispatch({ type: 'STOP_LOCAL_RECORDING' });
        }
      } catch (err) {
        console.warn('[AutoMeet Inpage] STOP_LOCAL_RECORDING error:', err);
      }
    }
  });

  // 3. Định kỳ theo dõi trạng thái Redux để thông báo cho Content Script
  setInterval(() => {
    try {
      const state = window.APP?.store?.getState();
      const isRunning = Boolean(state?.['features/recording']?.localRecordingRunning);
      window.postMessage({ type: 'AUTOMEET_SYNC_RECORDING_STATE', isRunning: isRunning }, '*');
    } catch (e) {}
  }, 1000);
})();
