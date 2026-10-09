/**
 * AutoMeet - Service Worker (Background)
 * Quản lý lịch trình tự động 100%, tự động mở phòng khi mở trình duyệt,
 * điều phối Tab Capture ngầm và tự động lưu video mà không cần người dùng can thiệp.
 */

// Nạp file utils.js trong môi trường Service Worker
try {
  importScripts('utils.js');
} catch (e) {
  console.error('[AutoMeet ServiceWorker] Không thể nạp utils.js:', e);
}

const utils = self.AutoMeetUtils;

let lastActiveSlotId = null;
let isScheduleActive = false;
let isCapturingTab = false;

// 1. Khi Extension được cài đặt hoặc cập nhật
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[AutoMeet] Extension installed / updated:', details.reason);

  // Đảm bảo cấu hình tự động ghi hình được kích hoạt
  if (utils) {
    let settings = await utils.loadSettings();
    const hasAnyActive = settings.schedules?.some(s => s.enabled);
    if (!settings.enableAutoRecord || !hasAnyActive) {
      settings.enableAutoRecord = true;
      settings.autoRecordIfInSlot = true;
      if (settings.schedules) {
        settings.schedules.forEach(s => { s.enabled = true; });
      }
    }
    await utils.saveSettings(settings);
  }

  // Khởi tạo Alarm định kỳ kiểm tra mỗi phút
  setupPeriodicAlarms();

  // Kiểm tra lịch ngay lập tức
  setTimeout(syncScheduleState, 2000);
});

// 2. Khi trình duyệt khởi động (onStartup)
chrome.runtime.onStartup.addListener(async () => {
  console.log('[AutoMeet] Trình duyệt vừa khởi động -> Kích hoạt kiểm tra lịch tự động...');
  setupPeriodicAlarms();

  // Kiểm tra ngay khi mở trình duyệt
  setTimeout(syncScheduleState, 3000);
});

/**
 * Thiết lập Chrome Alarm chạy định kỳ mỗi phút một lần
 */
function setupPeriodicAlarms() {
  chrome.alarms.get('automeet_scheduler_check', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('automeet_scheduler_check', {
        delayInMinutes: 0.1,
        periodInMinutes: 1.0
      });
      console.log('[AutoMeet] Đã tạo alarm automeet_scheduler_check (chu kỳ 1 phút)');
    }
  });
}

// 3. Lắng nghe Alarm kích hoạt mỗi phút
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'automeet_scheduler_check') return;
  await syncScheduleState();
});

// Lắng nghe khi tab Jitsi được mở hoặc tải lại trang
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('meet.jit.si')) {
    // Đợi 3 giây rồi kiểm tra đồng bộ lịch
    setTimeout(syncScheduleState, 3000);
  }
});

/**
 * Trọng tâm tự động hóa: Kiểm tra thời gian và đồng bộ hóa trạng thái cuộc họp & ghi hình
 */
async function syncScheduleState() {
  const settings = utils ? await utils.loadSettings() : null;
  if (!settings || !settings.enableAutoRecord || !settings.schedules) return;

  const now = new Date();
  const todayRoom = utils.getRoomName(now);
  const todayUrl = utils.getMeetingUrl(now);
  const slotInfo = utils.checkCurrentSlot(settings.schedules, now);

  if (slotInfo.inSlot && slotInfo.activeSchedule) {
    const activeSched = slotInfo.activeSchedule;
    console.log(`[AutoMeet Background] Hiện đang trong ${activeSched.name} (${activeSched.start} - ${activeSched.end})`);

    // 1. Tự động tìm hoặc mở tab cuộc họp hôm nay
    let tab = await findExistingMeetingTab(todayRoom);
    let justCreated = false;
    if (!tab) {
      console.log(`[AutoMeet Background] Tự động mở tab phòng họp hôm nay: ${todayRoom}`);
      tab = await findOrCreateMeetingTab(todayRoom, todayUrl);
      justCreated = true;
    }

    // 2. Kích hoạt Record tự động cho ca này
    if (lastActiveSlotId !== activeSched.id || !isScheduleActive) {
      lastActiveSlotId = activeSched.id;
      isScheduleActive = true;

      if (settings.notifyOnRecord && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-48.png',
          title: `AutoMeet: ${activeSched.name}`,
          message: `Đang tự động mở cuộc họp ${todayRoom} và kích hoạt Record (${activeSched.start} - ${activeSched.end}).`
        });
      }

      // Kích hoạt ghi hình ngầm bằng TabCapture Offscreen
      if (tab) {
        const delay = justCreated ? 6000 : 2500;
        setTimeout(async () => {
          await startTabCaptureRecording(tab, activeSched, todayRoom);

          // Đồng thời gửi lệnh kích hoạt giao diện Jitsi nếu cần
          try {
            await chrome.tabs.sendMessage(tab.id, {
              action: 'START_RECORDING',
              schedule: activeSched
            });
          } catch (e) {
            // bỏ qua nếu tab chưa load xong script
          }
        }, delay);
      }
    }
  } else {
    // Không nằm trong khung giờ ca nào
    if (isScheduleActive) {
      console.log('[AutoMeet Background] Đã hết ca lịch trình, tự động dừng Record...');
      isScheduleActive = false;
      lastActiveSlotId = null;

      // 1. Dừng ghi hình ngầm Offscreen
      await stopTabCaptureRecording();

      // 2. Gửi lệnh dừng giao diện Jitsi
      const tab = await findExistingMeetingTab(todayRoom);
      if (tab) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'STOP_RECORDING' });
        } catch (err) {
          // ignore
        }
      }

      if (settings.notifyOnRecord && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-48.png',
          title: 'AutoMeet: Kết thúc ca trực',
          message: 'Đã tự động kết thúc ca và lưu video vào thư mục Downloads/AutoMeet!'
        });
      }
    }
  }
}

/**
 * Đảm bảo Offscreen Document đã tồn tại
 */
async function ensureOffscreenDocument() {
  if (chrome.offscreen) {
    const existing = await chrome.offscreen.hasDocument();
    if (!existing) {
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Automated background tab audio and video recording for scheduled meeting'
      });
      console.log('[AutoMeet Background] Đã tạo Offscreen Document thành công');
      await new Promise(r => setTimeout(r, 600));
    }
  }
}

/**
 * Loại bỏ dấu tiếng Việt để tạo tên file an toàn cho mọi hệ điều hành
 */
function removeVietnameseTones(str) {
  if (!str) return 'Ca';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Bắt đầu ghi hình ngầm bằng TabCapture (Hoàn toàn tự động không cần người dùng xác nhận)
 */
async function startTabCaptureRecording(tab, scheduleItem, roomName) {
  if (isCapturingTab) return;

  try {
    await ensureOffscreenDocument();

    if (chrome.tabCapture && chrome.tabCapture.getMediaStreamId) {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      if (streamId) {
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const safeSched = removeVietnameseTones(scheduleItem?.name || 'Ca');
        const filename = `${roomName}_${safeSched}_${dateStr}.webm`;

        chrome.runtime.sendMessage({
          action: 'START_OFFSCREEN_RECORDING',
          streamId: streamId,
          filename: filename
        });

        isCapturingTab = true;
        console.log(`[AutoMeet Background] Đã kích hoạt TabCapture cho tab ${tab.id}, lưu thành file: ${filename}`);
      }
    }
  } catch (err) {
    console.warn('[AutoMeet Background] Lỗi khởi tạo TabCapture:', err);
  }
}

/**
 * Dừng ghi hình ngầm TabCapture
 */
async function stopTabCaptureRecording() {
  if (!isCapturingTab) return;
  isCapturingTab = false;

  try {
    chrome.runtime.sendMessage({ action: 'STOP_OFFSCREEN_RECORDING' });
    console.log('[AutoMeet Background] Đã gửi lệnh STOP_OFFSCREEN_RECORDING');
  } catch (err) {
    console.warn('[AutoMeet Background] Lỗi dừng TabCapture:', err);
  }
}

/**
 * Tìm tab Jitsi Meet đang mở có chứa tên phòng hôm nay
 */
async function findExistingMeetingTab(roomName) {
  const tabs = await chrome.tabs.query({ url: '*://meet.jit.si/*' });
  const lowerRoom = (roomName || '').toLowerCase();
  for (const t of tabs) {
    if (t.url && t.url.toLowerCase().includes(lowerRoom)) {
      return t;
    }
  }
  return null;
}

/**
 * Tìm hoặc tạo mới tab Jitsi Meet cho phòng hôm nay
 */
async function findOrCreateMeetingTab(roomName, fullUrl) {
  const existingTab = await findExistingMeetingTab(roomName);

  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { active: true });
    return existingTab;
  }

  // Nếu có tab meet.jit.si đang ở trang chủ, chuyển hướng tab đó đến phòng hôm nay
  const allJitsiTabs = await chrome.tabs.query({ url: '*://meet.jit.si/*' });
  for (const t of allJitsiTabs) {
    try {
      const u = new URL(t.url);
      const path = u.pathname.replace(/^\/+|\/+$/g, '');
      if (!path) {
        const updated = await chrome.tabs.update(t.id, { url: fullUrl, active: true });
        return updated;
      }
    } catch (e) {}
  }

  // Nếu chưa có, mở tab mới
  const newTab = await chrome.tabs.create({ url: fullUrl, active: true });

  // Đợi tab hoàn tất load
  return new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === newTab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(newTab);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(newTab);
    }, 10000);
  });
}

// 4. Lắng nghe thông điệp từ Content Script, Popup và Offscreen
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    const now = new Date();
    const todayRoom = utils ? utils.getRoomName(now) : '';
    const todayUrl = utils ? utils.getMeetingUrl(now) : '';

    if (request.action === 'SAVE_RECORDING_BLOB') {
      // TỰ ĐỘNG TẢI FILE VỀ THƯ MỤC DOWNLOADS MÀ KHÔNG HỎI NGƯỜI DÙNG (saveAs: false)
      if (chrome.downloads && request.blobUrl) {
        console.log('[AutoMeet Background] Đang tự động lưu file video:', request.filename);
        chrome.downloads.download({
          url: request.blobUrl,
          filename: `AutoMeet/${request.filename}`,
          saveAs: false
        }, (downloadId) => {
          console.log('[AutoMeet Background] File đã được tải xuống, downloadId:', downloadId);
          if (chrome.notifications) {
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon-48.png',
              title: 'AutoMeet: Đã lưu video cuộc họp',
              message: `Video ${request.filename} đã được tự động lưu vào thư mục Downloads/AutoMeet!`
            });
          }
        });
      }
      sendResponse({ success: true });
    } else if (request.action === 'OPEN_TODAY_ROOM') {
      const tab = await findOrCreateMeetingTab(todayRoom, todayUrl);
      sendResponse({ success: true, tabId: tab.id });
    } else if (request.action === 'START_TAB_CAPTURE') {
      const tab = sender.tab || await findExistingMeetingTab(todayRoom);
      const settings = utils ? await utils.loadSettings() : null;
      const slot = utils ? utils.checkCurrentSlot(settings?.schedules, now) : null;
      if (tab) {
        await startTabCaptureRecording(tab, slot?.activeSchedule, todayRoom);
      }
      sendResponse({ success: true });
    } else if (request.action === 'STOP_TAB_CAPTURE') {
      await stopTabCaptureRecording();
      sendResponse({ success: true });
    } else if (request.action === 'TRIGGER_RECORD_NOW') {
      const tab = await findOrCreateMeetingTab(todayRoom, todayUrl);
      const settings = utils ? await utils.loadSettings() : null;
      const slot = utils ? utils.checkCurrentSlot(settings?.schedules, now) : null;
      await startTabCaptureRecording(tab, slot?.activeSchedule, todayRoom);

      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'START_RECORDING' }, (res) => {
          sendResponse({ success: true, detail: res });
        });
      }, 2000);
    } else if (request.action === 'TRIGGER_STOP_NOW') {
      await stopTabCaptureRecording();
      const tab = await findExistingMeetingTab(todayRoom);
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'STOP_RECORDING' }, (res) => {
          sendResponse({ success: true, detail: res });
        });
      } else {
        sendResponse({ success: true });
      }
    } else if (request.action === 'GET_BACKGROUND_STATE') {
      const settings = utils ? await utils.loadSettings() : null;
      const slot = utils ? utils.checkCurrentSlot(settings?.schedules, now) : null;
      const next = utils ? utils.getNextEvent(settings?.schedules, now) : null;
      const activeTab = await findExistingMeetingTab(todayRoom);

      sendResponse({
        roomName: todayRoom,
        meetingUrl: todayUrl,
        inSlot: slot?.inSlot,
        activeSchedule: slot?.activeSchedule,
        nextEvent: next,
        hasOpenTab: !!activeTab,
        isScheduleActive: isScheduleActive || isCapturingTab,
        settings: settings
      });
    }
  })();

  return true; // Giữ kênh async
});
