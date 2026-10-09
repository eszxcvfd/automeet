/**
 * AutoMeet - Offscreen Tab Audio/Video Recorder
 * Ghi lại toàn bộ màn hình và âm thanh thực tế của tab cuộc họp mà không yêu cầu
 * người dùng bấm xác nhận hay cấp quyền (sử dụng quyền tabCapture của Extension).
 * File WebM được lưu trực tiếp vào thư mục Downloads.
 */

let mediaRecorder = null;
let recordedChunks = [];
let mediaStream = null;
let currentFilename = '';
let audioCtx = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_OFFSCREEN_RECORDING') {
    handleStartRecording(request.streamId, request.filename)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('[AutoMeet Offscreen] Lỗi khởi tạo record:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // async
  } else if (request.action === 'STOP_OFFSCREEN_RECORDING') {
    handleStopRecording()
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('[AutoMeet Offscreen] Lỗi dừng record:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // async
  } else if (request.action === 'GET_OFFSCREEN_STATUS') {
    sendResponse({
      alive: true,
      isRecording: mediaRecorder && mediaRecorder.state === 'recording',
      filename: currentFilename
    });
    return false;
  }
});

/**
 * Bắt đầu ghi hình tab bằng MediaStream thu được từ chrome.tabCapture
 */
async function handleStartRecording(streamId, filename) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.log('[AutoMeet Offscreen] Đang ghi hình rồi, không bắt đầu lại');
    return;
  }

  currentFilename = filename || `AutoMeet_${Date.now()}.webm`;
  recordedChunks = [];

  try {
    // Thu thập audio + video từ tab mà không mở bất kỳ hộp thoại nào
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    // Phát song song âm thanh ra loa để người dùng vẫn nghe thấy tiếng cuộc họp
    try {
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(mediaStream);
      source.connect(audioCtx.destination);
    } catch (e) {
      console.warn('[AutoMeet Offscreen] Không thể phát âm thanh ra loa:', e);
    }

    // Chọn định dạng MIME tối ưu (hỗ trợ cả video VP9/VP8 và audio Opus)
    const mimeType = getOptimalMimeType();
    console.log(`[AutoMeet Offscreen] Sử dụng MIME Type: ${mimeType}`);

    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType,
      videoBitsPerSecond: 2500000 // 2.5 Mbps cho video sắc nét
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      console.log(`[AutoMeet Offscreen] Đã hoàn tất ghi hình, tổng chunks: ${recordedChunks.length}`);
      const blob = new Blob(recordedChunks, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      // Gửi blob URL về background để lưu thẳng vào Downloads
      chrome.runtime.sendMessage({
        action: 'SAVE_RECORDING_BLOB',
        blobUrl: blobUrl,
        filename: currentFilename
      });

      // Giữ stream và blob trong 30s trước khi giải phóng
      setTimeout(() => {
        if (mediaStream) {
          mediaStream.getTracks().forEach((track) => track.stop());
          mediaStream = null;
        }
        if (audioCtx) {
          audioCtx.close().catch(() => {});
          audioCtx = null;
        }
      }, 30000);
    };

    // Bắt đầu ghi hình (lấy chunk mỗi 1000ms)
    mediaRecorder.start(1000);
    console.log('[AutoMeet Offscreen] Đã kích hoạt MediaRecorder thành công!');
  } catch (err) {
    console.error('[AutoMeet Offscreen] getUserMedia thất bại:', err);
    throw err;
  }
}

/**
 * Dừng ghi hình và lưu file
 */
async function handleStopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    console.log('[AutoMeet Offscreen] Đã gọi mediaRecorder.stop()');
  }
}

/**
 * Tìm định dạng video hỗ trợ tốt nhất
 */
function getOptimalMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return 'video/webm';
}
