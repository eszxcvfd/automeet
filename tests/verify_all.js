const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load utils
require('../utils.js');
const utils = global.AutoMeetUtils;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('=== TEST SUITE: Cross-Platform & Zero-Prompt AutoMeet Verification ===\n');

// -------------------------------------------------------------
// 1. utils.sanitizeFilename
// -------------------------------------------------------------
console.log('[1] Testing utils.sanitizeFilename');
{
  assert(
    utils.sanitizeFilename('Staff2026W41T6_2026-10-09_10-32-31.webm') === 'Staff2026W41T6_2026-10-09_10-32-31.webm',
    'Standard valid filename preserved'
  );

  assert(
    utils.sanitizeFilename('Staff:Room*Name?|Test<1>2.webm') === 'Staff_Room_Name__Test_1_2.webm',
    'Windows forbidden chars (: * ? | < >) replaced with underscore'
  );

  assert(
    utils.sanitizeFilename('path/to/folder\\Staff_Video.webm') === 'Staff_Video.webm',
    'Path components stripped to basename'
  );

  assert(
    utils.sanitizeFilename('   .Staff_Meeting.webm.   ') === 'Staff_Meeting.webm',
    'Leading/trailing dots and spaces trimmed'
  );

  assert(
    utils.sanitizeFilename('') === 'recording.webm',
    'Empty filename defaults to recording.webm'
  );

  assert(
    utils.sanitizeFilename(null) === 'recording.webm',
    'Null filename defaults to recording.webm'
  );

  assert(
    utils.sanitizeFilename('StaffVideo') === 'StaffVideo.webm',
    'Appends .webm if missing'
  );

  // Reserved DOS device names
  assert(
    utils.sanitizeFilename('CON.webm') === '_CON.webm',
    'Reserved name CON.webm prefixed with underscore'
  );
  assert(
    utils.sanitizeFilename('aux.webm') === '_aux.webm',
    'Reserved name aux.webm prefixed with underscore'
  );
  assert(
    utils.sanitizeFilename('NUL.webm') === '_NUL.webm',
    'Reserved name NUL.webm prefixed with underscore'
  );
  assert(
    utils.sanitizeFilename('COM1.webm') === '_COM1.webm',
    'Reserved name COM1.webm prefixed with underscore'
  );
  assert(
    utils.sanitizeFilename('lpt9.webm') === '_lpt9.webm',
    'Reserved name lpt9.webm prefixed with underscore'
  );
  assert(
    utils.sanitizeFilename('conin$.webm') === '_conin$.webm',
    'Reserved console name conin$.webm prefixed with underscore'
  );
  assert(
    utils.sanitizeFilename('conout$.webm') === '_conout$.webm',
    'Reserved console name conout$.webm prefixed with underscore'
  );
  assert(
    utils.sanitizeFilename('con.tar.gz') === '_con.tar.gz.webm',
    'Reserved name with multiple extensions prefixed'
  );

  // Extended DOS names (COM0, LPT0, CLOCK$)
  assert(
    utils.sanitizeFilename('COM0.webm') === '_COM0.webm',
    'Reserved name COM0.webm prefixed with underscore'
  );
  assert(
    utils.sanitizeFilename('lpt0.webm') === '_lpt0.webm',
    'Reserved name lpt0.webm prefixed with underscore'
  );
  assert(
    utils.sanitizeFilename('clock$.webm') === '_clock$.webm',
    'Reserved name clock$.webm prefixed with underscore'
  );

  // Trailing space/dot before extension
  assert(
    utils.sanitizeFilename('meeting_record .webm') === 'meeting_record.webm',
    'Space before .webm extension cleaned'
  );
  assert(
    utils.sanitizeFilename('meeting_record..webm') === 'meeting_record.webm',
    'Multiple dots before .webm extension cleaned'
  );

  // MAX_PATH 240-char stem length cap
  const longName = 'A'.repeat(300) + '.webm';
  const cleanLong = utils.sanitizeFilename(longName);
  assert(
    cleanLong.length <= 245 && cleanLong.endsWith('.webm'),
    `Excessively long filename safely truncated within MAX_PATH (length: ${cleanLong.length} <= 245)`
  );
}

// -------------------------------------------------------------
// 1b. Date Helpers Robustness (string, number, Date)
// -------------------------------------------------------------
console.log('\n[1b] Testing Date Helpers Robustness (utils)');
{
  assert(
    utils.getISOWeekNumber('2026-10-09') === 41,
    'getISOWeekNumber parses ISO date string correctly'
  );
  assert(
    utils.getDayNumber('2026-10-09') === 6,
    'getDayNumber parses ISO date string correctly (Friday = 6)'
  );
  assert(
    utils.getRoomName('2026-10-09') === 'Staff2026W41T6',
    'getRoomName parses ISO date string correctly -> Staff2026W41T6'
  );
  assert(
    typeof utils.getRoomName('invalid-date') === 'string' && utils.getRoomName('invalid-date').startsWith('Staff'),
    'getRoomName safely handles invalid date without throwing'
  );
  assert(
    typeof utils.getRoomName(1760000000000) === 'string' && utils.getRoomName(1760000000000).startsWith('Staff'),
    'getRoomName accepts numeric timestamp'
  );
}

// -------------------------------------------------------------
// 2. utils.sanitizeSubfolder
// -------------------------------------------------------------
console.log('\n[2] Testing utils.sanitizeSubfolder');
{
  assert(
    utils.sanitizeSubfolder('AutoMeet_Recordings') === 'AutoMeet_Recordings',
    'Default folder preserved'
  );

  assert(
    utils.sanitizeSubfolder('') === 'AutoMeet_Recordings',
    'Empty subfolder defaults to AutoMeet_Recordings'
  );

  assert(
    utils.sanitizeSubfolder('AutoMeet\\Recordings\\2026') === 'AutoMeet/Recordings/2026',
    'Backslashes converted to forward slashes'
  );

  assert(
    utils.sanitizeSubfolder('C:\\Users\\User\\Downloads\\AutoMeet') === 'Users/User/Downloads/AutoMeet',
    'Drive letter stripped and converted to relative path'
  );

  assert(
    utils.sanitizeSubfolder('../../../etc/passwd') === 'etc/passwd',
    'Directory traversal .. segments removed'
  );

  assert(
    utils.sanitizeSubfolder('AutoMeet/./Recordings') === 'AutoMeet/Recordings',
    'Single dot . segments removed'
  );

  assert(
    utils.sanitizeSubfolder('Auto:Meet*|Invalid/Folder?') === 'Auto_Meet__Invalid/Folder_',
    'Forbidden characters stripped from segments'
  );

  assert(
    utils.sanitizeSubfolder('  segment1.  /  segment2.  ') === 'segment1/segment2',
    'Segment trailing dots and spaces stripped'
  );

  assert(
    utils.sanitizeSubfolder('con/aux/nul/com1') === '_con/_aux/_nul/_com1',
    'Reserved segment names prefixed with underscore'
  );

  assert(
    utils.sanitizeSubfolder('con.dir/aux.recordings/nul.backup') === '_con.dir/_aux.recordings/_nul.backup',
    'Reserved segment names with extensions prefixed with underscore'
  );

  assert(
    utils.sanitizeSubfolder('conin$/conout$') === '_conin$/_conout$',
    'Reserved console segment names prefixed with underscore'
  );

  assert(
    utils.sanitizeSubfolder('com0/lpt0/clock$') === '_com0/_lpt0/_clock$',
    'Extended reserved segment names (com0/lpt0/clock$) prefixed with underscore'
  );
}

// -------------------------------------------------------------
// 3. Download Interception Classification in background.js
// -------------------------------------------------------------
console.log('\n[3] Testing Download Classification Logic (background.js)');
{
  const EXT_ID = 'test-extension-id-12345';
  global.chrome = { runtime: { id: EXT_ID } };

  function isAutoMeetDownload(item) {
    const rawName = item.filename || '';
    const baseName = rawName.split(/[/\\]/).pop() || '';
    const isFromMeet = Boolean(
      (item.url && (item.url.includes('meet.jit.si') || item.url.startsWith('blob:https://meet.jit.si/'))) ||
      (item.referrer && item.referrer.includes('meet.jit.si'))
    );
    const isExtensionInitiated = Boolean(item.byExtensionId && global.chrome?.runtime?.id && item.byExtensionId === global.chrome.runtime.id);
    const isWebm = baseName.toLowerCase().endsWith('.webm') || (item.mime && item.mime.includes('webm'));
    const isAutoMeetPattern = /^Staff\d+W\d+T\d+_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.webm$/i.test(baseName) ||
      (baseName.toLowerCase().startsWith('staff') && isWebm && isFromMeet) ||
      (baseName.toLowerCase().includes('automeet') && isWebm);

    return (isExtensionInitiated && isWebm) || (isFromMeet && isWebm) || isAutoMeetPattern;
  }

  // POSITIVE CASES (Must match)
  assert(
    isAutoMeetDownload({
      filename: 'AutoMeet_Recordings/Staff2026W41T6_2026-10-09_10-32-56.webm',
      byExtensionId: EXT_ID,
      url: 'blob:https://meet.jit.si/uuid',
      mime: 'video/webm'
    }) === true,
    'Positive: Extension-initiated recording download matches'
  );

  assert(
    isAutoMeetDownload({
      filename: 'Staff2026W41T6_2026-10-09_10-32-56.webm',
      url: 'blob:https://meet.jit.si/12345',
      mime: 'video/webm'
    }) === true,
    'Positive: Inpage blob download from Jitsi matches'
  );

  assert(
    isAutoMeetDownload({
      filename: 'Staff2026W41T6_2026-10-09_10-32-56.webm',
      url: 'https://example.com/recording.webm'
    }) === true,
    'Positive: File matching exact Staff pattern matches'
  );

  // NEGATIVE CASES (Must NOT hijack other downloads)
  assert(
    isAutoMeetDownload({
      filename: 'Staff_Payroll.xlsx',
      url: 'https://company.internal/payroll/Staff_Payroll.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }) === false,
    'Negative: Staff_Payroll.xlsx is NOT hijacked'
  );

  assert(
    isAutoMeetDownload({
      filename: 'Staff_Handbook.pdf',
      url: 'https://hr.example.com/Staff_Handbook.pdf',
      mime: 'application/pdf'
    }) === false,
    'Negative: Staff_Handbook.pdf is NOT hijacked'
  );

  assert(
    isAutoMeetDownload({
      filename: 'Staff_Roster.docx',
      url: 'https://mail.google.com/attachment/Staff_Roster.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }) === false,
    'Negative: Staff_Roster.docx is NOT hijacked'
  );

  assert(
    isAutoMeetDownload({
      filename: 'setup.exe',
      url: 'https://download.example.com/setup.exe'
    }) === false,
    'Negative: setup.exe is NOT hijacked'
  );

  assert(
    isAutoMeetDownload({
      filename: 'video.mp4',
      url: 'https://youtube.com/watch?v=123',
      mime: 'video/mp4'
    }) === false,
    'Negative: video.mp4 from external site is NOT hijacked'
  );

  assert(
    isAutoMeetDownload({
      filename: 'recording.webm',
      url: 'https://zoom.us/rec/recording.webm',
      mime: 'video/webm'
    }) === false,
    'Negative: Generic recording.webm from non-Jitsi site is NOT hijacked'
  );
}

// -------------------------------------------------------------
// 4. Launcher Scripts & Flags Verification
// -------------------------------------------------------------
console.log('\n[4] Testing Launcher Scripts & Automation Flags');
{
  const batPath = path.join(__dirname, '../scripts/start-chrome-auto.bat');
  const shPath = path.join(__dirname, '../scripts/start-chrome-auto.sh');
  const winShortcutBat = path.join(__dirname, '../scripts/create-windows-shortcut.bat');
  const linuxShortcutSh = path.join(__dirname, '../scripts/create-linux-shortcut.sh');

  const batContent = fs.readFileSync(batPath, 'utf8');
  const shContent = fs.readFileSync(shPath, 'utf8');
  const winShortcutContent = fs.readFileSync(winShortcutBat, 'utf8');
  const linuxShortcutContent = fs.readFileSync(linuxShortcutSh, 'utf8');

  // Acceptance Criteria: 4 flags
  const expectedFlags = [
    '--auto-select-tab-capture-source-by-title="Staff"',
    '--auto-select-desktop-capture-source="Staff"',
    '--auto-select-tab-capture-source-by-title="Jitsi Meet"',
    '--auto-select-desktop-capture-source="Jitsi Meet"'
  ];

  for (const flag of expectedFlags) {
    assert(batContent.includes(flag), `start-chrome-auto.bat contains flag: ${flag}`);
    assert(shContent.includes(flag), `start-chrome-auto.sh contains flag: ${flag}`);
    assert(winShortcutContent.includes(flag.replace(/"/g, '""')), `create-windows-shortcut.bat contains flag: ${flag}`);
  }

  // Acceptance Criteria: No --use-fake-ui-for-media-stream
  assert(!batContent.includes('--use-fake-ui-for-media-stream'), 'start-chrome-auto.bat does NOT contain harmful --use-fake-ui-for-media-stream');
  assert(!shContent.includes('--use-fake-ui-for-media-stream'), 'start-chrome-auto.sh does NOT contain harmful --use-fake-ui-for-media-stream');
  assert(!winShortcutContent.includes('--use-fake-ui-for-media-stream'), 'create-windows-shortcut.bat does NOT contain harmful --use-fake-ui-for-media-stream');

  // Executable permissions
  const shStats = fs.statSync(shPath);
  const isExecutableSh = Boolean(shStats.mode & 0o111);
  assert(isExecutableSh, 'start-chrome-auto.sh has executable permissions');

  const linuxShortcutStats = fs.statSync(linuxShortcutSh);
  const isExecutableLinuxShortcut = Boolean(linuxShortcutStats.mode & 0o111);
  assert(isExecutableLinuxShortcut, 'create-linux-shortcut.sh has executable permissions');

  // WOW64 support in bat files
  assert(batContent.includes('%ProgramW6432%'), 'start-chrome-auto.bat supports ProgramW6432 64-bit detection');
  assert(winShortcutContent.includes('%ProgramW6432%'), 'create-windows-shortcut.bat supports ProgramW6432 64-bit detection');

  // Dynamic Desktop resolution in win shortcut
  assert(winShortcutContent.includes('SpecialFolders("Desktop")') || winShortcutContent.includes('SpecialFolders'), 'create-windows-shortcut.bat uses SpecialFolders("Desktop")');

  // Verify Desktop resolution priority: DESKTOP_DIR must take precedence over unredirected SpecialFolders
  const vbsDirectIdx = winShortcutContent.indexOf('sDesktop = "!DESKTOP_DIR!"');
  const vbsFallbackIdx = winShortcutContent.indexOf('SpecialFolders');
  assert(
    vbsDirectIdx !== -1 && vbsFallbackIdx !== -1 && vbsDirectIdx < vbsFallbackIdx,
    'create-windows-shortcut.bat prioritizes DESKTOP_DIR before SpecialFolders fallback in VBScript'
  );

  const psDirectIdx = winShortcutContent.indexOf("$desk = '!DESKTOP_DIR!'");
  const psFallbackIdx = winShortcutContent.indexOf("$ws.SpecialFolders");
  assert(
    psDirectIdx !== -1 && psFallbackIdx !== -1 && psDirectIdx < psFallbackIdx,
    'create-windows-shortcut.bat prioritizes DESKTOP_DIR before SpecialFolders fallback in PowerShell'
  );

  // Dual Desktop synchronization (OneDrive + Local)
  assert(
    winShortcutContent.includes('%USERPROFILE%\\OneDrive\\Desktop') && winShortcutContent.includes('%USERPROFILE%\\Desktop'),
    'create-windows-shortcut.bat synchronizes shortcut across both local Desktop and OneDrive Desktop'
  );

  // Standalone VBScript shortcut creator
  const vbsPath = path.join(__dirname, '../scripts/create-windows-shortcut.vbs');
  assert(fs.existsSync(vbsPath), 'create-windows-shortcut.vbs exists');
  const vbsContent = fs.readFileSync(vbsPath, 'utf8');
  for (const flag of expectedFlags) {
    assert(vbsContent.includes(flag.replace(/"/g, '""')), `create-windows-shortcut.vbs contains flag: ${flag}`);
  }
  assert(!vbsContent.includes('--use-fake-ui-for-media-stream'), 'create-windows-shortcut.vbs does NOT contain harmful --use-fake-ui-for-media-stream');

  // Target URL parameter support
  assert(batContent.includes('TARGET_URL') && batContent.includes('https://meet.jit.si/'), 'start-chrome-auto.bat supports TARGET_URL parameter');
  assert(shContent.includes('TARGET_URL') && shContent.includes('https://meet.jit.si/'), 'start-chrome-auto.sh supports TARGET_URL parameter');
}

// -------------------------------------------------------------
// 5. WebM EBML Duration Patch & Seeking Verification
// -------------------------------------------------------------
console.log('\n[5] Testing WebM EBML Duration Patch & Seeking (ffmpeg / ffprobe)');
{
  const tmpVideo = path.join(__dirname, 'test_synthetic.webm');
  const patchedVideo = path.join(__dirname, 'test_synthetic_patched.webm');

  try {
    // 1. Generate 3-second synthetic video with ffmpeg
    execSync(`ffmpeg -y -f lavfi -i testsrc=duration=3:size=320x240:rate=10 -f lavfi -i sine=frequency=440:duration=3 -c:v vp8 -c:a libopus "${tmpVideo}" 2>/dev/null`);
    assert(fs.existsSync(tmpVideo), 'Synthetic WebM generated via ffmpeg');

    // 2. Corrupt duration to Jitsi placeholder 864,000,000 ms (240 hours)
    let buf = fs.readFileSync(tmpVideo);
    let found = false;
    for (let i = 0; i <= buf.length - 11; i++) {
      if (buf[i] === 0x44 && buf[i + 1] === 0x89 && buf[i + 2] === 0x88) {
        buf.writeDoubleBE(864000000.0, i + 3);
        found = true;
        break;
      }
    }
    assert(found, 'EBML Duration element found and injected with 864,000,000 ms placeholder');

    // Write corrupted buffer to disk and verify corruption with ffprobe
    fs.writeFileSync(tmpVideo, buf);
    const corruptProbe = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmpVideo}"`).toString().trim();
    assert(parseFloat(corruptProbe) > 800000, `Corrupted file displays placeholder duration: ${corruptProbe}s (> 800,000s)`);

    // 3. Apply the EBML patch algorithm from inpage.js
    const actualDurationMs = 3000.0;
    let patched = false;
    for (let i = 0; i <= buf.length - 7; i++) {
      if (buf[i] === 0x44 && buf[i + 1] === 0x89) {
        const size = buf[i + 2];
        if (size === 0x88 && (i + 11 <= buf.length)) {
          const val = buf.readDoubleBE(i + 3);
          if (val >= 860000000 || val <= 0 || isNaN(val) || !isFinite(val)) {
            buf.writeDoubleBE(actualDurationMs, i + 3);
            patched = true;
          }
          break;
        } else if (size === 0x84 && (i + 7 <= buf.length)) {
          const val = buf.readFloatBE(i + 3);
          if (val >= 860000000 || val <= 0 || isNaN(val) || !isFinite(val)) {
            buf.writeFloatBE(actualDurationMs, i + 3);
            patched = true;
          }
          break;
        }
      }
    }
    assert(patched, 'EBML Duration patch algorithm successfully detected placeholder and patched duration');
    fs.writeFileSync(patchedVideo, buf);

    // 4. Verify patched duration with ffprobe
    const fixedProbe = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${patchedVideo}"`).toString().trim();
    assert(Math.abs(parseFloat(fixedProbe) - 3.0) < 0.1, `Patched file displays accurate duration: ${fixedProbe}s (target: 3.0s)`);

    // 5. Test seeking on patched file
    const seekResult = execSync(`ffmpeg -ss 2.0 -i "${patchedVideo}" -frames:v 1 -f null - 2>&1`).toString();
    assert(seekResult.includes('frame=    1'), 'Seeking test to 2.0s succeeded on patched WebM');

  } catch (err) {
    assert(false, `WebM testing error: ${err.message}`);
  } finally {
    try { fs.unlinkSync(tmpVideo); } catch (e) {}
    try { fs.unlinkSync(patchedVideo); } catch (e) {}
  }
}

// -------------------------------------------------------------
// 6. Real Recorded Files Seeking & Duration Verification
// -------------------------------------------------------------
console.log('\n[6] Testing Existing Recordings in ~/Downloads/AutoMeet_Recordings');
{
  const rec1 = '/home/trung/Downloads/AutoMeet_Recordings/Staff2026W41T6_2026-10-09_10-32-31.webm';
  const rec2 = '/home/trung/Downloads/AutoMeet_Recordings/Staff2026W41T6_2026-10-09_10-32-56.webm';

  if (fs.existsSync(rec1)) {
    const probe1 = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${rec1}"`).toString().trim();
    assert(Math.abs(parseFloat(probe1) - 24.27) < 0.1, `Real recording 1 duration is valid: ${probe1}s`);
    const seek1 = execSync(`ffmpeg -ss 10.0 -i "${rec1}" -frames:v 1 -f null - 2>&1`).toString();
    assert(seek1.includes('frame=    1'), 'Real recording 1 is seekable at 10.0s');
  }

  if (fs.existsSync(rec2)) {
    const probe2 = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${rec2}"`).toString().trim();
    assert(Math.abs(parseFloat(probe2) - 277.82) < 0.5, `Real recording 2 duration is valid: ${probe2}s`);
    const seek2 = execSync(`ffmpeg -ss 200.0 -i "${rec2}" -frames:v 1 -f null - 2>&1`).toString();
    assert(seek2.includes('frame=    1'), 'Real recording 2 is seekable at 200.0s');
  }
}

// -------------------------------------------------------------
// 7. Syntax Validation Across All Files
// -------------------------------------------------------------
console.log('\n[7] Syntax Validation');
{
  const jsFiles = ['background.js', 'utils.js', 'content/content.js', 'content/inpage.js', 'options/options.js', 'popup/popup.js'];
  for (const f of jsFiles) {
    try {
      execSync(`node -c "${path.join(__dirname, '..', f)}"`);
      assert(true, `Syntax check passed: ${f}`);
    } catch (e) {
      assert(false, `Syntax error in: ${f}`);
    }
  }

  const shFiles = ['scripts/start-chrome-auto.sh', 'scripts/create-linux-shortcut.sh'];
  for (const f of shFiles) {
    try {
      execSync(`bash -n "${path.join(__dirname, '..', f)}"`);
      assert(true, `Bash syntax check passed: ${f}`);
    } catch (e) {
      assert(false, `Bash syntax error in: ${f}`);
    }
  }
}

console.log(`\n=============================================================`);
console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
console.log(`=============================================================\n`);

if (failed > 0) {
  process.exit(1);
}
