/**
 * AutoMeet - In-page script running in MAIN world
 * Đồng bộ trạng thái ghi hình với Redux Store của Jitsi Meet (Hiển thị biểu tượng REC đỏ
 * chính thức và âm thanh thông báo của nền tảng).
 * Hoàn toàn không can thiệp hay giả lập canvas getDisplayMedia để tránh video đen.
 */
(function() {
  'use strict';

  if (window.__AUTOMEET_INPAGE_INITIALIZED__) {
    console.log('[AutoMeet Inpage] Script already initialized.');
    return;
  }
  window.__AUTOMEET_INPAGE_INITIALIZED__ = true;

  console.log('[AutoMeet Inpage] Initializing hooks in MAIN world...');

  let isRecordingActive = false;

  /**
   * Đồng bộ trạng thái ghi hình trực tiếp vào Jitsi Redux Store
   */
  function syncJitsiRecordingUi(running) {
    const store = window.APP?.store;
    if (!store) return;

    try {
      store.dispatch({
        type: 'SET_LOCAL_RECORDING_RUNNING',
        running: running
      });

      store.dispatch({
        type: 'PLAY_SOUND',
        soundId: running ? 'RECORDING_ON_SOUND' : 'RECORDING_OFF_SOUND'
      });
      console.log(`[AutoMeet Inpage] Đã đồng bộ Redux Jitsi: localRecordingRunning = ${running}`);
    } catch (e) {
      console.warn('[AutoMeet Inpage] Lỗi dispatch Redux Jitsi:', e);
    }
  }

  /**
   * Lắng nghe thông điệp điều khiển từ Content Script
   */
  window.addEventListener('message', function(event) {
    if (!event.data || !event.data.type) return;

    if (event.data.type === 'AUTOMEET_SET_RECORDING_UI_ACTIVE') {
      console.log('[AutoMeet Inpage] Kích hoạt biểu tượng REC của Jitsi...');
      isRecordingActive = true;
      syncJitsiRecordingUi(true);
    } else if (event.data.type === 'AUTOMEET_SET_RECORDING_UI_INACTIVE') {
      console.log('[AutoMeet Inpage] Tắt biểu tượng REC của Jitsi...');
      isRecordingActive = false;
      syncJitsiRecordingUi(false);
    }
  });

  /**
   * Định kỳ đảm bảo biểu tượng REC của Jitsi luôn duy trì khi đang trong ca
   * và báo cáo trạng thái thực tế về cho Content Script
   */
  setInterval(() => {
    try {
      const store = window.APP?.store;
      if (store) {
        const state = store.getState();
        const confJoined = Boolean(state?.['features/base/conference']?.conference);

        // Nếu đang trong trạng thái ghi hình nhưng Jitsi vừa load xong hoặc reset, kích hoạt lại REC badge
        if (isRecordingActive && confJoined) {
          const currentRunning = Boolean(state?.['features/recording']?.localRecordingRunning);
          if (!currentRunning) {
            store.dispatch({ type: 'SET_LOCAL_RECORDING_RUNNING', running: true });
          }
        }
      }

      window.postMessage({
        type: 'AUTOMEET_SYNC_RECORDING_STATE',
        isRunning: isRecordingActive
      }, '*');
    } catch (e) {}
  }, 1500);

  // Hook showSaveFilePicker an toàn nếu Jitsi có gọi lưu file
  if (typeof window.showSaveFilePicker !== 'undefined') {
    const origPicker = window.showSaveFilePicker.bind(window);
    window.showSaveFilePicker = async function(options) {
      try {
        return await origPicker(options);
      } catch (e) {
        console.log('[AutoMeet Inpage] showSaveFilePicker cancelled or bypassed');
        throw e;
      }
    };
  }

  console.log('[AutoMeet Inpage] Ready.');
})();
