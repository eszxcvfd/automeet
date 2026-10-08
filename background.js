/**
 * AutoMeet - Service Worker (Background)
 * Quản lý lịch trình (Chrome Alarms), điều phối tab Jitsi và gửi lệnh Bật/Tắt Record.
 */

// Nạp file utils.js trong môi trường Service Worker
try {
  importScripts('utils.js');
} catch (e) {
  console.error('[AutoMeet ServiceWorker] Không thể nạp utils.js:', e);
}

const utils = self.AutoMeetUtils;

// 1. Khi Extension được cài đặt hoặc cập nhật
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[AutoMeet] Extension installed / updated:', details.reason);

  // Đảm bảo cài đặt mặc định được lưu
  if (utils) {
    const existing = await utils.loadSettings();
    await utils.saveSettings(existing);
  }

  // Khởi tạo Alarm định kỳ kiểm tra mỗi phút
  setupPeriodicAlarms();

  // Hiển thị thông báo chào mừng
  if (chrome.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'AutoMeet đã sẵn sàng!',
      message: `Phòng hôm nay: ${utils ? utils.getRoomName() : 'Jitsi Meet'}. Đã thiết lập lịch tự động record.`
    });
  }
});

// 2. Khi trình duyệt khởi động
chrome.runtime.onStartup.addListener(() => {
  console.log('[AutoMeet] Browser startup - kiểm tra lại alarms');
  setupPeriodicAlarms();
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

  const now = new Date();
  const currentHours = now.getHours();
  const currentMins = now.getMinutes();
  const currentTimeStr = `${String(currentHours).padStart(2, '0')}:${String(currentMins).padStart(2, '0')}`;

  const settings = utils ? await utils.loadSettings() : null;
  if (!settings || !settings.schedules) return;

  for (const item of settings.schedules) {
    if (!item.enabled) continue;

    // Kiểm tra khớp giờ BẮT ĐẦU (ví dụ 07:30, 13:00, 22:00)
    if (item.start === currentTimeStr) {
      console.log(`[AutoMeet] ĐẾN GIỜ BẬT RECORD: ${item.name} (${item.start})`);
      await handleStartSchedule(item, now, settings);
    }

    // Kiểm tra khớp giờ KẾT THÚC (ví dụ 11:30, 17:00, 24:00/00:00)
    const isEndTime = item.end === currentTimeStr || (item.end === '24:00' && currentTimeStr === '00:00');
    if (isEndTime) {
      console.log(`[AutoMeet] ĐẾN GIỜ TẮT RECORD: ${item.name} (${item.end})`);
      await handleStopSchedule(item, now, settings);
    }
  }
});

/**
 * Xử lý khi đến giờ bắt đầu một ca ghi hình
 */
async function handleStartSchedule(scheduleItem, date, settings) {
  const roomName = utils.getRoomName(date);
  const meetingUrl = utils.getMeetingUrl(date);

  // 1. Tìm hoặc mở tab Jitsi của ngày hôm nay
  const tab = await findOrCreateMeetingTab(roomName, meetingUrl);

  // 2. Chờ tab tải xong rồi gửi lệnh START_RECORDING
  if (tab) {
    // Thông báo cho người dùng
    if (settings.notifyOnRecord && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: `AutoMeet: Bắt đầu ${scheduleItem.name}`,
        message: `Đang bật record phòng ${roomName} (${scheduleItem.start} - ${scheduleItem.end}).`
      });
    }

    // Gửi lệnh bật record
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'START_RECORDING' });
      } catch (err) {
        console.warn('[AutoMeet] Chưa thể gửi lệnh đến tab, tab có thể đang tải trang:', err);
      }
    }, 4000);
  }
}

/**
 * Xử lý khi đến giờ kết thúc ca ghi hình
 */
async function handleStopSchedule(scheduleItem, date, settings) {
  const roomName = utils.getRoomName(date);
  const tab = await findExistingMeetingTab(roomName);

  if (tab) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'STOP_RECORDING' });
    } catch (err) {
      console.warn('[AutoMeet] Không thể gửi lệnh stop recording:', err);
    }

    if (settings.notifyOnRecord && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: `AutoMeet: Kết thúc ${scheduleItem.name}`,
        message: `Đã dừng record phòng ${roomName}. Video đang được lưu vào Downloads!`
      });
    }
  }
}

/**
 * Tìm tab Jitsi Meet đang mở có chứa tên phòng hôm nay
 */
async function findExistingMeetingTab(roomName) {
  const tabs = await chrome.tabs.query({ url: '*://meet.jit.si/*' });
  for (const t of tabs) {
    if (t.url && t.url.includes(roomName)) {
      return t;
    }
  }
  return tabs.length > 0 ? tabs[0] : null;
}

/**
 * Tìm hoặc tạo mới tab Jitsi Meet cho phòng hôm nay
 */
async function findOrCreateMeetingTab(roomName, fullUrl) {
  const existingTab = await findExistingMeetingTab(roomName);

  if (existingTab) {
    // Focus vào tab này nếu cần
    await chrome.tabs.update(existingTab.id, { active: true });
    return existingTab;
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

    // Timeout dự phòng 10 giây
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(newTab);
    }, 10000);
  });
}

// 4. Lắng nghe thông điệp từ giao diện Popup / Options
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    const now = new Date();
    const todayRoom = utils ? utils.getRoomName(now) : '';
    const todayUrl = utils ? utils.getMeetingUrl(now) : '';

    if (request.action === 'OPEN_TODAY_ROOM') {
      const tab = await findOrCreateMeetingTab(todayRoom, todayUrl);
      sendResponse({ success: true, tabId: tab.id });
    } else if (request.action === 'TRIGGER_RECORD_NOW') {
      const tab = await findExistingMeetingTab(todayRoom);
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'START_RECORDING' }, (res) => {
          sendResponse({ success: true, detail: res });
        });
      } else {
        const newTab = await findOrCreateMeetingTab(todayRoom, todayUrl);
        setTimeout(() => {
          chrome.tabs.sendMessage(newTab.id, { action: 'START_RECORDING' }, (res) => {
            sendResponse({ success: true, detail: res });
          });
        }, 5000);
      }
    } else if (request.action === 'TRIGGER_STOP_NOW') {
      const tab = await findExistingMeetingTab(todayRoom);
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'STOP_RECORDING' }, (res) => {
          sendResponse({ success: true, detail: res });
        });
      } else {
        sendResponse({ success: false, message: 'Không tìm thấy tab Jitsi Meet đang mở' });
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
        settings: settings
      });
    }
  })();

  return true; // Giữ kết nối bất đồng bộ
});
