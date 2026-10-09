/**
 * AutoMeet - Popup Script
 * Hiển thị thông tin phòng hôm nay, lịch trình và các nút điều khiển nhanh.
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

      // Nếu bật master mà chưa có ca nào bật, tự động bật cả 3 ca mặc định
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

  // 3. Cập nhật trạng thái từ background
  updateStatus(settings);

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

  // 6. Sự kiện Bật Record thủ công (Ưu tiên gửi trực tiếp vào tab Jitsi để kích hoạt Local Recording)
  document.getElementById('btn-manual-record')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-manual-record');
    btn.textContent = '⏳ Đang bật...';
    
    chrome.tabs.query({ url: '*://meet.jit.si/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'START_RECORDING' }, () => {
          setTimeout(() => {
            btn.textContent = '⏺ Bật Record';
            updateStatus(settings);
          }, 1500);
        });
      } else {
        chrome.runtime.sendMessage({ action: 'TRIGGER_RECORD_NOW' }, () => {
          setTimeout(() => {
            btn.textContent = '⏺ Bật Record';
            updateStatus(settings);
          }, 2000);
        });
      }
    });
  });

  // 7. Sự kiện Dừng Record thủ công (Gửi lệnh dừng Jitsi Local Recording)
  document.getElementById('btn-manual-stop')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-manual-stop');
    btn.textContent = '⏳ Đang dừng...';
    
    chrome.tabs.query({ url: '*://meet.jit.si/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'STOP_RECORDING' }, () => {
          setTimeout(() => {
            btn.textContent = '⏹ Dừng Record';
            updateStatus(settings);
          }, 1500);
        });
      } else {
        chrome.runtime.sendMessage({ action: 'TRIGGER_STOP_NOW' }, () => {
          setTimeout(() => {
            btn.textContent = '⏹ Dừng Record';
            updateStatus(settings);
          }, 1500);
        });
      }
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
        tabs?.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'RELOAD_SETTINGS' }));
      });
    } catch (e) {
      // bỏ qua lỗi
    }
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

        // Nếu bật ít nhất 1 ca thì tự động kích hoạt master switch
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
   * Cập nhật trạng thái mốc thời gian tiếp theo
   */
  function updateStatus(curSettings) {
    const nextEventEl = document.getElementById('popup-next-event');
    const badgeLabel = document.getElementById('popup-badge-label');
    const badgeDot = document.querySelector('#popup-active-badge span:first-child');

    const slotInfo = utils.checkCurrentSlot(curSettings?.schedules);
    const nextEvt = utils.getNextEvent(curSettings?.schedules);

    if (!curSettings?.enableAutoRecord) {
      if (badgeLabel) badgeLabel.textContent = 'Thủ công';
      if (badgeDot) badgeDot.className = 'dot-idle';
      if (nextEventEl) nextEventEl.textContent = 'Tự động Record: ĐÃ TẮT (Chỉ Record khi bấm nút)';
    } else if (slotInfo.inSlot) {
      if (badgeLabel) badgeLabel.textContent = `Trong ca (${slotInfo.activeSchedule.name})`;
      if (badgeDot) badgeDot.className = 'dot-idle';
    } else {
      if (badgeLabel) badgeLabel.textContent = 'Chờ ca';
      if (badgeDot) badgeDot.className = 'dot-idle';
    }

    if (nextEventEl && curSettings?.enableAutoRecord) {
      if (nextEvt) {
        const action = nextEvt.type === 'start' ? 'Bật' : 'Tắt';
        const hours = Math.floor(nextEvt.minutesLeft / 60);
        const mins = nextEvt.minutesLeft % 60;
        const remainingStr = hours > 0 ? `${hours}h ${mins}p` : `${mins} phút`;
        nextEventEl.textContent = `${action} lúc ${nextEvt.timeStr} (sau ${remainingStr})`;
      } else {
        nextEventEl.textContent = 'Không có lịch trình nào đang bật';
      }
    }

    // Truy vấn trạng thái thực tế từ tab Jitsi Meet: Chỉ hiển thị chấm đỏ REC khi Jitsi đang thực sự ghi hình
    chrome.tabs.query({ url: '*://meet.jit.si/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'GET_STATUS' }, (res) => {
          if (res && res.isRecording) {
            if (badgeLabel) badgeLabel.textContent = '🔴 Đang Record (Jitsi Local)';
            if (badgeDot) badgeDot.className = 'dot-rec';
          }
        });
      }
    });
  }
});
