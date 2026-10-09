/**
 * AutoMeet - Popup Script
 * Hiển thị thông tin phòng hôm nay, lịch trình và các nút điều khiển nhanh.
 * Luôn đồng bộ trạng thái thực tế từ tab Jitsi Meet (Local Recording).
 */

document.addEventListener('DOMContentLoaded', async () => {
  const utils = window.AutoMeetUtils;
  if (!utils) return;

  const now = new Date();
  const roomName = utils.getRoomName(now);
  const weekNum = utils.getISOWeekNumber(now);
  const dayNum = utils.getDayNumber(now);
  const year = now.getFullYear();

  // 1. Hiển thị thông tin phòng
  const roomNameEl = document.getElementById('popup-room-name');
  const roomDetailsEl = document.getElementById('popup-room-details');
  if (roomNameEl) roomNameEl.textContent = roomName;

  const dayNames = {
    2: 'Thứ 2',
    3: 'Thứ 3',
    4: 'Thứ 4',
    5: 'Thứ 5',
    6: 'Thứ 6',
    7: 'Thứ 7',
    8: 'Chủ nhật'
  };
  if (roomDetailsEl) {
    roomDetailsEl.textContent = `Hôm nay: Ngày ${now.getDate()}/${now.getMonth() + 1}/${year} (${dayNames[dayNum] || ''}) • Tuần ${weekNum} trong năm`;
  }

  // 2. Tải và hiển thị danh sách lịch trình
  let settings = await utils.loadSettings();

  // Khởi tạo công tắc tổng Tự động Record
  const masterSwitch = document.getElementById('chk-master-auto-record');
  if (masterSwitch) {
    masterSwitch.checked = !!settings.enableAutoRecord;
    masterSwitch.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      settings.enableAutoRecord = enabled;
      settings.autoRecordIfInSlot = enabled;

      if (enabled && !settings.schedules?.some(s => s.enabled)) {
        settings.schedules?.forEach(s => { s.enabled = true; });
      }

      await utils.saveSettings(settings);
      renderSchedules(settings.schedules);
      updateStatus(settings);
      notifyMeetingTabs();
    });
  }

  renderSchedules(settings.schedules);

  // 3. Cập nhật trạng thái định kỳ mỗi giây khi mở popup
  updateStatus(settings);
  const statusInterval = setInterval(() => {
    updateStatus(settings);
  }, 1000);

  window.addEventListener('unload', () => {
    clearInterval(statusInterval);
  });

  // 4. Sự kiện Sao chép tên phòng
  document.getElementById('btn-copy-room')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomName);
      const btn = document.getElementById('btn-copy-room');
      const old = btn.textContent;
      btn.textContent = '✓ Đã chép';
      btn.style.color = '#38bdf8';
      setTimeout(() => {
        btn.textContent = old;
        btn.style.color = '';
      }, 1500);
    } catch (e) {
      console.error('Copy failed', e);
    }
  });

  // 5. Sự kiện Vào phòng họp ngay
  document.getElementById('btn-join-meet')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_TODAY_ROOM' }, () => {
      window.close();
    });
  });

  // 6. Sự kiện Bật Record thủ công
  document.getElementById('btn-manual-record')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-manual-record');
    btn.textContent = '⏳ Đang bật...';
    btn.disabled = true;

    chrome.runtime.sendMessage({ action: 'TRIGGER_RECORD_NOW' }, (res) => {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '⏺ Bật Record';
        updateStatus(settings);
      }, 1200);
    });
  });

  // 7. Sự kiện Dừng & Lưu Record thủ công
  document.getElementById('btn-manual-stop')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-manual-stop');
    btn.textContent = '⏳ Đang lưu...';
    btn.disabled = true;

    chrome.runtime.sendMessage({ action: 'TRIGGER_STOP_NOW' }, (res) => {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '⏹ Dừng & Lưu Video';
        updateStatus(settings);
      }, 1000);
    });
  });

  // 8. Mở trang Cài đặt (Options)
  document.getElementById('btn-open-options')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('link-options')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  /**
   * Đồng bộ cài đặt mới đến các tab Jitsi đang mở
   */
  function notifyMeetingTabs() {
    try {
      chrome.tabs.query({ url: '*://meet.jit.si/*' }, (tabs) => {
        tabs?.forEach(t => {
          chrome.tabs.sendMessage(t.id, { action: 'RELOAD_SETTINGS' }, () => {
            const err = chrome.runtime.lastError;
          });
        });
      });
    } catch (e) {}
  }

  /**
   * Render danh sách các ca lịch trình
   */
  function renderSchedules(schedules) {
    const container = document.getElementById('schedule-list');
    if (!container) return;
    container.innerHTML = '';

    (schedules || []).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'schedule-item';
      row.innerHTML = `
        <div class="schedule-info">
          <span class="schedule-name">${item.name}</span>
          <span class="schedule-time">${item.start} - ${item.end}</span>
        </div>
        <label class="switch">
          <input type="checkbox" data-index="${index}" ${item.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      `;
      container.appendChild(row);
    });

    // Bắt sự kiện bật tắt từng ca
    container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', async (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        settings.schedules[idx].enabled = e.target.checked;

        const hasAnyEnabled = settings.schedules.some(s => s.enabled);
        if (hasAnyEnabled && !settings.enableAutoRecord) {
          settings.enableAutoRecord = true;
          settings.autoRecordIfInSlot = true;
          if (masterSwitch) masterSwitch.checked = true;
        } else if (!hasAnyEnabled) {
          settings.enableAutoRecord = false;
          if (masterSwitch) masterSwitch.checked = false;
        }

        await utils.saveSettings(settings);
        updateStatus(settings);
        notifyMeetingTabs();
      });
    });
  }

  /**
   * Cập nhật trạng thái hiển thị
   */
  function updateStatus(curSettings) {
    const nextEventEl = document.getElementById('popup-next-event');
    const badgeLabel = document.getElementById('popup-badge-label');
    const badgeDot = document.getElementById('popup-status-dot');

    const slotInfo = utils.checkCurrentSlot(curSettings?.schedules);
    const nextEvt = utils.getNextEvent(curSettings?.schedules);

    // Tính mốc tiếp theo
    if (nextEventEl) {
      if (!curSettings?.enableAutoRecord) {
        nextEventEl.textContent = 'Tự động Record: ĐÃ TẮT';
      } else if (nextEvt) {
        const action = nextEvt.type === 'start' ? 'Bật' : 'Tắt';
        const hours = Math.floor(nextEvt.minutesLeft / 60);
        const mins = nextEvt.minutesLeft % 60;
        const remainingStr = hours > 0 ? `${hours}h ${mins}p` : `${mins} phút`;
        nextEventEl.textContent = `${action} lúc ${nextEvt.timeStr} (sau ${remainingStr})`;
      } else {
        nextEventEl.textContent = 'Không có lịch trình nào đang bật';
      }
    }

    // Truy vấn trạng thái thực tế từ background và tab Jitsi
    chrome.runtime.sendMessage({ action: 'GET_BACKGROUND_STATE' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        if (badgeLabel) badgeLabel.textContent = 'Chưa vào phòng';
        if (badgeDot) badgeDot.className = 'dot-idle';
        return;
      }

      if (res.isRecording) {
        let timerStr = '';
        if (typeof res.durationSec === 'number' && res.durationSec > 0) {
          const m = String(Math.floor(res.durationSec / 60)).padStart(2, '0');
          const s = String(res.durationSec % 60).padStart(2, '0');
          timerStr = ` [${m}:${s}]`;
        }
        if (badgeLabel) badgeLabel.textContent = `🔴 Đang Record${timerStr}`;
        if (badgeDot) badgeDot.className = 'dot-rec';
      } else if (res.hasMeetingTab) {
        if (slotInfo.inSlot && slotInfo.activeSchedule) {
          if (badgeLabel) badgeLabel.textContent = `🟢 Sẵn sàng (${slotInfo.activeSchedule.name})`;
          if (badgeDot) badgeDot.className = 'dot-ready';
        } else {
          if (badgeLabel) badgeLabel.textContent = 'Đã kết nối phòng (Chờ ca)';
          if (badgeDot) badgeDot.className = 'dot-idle';
        }
      } else {
        if (slotInfo.inSlot && slotInfo.activeSchedule) {
          if (badgeLabel) badgeLabel.textContent = `Trong ca (${slotInfo.activeSchedule.name})`;
          if (badgeDot) badgeDot.className = 'dot-idle';
        } else {
          if (badgeLabel) badgeLabel.textContent = 'Chờ ca trực';
          if (badgeDot) badgeDot.className = 'dot-idle';
        }
      }
    });
  }
});
