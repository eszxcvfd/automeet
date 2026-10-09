/**
 * AutoMeet - Popup Script
 * Hiển thị thông tin phòng hôm nay, lịch trình, nơi lưu trữ video và điều khiển.
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

  // Cập nhật thông tin nơi lưu trữ
  updateStorageDisplay(settings);

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
  const btnRecord = document.getElementById('btn-manual-record');
  const btnStop = document.getElementById('btn-manual-stop');

  btnRecord?.addEventListener('click', () => {
    btnRecord.textContent = '⏳ Đang kích hoạt...';
    btnRecord.disabled = true;

    chrome.runtime.sendMessage({ action: 'TRIGGER_RECORD_NOW' }, (res) => {
      setTimeout(() => {
        updateStatus(settings);
      }, 1000);
    });
  });

  // 7. Sự kiện Dừng & Lưu Record thủ công
  btnStop?.addEventListener('click', () => {
    btnStop.textContent = '⏳ Đang dừng & lưu...';
    btnStop.disabled = true;

    chrome.runtime.sendMessage({ action: 'TRIGGER_STOP_NOW' }, (res) => {
      setTimeout(() => {
        updateStatus(settings);
      }, 1000);
    });
  });

  // 8. Sự kiện Chọn thư mục lưu trữ video (Cấp quyền trước 1 lần)
  document.getElementById('btn-pick-folder')?.addEventListener('click', async () => {
    const hintEl = document.getElementById('popup-storage-hint');
    try {
      if (typeof window.showDirectoryPicker === 'function') {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        if (dirHandle) {
          // Lưu handle vào IndexedDB
          await utils.saveDirectoryHandle(dirHandle);

          // Lưu tên thư mục vào chrome.storage
          settings.saveLocationName = dirHandle.name;
          settings.saveSubfolder = dirHandle.name;
          await utils.saveSettings(settings);

          updateStorageDisplay(settings);
          notifyMeetingTabs();
          console.log('[AutoMeet Popup] Đã chọn thư mục lưu trữ:', dirHandle.name);
        }
      } else {
        const customName = prompt('Nhập tên thư mục con trong Downloads để lưu video:', settings.saveSubfolder || 'AutoMeet_Recordings');
        if (customName && customName.trim()) {
          settings.saveLocationName = customName.trim();
          settings.saveSubfolder = customName.trim();
          await utils.saveSettings(settings);
          updateStorageDisplay(settings);
          notifyMeetingTabs();
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[AutoMeet Popup] Lỗi chọn thư mục:', err);
        if (hintEl) {
          hintEl.textContent = '⚠️ Chưa thể truy cập thư mục: ' + err.message;
          hintEl.style.color = '#f87171';
        }
      }
    }
  });

  // 9. Mở trang Cài đặt (Options)
  document.getElementById('btn-open-options')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('link-options')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  /**
   * Cập nhật hiển thị thư mục lưu trữ
   */
  function updateStorageDisplay(curSettings) {
    const pathEl = document.getElementById('popup-storage-path');
    const hintEl = document.getElementById('popup-storage-hint');
    const footerEl = document.getElementById('popup-footer-text');

    const folderName = curSettings?.saveLocationName || curSettings?.saveSubfolder || 'Downloads/AutoMeet_Recordings';
    if (pathEl) {
      pathEl.textContent = `${folderName}`;
      pathEl.title = `Thư mục lưu trữ: ${folderName}`;
    }
    if (hintEl) {
      hintEl.textContent = `✓ Đã chọn nơi lưu: ${folderName}. Video tự động lưu về đây khi hết ca.`;
      hintEl.style.color = '#38bdf8';
    }
    if (footerEl) {
      footerEl.textContent = `Lưu tại: ${folderName}`;
    }
  }

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
   * Cập nhật trạng thái hiển thị trung thực 100%
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
        nextEventEl.textContent = 'Không có ca nào đang bật';
      }
    }

    // Truy vấn trạng thái thực tế từ background và tab Jitsi
    chrome.runtime.sendMessage({ action: 'GET_BACKGROUND_STATE' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        if (badgeLabel) badgeLabel.textContent = 'Chưa vào phòng';
        if (badgeDot) badgeDot.className = 'dot-idle';
        if (btnRecord) { btnRecord.disabled = false; btnRecord.textContent = '⏺ Bật Record'; }
        if (btnStop) { btnStop.disabled = true; btnStop.textContent = '⏹ Dừng & Lưu Video'; }
        return;
      }

      if (res.isRecording) {
        // TRẠNG THÁI: ĐANG THỰC SỰ GHI HÌNH
        let timerStr = '';
        if (typeof res.durationSec === 'number' && res.durationSec > 0) {
          const m = String(Math.floor(res.durationSec / 60)).padStart(2, '0');
          const s = String(res.durationSec % 60).padStart(2, '0');
          timerStr = ` [${m}:${s}]`;
        }
        if (badgeLabel) badgeLabel.textContent = `🔴 Đang Record${timerStr}`;
        if (badgeDot) badgeDot.className = 'dot-rec';

        if (btnRecord) {
          btnRecord.disabled = true;
          btnRecord.textContent = '⏺ Đang ghi hình...';
        }
        if (btnStop) {
          btnStop.disabled = false;
          btnStop.textContent = '⏹ Dừng & Lưu Video';
        }
      } else {
        // TRẠNG THÁI: CHƯA GHI HÌNH (SẴN SÀNG HOẶC CHỜ CA)
        if (res.hasMeetingTab) {
          if (slotInfo.inSlot && slotInfo.activeSchedule) {
            if (badgeLabel) badgeLabel.textContent = `🟢 Sẵn sàng (${slotInfo.activeSchedule.name})`;
            if (badgeDot) badgeDot.className = 'dot-ready';
          } else {
            if (badgeLabel) badgeLabel.textContent = '⚪ Chưa ghi hình (Chờ ca)';
            if (badgeDot) badgeDot.className = 'dot-idle';
          }
        } else {
          if (slotInfo.inSlot && slotInfo.activeSchedule) {
            if (badgeLabel) badgeLabel.textContent = `Trong ca (${slotInfo.activeSchedule.name})`;
            if (badgeDot) badgeDot.className = 'dot-idle';
          } else {
            if (badgeLabel) badgeLabel.textContent = '⚪ Chưa ghi hình';
            if (badgeDot) badgeDot.className = 'dot-idle';
          }
        }

        if (btnRecord) {
          btnRecord.disabled = false;
          btnRecord.textContent = '⏺ Bật Record';
        }
        if (btnStop) {
          btnStop.disabled = true;
          btnStop.textContent = '⏹ Dừng & Lưu (Chưa chạy)';
        }
      }
    });
  }
});
