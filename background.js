/**
 * AutoMeet - Service Worker (Background)
 * Quản lý lịch trình tự động 100%, tự động mở phòng khi tới ca / khởi động trình duyệt,
 * điều phối lưu video vào thư mục Downloads mà không cần người dùng can thiệp.
 */

// Nạp file utils.js trong môi trường Service Worker
try {
  importScripts('utils.js');
} catch (e) {
  console.error('[AutoMeet Background] Không thể nạp utils.js:', e);
}

const utils = self.AutoMeetUtils;

let lastActiveSlotId = null;
let isScheduleActive = false;

// 1. Khi Extension được cài đặt hoặc cập nhật
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[AutoMeet Background] Extension installed / updated:', details.reason);

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

  // Nếu có tab meet.jit.si đang mở từ trước khi cập nhật, tự động tải lại tab để nạp Content Script mới
  chrome.tabs.query({ url: '*://meet.jit.si/*' }, (tabs) => {
    tabs?.forEach(t => {
      console.log(`[AutoMeet Background] Tự động làm mới tab Jitsi (ID: ${t.id}) sau khi cập nhật extension...`);
      try { chrome.tabs.reload(t.id); } catch (e) {}
    });
  });

  setupPeriodicAlarms();
  setTimeout(syncScheduleState, 2500);
});

// 2. Khi trình duyệt khởi động (onStartup)
chrome.runtime.onStartup.addListener(async () => {
  console.log('[AutoMeet Background] Trình duyệt vừa khởi động -> Kích hoạt kiểm tra lịch tự động...');
  setupPeriodicAlarms();
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
      console.log('[AutoMeet Background] Đã tạo alarm automeet_scheduler_check (chu kỳ 1 phút)');
    }
  });
}

// 3. Lắng nghe Alarm kích hoạt mỗi phút
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'automeet_scheduler_check') return;
  await syncScheduleState();
});

// Lắng nghe khi tab Jitsi được tải lại trang
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('meet.jit.si')) {
    setTimeout(syncScheduleState, 2000);
  }
});

/**
 * Gửi message an toàn đến tab:
 * - Luôn có callback để tránh "Uncaught (in promise) Error: Could not establish connection"
 * - Tự động tải lại tab nếu tab bị mất kết nối script (sau khi reload extension)
 */
function safeSendTabMessage(tabId, message, callback) {
  if (!tabId) {
    if (callback) callback(null);
    return;
  }
  try {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (err.message && err.message.includes('Receiving end does not exist')) {
          console.log(`[AutoMeet Background] Tab ${tabId} chưa nạp Content Script mới -> Tự động tải lại tab...`);
          try {
            chrome.tabs.reload(tabId);
          } catch (e) {}
        }
        if (callback) callback(null, err);
        return;
      }
      if (callback) callback(response, null);
    });
  } catch (e) {
    if (callback) callback(null, e);
  }
}

/**
 * Tự động kiểm tra thời gian và đồng bộ hóa trạng thái cuộc họp & ghi hình
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

    // 2. Kích hoạt thông báo hệ thống nếu đây là slot mới
    if (lastActiveSlotId !== activeSched.id) {
      lastActiveSlotId = activeSched.id;
      isScheduleActive = true;

      if (settings.notifyOnRecord && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-48.png',
          title: `AutoMeet: ${activeSched.name}`,
          message: `Đang trong ca trực (${activeSched.start} - ${activeSched.end}). Đang tự động kết nối và ghi hình phòng ${todayRoom}.`
        });
      }
    }

    // 3. Đảm bảo tab Jitsi nhận lệnh bắt đầu ghi hình
    if (tab && tab.id) {
      const delay = justCreated ? 4000 : 1200;
      setTimeout(() => {
        safeSendTabMessage(tab.id, {
          action: 'START_RECORDING',
          schedule: activeSched
        });
      }, delay);
    }
  } else {
    // Không nằm trong khung giờ ca nào
    if (isScheduleActive) {
      console.log('[AutoMeet Background] Đã hết ca lịch trình, tự động gửi lệnh dừng Record...');
      isScheduleActive = false;
      lastActiveSlotId = null;

      const jitsiTabs = await findMeetingTabs();
      for (const t of jitsiTabs) {
        safeSendTabMessage(t.id, { action: 'STOP_RECORDING' });
      }

      if (settings.notifyOnRecord && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-48.png',
          title: 'AutoMeet: Kết thúc ca trực',
          message: 'Đã hoàn thành ca và tự động lưu video vào thư mục Downloads!'
        });
      }
    }
  }
}

/**
 * Tìm hoặc mở tab cuộc họp hôm nay
 */
async function findOrCreateMeetingTab(roomName, targetUrl) {
  const existingTab = await findExistingMeetingTab(roomName);
  if (existingTab) return existingTab;

  return new Promise((resolve) => {
    chrome.tabs.create({ url: targetUrl, active: false }, (tab) => {
      resolve(tab);
    });
  });
}

/**
 * Tìm tab cuộc họp hôm nay đang mở
 */
function findExistingMeetingTab(roomName) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: '*://meet.jit.si/*' }, (tabs) => {
      if (!tabs || tabs.length === 0) return resolve(null);
      const match = tabs.find(t => t.url && t.url.toLowerCase().includes(roomName.toLowerCase()));
      resolve(match || tabs[0] || null);
    });
  });
}

/**
 * Tìm tất cả các tab Jitsi Meet đang mở
 */
function findMeetingTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: '*://meet.jit.si/*' }, (tabs) => {
      resolve(tabs || []);
    });
  });
}

/**
 * Lắng nghe thông điệp từ Content Script hoặc Popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[AutoMeet Background] Nhận action:', request.action);

  if (request.action === 'DOWNLOAD_RECORDING') {
    (async () => {
      const settings = utils ? await utils.loadSettings() : null;
      const subfolder = settings?.saveSubfolder || 'AutoMeet_Recordings';
      const cleanFilename = request.filename || 'recording.webm';
      const targetPath = `${subfolder}/${cleanFilename}`;

      // Tự động lưu video vào thư mục người dùng đã chọn trước đó (KHÔNG POPUP HỎI NƠI LƯU)
      if (chrome.downloads && request.url) {
        chrome.downloads.download({
          url: request.url,
          filename: targetPath,
          saveAs: false,
          conflictAction: 'uniquify'
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.warn('[AutoMeet Background] Lỗi chrome.downloads với đường dẫn con, thử tải mặc định:', chrome.runtime.lastError);
            chrome.downloads.download({
              url: request.url,
              filename: cleanFilename,
              saveAs: false
            });
          } else {
            console.log('[AutoMeet Background] Đã tự động lưu video vào thư mục:', targetPath, 'ID:', downloadId);
          }
        });
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  if (request.action === 'OPEN_TODAY_ROOM') {
    const todayUrl = utils ? utils.getMeetingUrl() : 'https://meet.jit.si/';
    chrome.tabs.create({ url: todayUrl, active: true }, (tab) => {
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }

  if (request.action === 'TRIGGER_RECORD_NOW') {
    (async () => {
      const todayRoom = utils ? utils.getRoomName() : 'Staff';
      const todayUrl = utils ? utils.getMeetingUrl() : 'https://meet.jit.si/';
      let tab = await findExistingMeetingTab(todayRoom);
      let isNew = false;
      if (!tab) {
        tab = await findOrCreateMeetingTab(todayRoom, todayUrl);
        isNew = true;
      }
      const delay = isNew ? 3500 : 200;
      setTimeout(() => {
        if (tab && tab.id) {
          safeSendTabMessage(tab.id, { action: 'START_RECORDING' }, (res) => {
            sendResponse(res || { success: true });
          });
        } else {
          sendResponse({ success: false, error: 'Không tìm thấy tab Jitsi' });
        }
      }, delay);
    })();
    return true;
  }

  if (request.action === 'TRIGGER_STOP_NOW') {
    (async () => {
      const tabs = await findMeetingTabs();
      let stopped = false;
      for (const t of tabs) {
        safeSendTabMessage(t.id, { action: 'STOP_RECORDING' }, (res) => {
          if (res?.success) stopped = true;
        });
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  if (request.action === 'GET_BACKGROUND_STATE') {
    (async () => {
      const todayRoom = utils ? utils.getRoomName() : '';
      const tab = await findExistingMeetingTab(todayRoom);
      if (tab && tab.id) {
        safeSendTabMessage(tab.id, { action: 'GET_STATUS' }, (res, err) => {
          if (!err && res) {
            sendResponse({
              hasMeetingTab: true,
              isRecording: Boolean(res.isRecording),
              durationSec: res.durationSec || 0,
              roomName: res.roomName || todayRoom
            });
          } else {
            sendResponse({
              hasMeetingTab: true,
              isRecording: false,
              roomName: todayRoom
            });
          }
        });
      } else {
        sendResponse({
          hasMeetingTab: false,
          isRecording: false,
          roomName: todayRoom
        });
      }
    })();
    return true;
  }

  return true;
});
