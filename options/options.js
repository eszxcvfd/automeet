/**
 * AutoMeet - Options Script
 * Quản lý cấu hình chi tiết, danh sách lịch trình và thông báo lưu.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const utils = window.AutoMeetUtils;
  if (!utils) return;

  const settings = await utils.loadSettings();

  // 1. Điền giá trị cài đặt chung
  const inputDisplayName = document.getElementById('input-display-name');
  const chkEnableAutoRecord = document.getElementById('chk-enable-auto-record');
  const chkAutoJoin = document.getElementById('chk-auto-join');
  const chkAutoSlot = document.getElementById('chk-auto-slot');
  const chkNotify = document.getElementById('chk-notify');
  const chkSound = document.getElementById('chk-sound');
  const chkShowFloatingHud = document.getElementById('chk-show-floating-hud');

  if (inputDisplayName) inputDisplayName.value = settings.displayName || 'Staff Member';
  if (chkEnableAutoRecord) chkEnableAutoRecord.checked = !!settings.enableAutoRecord;
  if (chkAutoJoin) chkAutoJoin.checked = !!settings.autoJoinPrejoin;
  if (chkAutoSlot) chkAutoSlot.checked = !!settings.autoRecordIfInSlot;
  if (chkNotify) chkNotify.checked = !!settings.notifyOnRecord;
  if (chkSound) chkSound.checked = !!settings.soundAlert;
  if (chkShowFloatingHud) chkShowFloatingHud.checked = !!settings.showFloatingHud;

  const inputSaveFolder = document.getElementById('input-save-folder');
  const storageHint = document.getElementById('options-storage-hint');
  if (inputSaveFolder) {
    inputSaveFolder.value = settings.saveLocationName || settings.saveSubfolder || 'AutoMeet_Recordings';
  }

  // Nút Chọn thư mục lưu trữ trong Options
  document.getElementById('btn-options-pick-folder')?.addEventListener('click', async () => {
    try {
      if (typeof window.showDirectoryPicker === 'function') {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        if (dirHandle) {
          await utils.saveDirectoryHandle(dirHandle);
          const cleanName = utils && utils.sanitizeSubfolder ? utils.sanitizeSubfolder(dirHandle.name) : dirHandle.name;
          if (inputSaveFolder) inputSaveFolder.value = cleanName;
          settings.saveLocationName = dirHandle.name;
          settings.saveSubfolder = cleanName;
          await utils.saveSettings(settings);
          if (storageHint) {
            storageHint.textContent = `✓ Đã chọn và cấp quyền lưu vào thư mục: ${dirHandle.name}`;
            storageHint.style.color = '#4ade80';
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Lỗi chọn thư mục:', err);
      }
    }
  });

  // 2. Render danh sách lịch trình
  let schedules = JSON.parse(JSON.stringify(settings.schedules || []));
  renderTable(schedules);

  // 3. Nút Thêm khung giờ mới
  document.getElementById('btn-add-schedule')?.addEventListener('click', () => {
    schedules.push({
      id: 'custom_' + Date.now(),
      name: 'Ca mới',
      start: '08:00',
      end: '12:00',
      enabled: true
    });
    renderTable(schedules);
  });

  // 4. Nút Lưu cài đặt
  document.getElementById('btn-save')?.addEventListener('click', async () => {
    // Thu thập dữ liệu từ bảng lịch trình
    const rows = document.querySelectorAll('#schedules-tbody tr');
    const updatedSchedules = [];

    rows.forEach((tr) => {
      const id = tr.dataset.id;
      const name = tr.querySelector('.input-sched-name').value.trim();
      const start = tr.querySelector('.input-sched-start').value.trim();
      const end = tr.querySelector('.input-sched-end').value.trim();
      const enabled = tr.querySelector('.chk-sched-enabled').checked;

      if (name && start && end) {
        updatedSchedules.push({ id, name, start, end, enabled });
      }
    });

    const rawFolder = inputSaveFolder ? inputSaveFolder.value.trim() : 'AutoMeet_Recordings';
    const folderName = utils && utils.sanitizeSubfolder ? utils.sanitizeSubfolder(rawFolder) : (rawFolder || 'AutoMeet_Recordings');

    const newSettings = {
      displayName: inputDisplayName.value.trim() || 'Staff Member',
      enableAutoRecord: chkEnableAutoRecord.checked,
      autoJoinPrejoin: chkAutoJoin.checked,
      autoRecordIfInSlot: chkAutoSlot.checked,
      notifyOnRecord: chkNotify.checked,
      soundAlert: chkSound.checked,
      showFloatingHud: chkShowFloatingHud ? chkShowFloatingHud.checked : false,
      saveLocationName: folderName,
      saveSubfolder: folderName,
      schedules: updatedSchedules
    };

    await utils.saveSettings(newSettings);
    schedules = updatedSchedules;

    // Gửi thông báo đến các tab Jitsi đang mở để reload settings
    try {
      chrome.tabs.query({ url: '*://meet.jit.si/*' }, (tabs) => {
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'RELOAD_SETTINGS' }));
      });
    } catch (e) {
      // bỏ qua lỗi nếu không có tab
    }

    // Hiển thị trạng thái Lưu thành công
    const statusEl = document.getElementById('save-status');
    if (statusEl) {
      statusEl.classList.add('show');
      setTimeout(() => statusEl.classList.remove('show'), 2500);
    }
  });

  /**
   * Render bảng danh sách lịch trình
   */
  function renderTable(list) {
    const tbody = document.getElementById('schedules-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    list.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.dataset.id = item.id || ('sched_' + index);

      tr.innerHTML = `
        <td>
          <input type="text" class="input-sched-name" value="${escapeAttr(item.name)}">
        </td>
        <td>
          <input type="text" class="input-sched-start" value="${escapeAttr(item.start)}" placeholder="HH:mm" pattern="[0-2][0-9]:[0-5][0-9]">
        </td>
        <td>
          <input type="text" class="input-sched-end" value="${escapeAttr(item.end)}" placeholder="HH:mm" pattern="[0-2][0-9]:[0-5][0-9]">
        </td>
        <td style="text-align: center;">
          <input type="checkbox" class="chk-sched-enabled" ${item.enabled ? 'checked' : ''}>
        </td>
        <td style="text-align: center;">
          <button type="button" class="btn-delete" title="Xóa ca này">✕</button>
        </td>
      `;

      // Nút xóa
      tr.querySelector('.btn-delete').addEventListener('click', () => {
        schedules.splice(index, 1);
        renderTable(schedules);
      });

      tbody.appendChild(tr);
    });
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/"/g, '&quot;');
  }
});
