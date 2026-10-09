/**
 * AutoMeet - Shared Utility Functions
 * Used across Background Service Worker, Content Scripts, Popup, and Options.
 */

(function (root) {
  'use strict';

  /**
   * Tính số tuần theo chuẩn ISO 8601 (bắt đầu tuần từ Thứ Hai).
   * Ví dụ: 08/10/2026 trả về 41.
   * @param {Date} [d=new Date()]
   * @returns {number}
   */
  function getISOWeekNumber(d) {
    const target = d instanceof Date ? new Date(d.getTime()) : (d ? new Date(d) : new Date());
    if (isNaN(target.getTime())) return 1;
    const date = new Date(Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()));
    // Chuẩn ISO: Ngày thứ 5 quyết định tuần thuộc về năm nào.
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  /**
   * Tính thứ trong tuần theo quy ước:
   * Thứ 2 = 2, Thứ 3 = 3, Thứ 4 = 4, Thứ 5 = 5, Thứ 6 = 6, Thứ 7 = 7, Chủ nhật = 8.
   * @param {Date|string|number} [d=new Date()]
   * @returns {number}
   */
  function getDayNumber(d) {
    const target = d instanceof Date ? d : (d ? new Date(d) : new Date());
    if (isNaN(target.getTime())) return 2;
    const day = target.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
    return day === 0 ? 8 : day + 1;
  }

  /**
   * Tạo tên phòng Meet theo quy luật:
   * Staff{Năm}W{số thứ tự tuần trong năm}T{số thứ tự ngày trong tuần}
   * Ví dụ: 08/10/2026 -> Staff2026W41T5
   * @param {Date|string|number} [d=new Date()]
   * @returns {string}
   */
  function getRoomName(d) {
    const target = d instanceof Date ? d : (d ? new Date(d) : new Date());
    const valid = !isNaN(target.getTime()) ? target : new Date();
    const year = valid.getFullYear();
    const week = getISOWeekNumber(valid);
    const day = getDayNumber(valid);
    return `Staff${year}W${week}T${day}`;
  }

  /**
   * Tạo URL phòng họp đầy đủ trên Jitsi Meet
   * @param {Date} [d=new Date()]
   * @returns {string}
   */
  function getMeetingUrl(d) {
    const room = getRoomName(d);
    return `https://meet.jit.si/${room}`;
  }

  /**
   * Chuyển đổi định dạng giờ "HH:mm" thành số phút trong ngày (0 - 1440)
   * "24:00" được tính là 1440 phút (hết ngày).
   * @param {string} timeStr
   * @returns {number}
   */
  function timeStringToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.trim().split(':').map(Number);
    if (h === 24 && (!m || m === 0)) return 24 * 60;
    return (h || 0) * 60 + (m || 0);
  }

  /**
   * Cấu hình mặc định cho Extension (Bật tự động record theo 3 ca lịch trình)
   */
  const DEFAULT_SETTINGS = {
    displayName: 'Staff Member',
    autoJoinPrejoin: true,
    enableAutoRecord: true, // BẬT TỰ ĐỘNG RECORD THEO LỊCH TRÌNH
    autoRecordIfInSlot: true, // TỰ ĐỘNG BẬT KHI ĐANG TRONG KHUNG GIỜ
    notifyOnRecord: true,
    soundAlert: true,
    showFloatingHud: false, // TẮT BẢNG NỔI TRÊN MÀN HÌNH THEO Ý NGƯỜI DÙNG (Dùng Popup Extension)
    saveLocationName: 'Thư mục Downloads (Mặc định)',
    saveSubfolder: 'AutoMeet_Recordings',
    schedules: [
      { id: 'morning', name: 'Ca sáng', start: '07:30', end: '11:30', enabled: true },
      { id: 'afternoon', name: 'Ca chiều', start: '13:00', end: '17:00', enabled: true },
      { id: 'evening', name: 'Ca tối', start: '22:00', end: '24:00', enabled: true }
    ]
  };

  /**
   * Kiểm tra thời điểm hiện tại có đang nằm trong khung giờ bật record hay không
   * @param {Array} schedules
   * @param {Date} [d=new Date()]
   * @returns {{ inSlot: boolean, activeSchedule: object|null }}
   */
  function checkCurrentSlot(schedules, d) {
    const target = d || new Date();
    const currentMinutes = target.getHours() * 60 + target.getMinutes();

    const list = schedules && schedules.length ? schedules : DEFAULT_SETTINGS.schedules;
    for (const item of list) {
      if (!item.enabled) continue;
      const startMin = timeStringToMinutes(item.start);
      const endMin = timeStringToMinutes(item.end);

      if (startMin <= endMin) {
        if (currentMinutes >= startMin && currentMinutes < endMin) {
          return { inSlot: true, activeSchedule: item };
        }
      } else {
        // Trường hợp khung giờ qua nửa đêm (ví dụ 23:00 -> 02:00)
        if (currentMinutes >= startMin || currentMinutes < endMin) {
          return { inSlot: true, activeSchedule: item };
        }
      }
    }

    return { inSlot: false, activeSchedule: null };
  }

  /**
   * Lấy sự kiện tiếp theo (chuẩn bị bật record hoặc chuẩn bị tắt record)
   * @param {Array} schedules
   * @param {Date} [d=new Date()]
   * @returns {{ type: 'start'|'end', schedule: object, timeStr: string, minutesLeft: number } | null}
   */
  function getNextEvent(schedules, d) {
    const target = d || new Date();
    const currentMinutes = target.getHours() * 60 + target.getMinutes();
    const list = (schedules && schedules.length ? schedules : DEFAULT_SETTINGS.schedules).filter(s => s.enabled);

    if (!list.length) return null;

    let nearest = null;
    let minDiff = Infinity;

    for (const item of list) {
      const startMin = timeStringToMinutes(item.start);
      const endMin = timeStringToMinutes(item.end);

      // Điểm mốc bắt đầu
      let diffStart = startMin - currentMinutes;
      if (diffStart < 0) diffStart += 24 * 60; // ngày mai
      if (diffStart > 0 && diffStart < minDiff) {
        minDiff = diffStart;
        nearest = { type: 'start', schedule: item, timeStr: item.start, minutesLeft: diffStart };
      }

      // Điểm mốc kết thúc (nếu đang trong ca)
      let diffEnd = endMin - currentMinutes;
      if (diffEnd < 0) diffEnd += 24 * 60;
      if (diffEnd > 0 && diffEnd < minDiff) {
        minDiff = diffEnd;
        nearest = { type: 'end', schedule: item, timeStr: item.end, minutesLeft: diffEnd };
      }
    }

    return nearest;
  }

  /**
   * Tải cài đặt từ chrome.storage.local
   * @returns {Promise<typeof DEFAULT_SETTINGS>}
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('settings', (res) => {
          if (res && res.settings) {
            resolve({ ...DEFAULT_SETTINGS, ...res.settings });
          } else {
            resolve(DEFAULT_SETTINGS);
          }
        });
      } else {
        resolve(DEFAULT_SETTINGS);
      }
    });
  }

  /**
   * Lưu cài đặt vào chrome.storage.local
   * @param {object} newSettings
   * @returns {Promise<void>}
   */
  async function saveSettings(newSettings) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ settings: newSettings }, () => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * IndexedDB lưu trữ FileSystemDirectoryHandle để ghi file tự động không popup
   */
  const DB_NAME = 'AutoMeetStorage';
  const DB_VERSION = 1;
  const STORE_NAME = 'handles';

  function openAutoMeetDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  async function saveDirectoryHandle(handle) {
    try {
      const db = await openAutoMeetDB();
      if (!db) return false;
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, 'recordingDir');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      return false;
    }
  }

  async function getSavedDirectoryHandle() {
    try {
      const db = await openAutoMeetDB();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get('recordingDir');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  /**
   * Chuẩn hóa tên tệp loại bỏ mọi ký tự cấm theo chuẩn NTFS (Windows) và POSIX (Linux):
   * Không chứa: \ / : * ? " < > | và các mã điều khiển 0x00-0x1F.
   * Tự động cô lập basename, bảo vệ khỏi tên thiết bị cấm trên Windows (CON, PRN, AUX, NUL, COM0-9, LPT0-9, CLOCK$, CONIN$, CONOUT$).
   * Giới hạn độ dài <= 240 ký tự an toàn trước giới hạn MAX_PATH (255 ký tự).
   * Định dạng chuẩn video AutoMeet: Staff{Year}W{Week}T{Day}_{YYYY-MM-DD}_{HH-MM-SS}.webm
   */
  function sanitizeFilename(filename) {
    if (!filename) return 'recording.webm';
    let base = String(filename).split(/[/\\]/).pop() || 'recording.webm';
    let safe = base.replace(/[/\\?%*:|"<>]/g, '_').replace(/[\x00-\x1f\x80-\x9f]/g, '').trim();
    safe = safe.replace(/^[\s.]+|[\s.]+$/g, '');
    if (!safe) safe = 'recording.webm';

    let isWebm = safe.toLowerCase().endsWith('.webm');
    let stem = isWebm ? safe.slice(0, -5) : safe;
    stem = stem.replace(/^[\s.]+|[\s.]+$/g, '');
    if (!stem) stem = 'recording';

    if (stem.length > 240) stem = stem.slice(0, 240).trim();

    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$|clock\$)(\.|$)/i.test(stem)) {
      stem = '_' + stem;
    }

    return stem + '.webm';
  }

  /**
   * Chuẩn hóa đường dẫn thư mục con cho Chrome Downloads API:
   * Luôn sử dụng dấu gạch chéo xuôi '/', là đường dẫn tương đối, không chứa '..' hay ký tự cấm NTFS/POSIX
   */
  function sanitizeSubfolder(subfolder) {
    if (!subfolder) return 'AutoMeet_Recordings';
    let folder = String(subfolder).replace(/\\/g, '/');
    folder = folder.replace(/^[a-zA-Z]:/g, '');
    folder = folder.replace(/^\/+|\/+$/g, '');
    const parts = folder.split('/').filter(p => p && p !== '.' && p !== '..');
    const cleanParts = parts
      .map(p => {
        let clean = p.replace(/[/\\?%*:|"<>]/g, '_').replace(/[\x00-\x1f\x80-\x9f]/g, '').trim();
        clean = clean.replace(/^[\s.]+|[\s.]+$/g, '');
        if (clean.length > 240) clean = clean.slice(0, 240).trim();
        if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$|clock\$)(\.|$)/i.test(clean)) {
          clean = '_' + clean;
        }
        return clean;
      })
      .filter(Boolean);
    return cleanParts.length > 0 ? cleanParts.join('/') : 'AutoMeet_Recordings';
  }

  // Export sang globalThis để dùng được cho cả Content Script, Background và Popup
  const exports = {
    getISOWeekNumber,
    getDayNumber,
    getRoomName,
    getMeetingUrl,
    timeStringToMinutes,
    checkCurrentSlot,
    getNextEvent,
    loadSettings,
    saveSettings,
    saveDirectoryHandle,
    getSavedDirectoryHandle,
    sanitizeFilename,
    sanitizeSubfolder,
    DEFAULT_SETTINGS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
  root.AutoMeetUtils = exports;
})(typeof globalThis !== 'undefined' ? globalThis : this);
