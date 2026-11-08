/* ───────────────────────── 설정 시트 · 사용자 · 캐시 ───────────────────────── */
/* Settings.gs  */
// 설정 시트에 인원수·사용자 표·주유패스 칸이 없으면 만들어 둠 (있으면 안 건드림)
const SETTINGS_USER_ROW = 6;   // 사용자 표 머리글 행 (새로 만들 때)
function ensureSettingsExtra_(ss) {
  const sh = ss.getSheetByName(CONFIG.SETTINGS_SHEET);
  if (!sh) return;
  const labels = () => sh.getRange(1, 1, Math.max(sh.getLastRow(), SETTINGS_USER_ROW), 1).getDisplayValues().map(r => hn_(r[0]));
  let a = labels();
  if (a.indexOf(hn_('교통비 인원수')) === -1) {
    sh.getRange(3, 1, 2, 2).setValues([['교통비 인원수', CONFIG.TRAVELERS], ['새 예산 기본 인원수', CONFIG.DEFAULT_PEOPLE]]);
    sh.getRange(3, 1, 2, 1).setFontWeight('bold');
    sh.getRange(3, 1).setNote('예산 시트 "교통비 MM/DD" 행을 새로 만들 때 넣는 인원수');
    sh.getRange(4, 1).setNote('일정에서 금액만 입력해 예산 항목이 새로 생길 때 인원수');
  }
  a = labels();
  if (a.indexOf(hn_('사용자')) === -1) {
    const r = SETTINGS_USER_ROW;
    sh.getRange(r, 1, 1, 6).setValues([['사용자', '시작일', '종료일', '도장·기록', '일정 수정', 'PIN']])
      .setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_INPUT);
    const rows = CONFIG.USERS.map(u => [u.id, u.from, u.to, !!u.canStamp, !!u.canEdit, '']);
    sh.getRange(r + 1, 2, 30, 2).setNumberFormat('@');
    sh.getRange(r + 1, 6, 30, 1).setNumberFormat('@');
    sh.getRange(r + 1, 4, 30, 2).insertCheckboxes();
    sh.getRange(r + 1, 1, rows.length, 6).setValues(rows);
    sh.getRange(r, 1).setNote('웹앱 첫 화면에서 고르는 사람. 줄 추가·삭제 자유\n시작일·종료일: 볼 수 있는 일정 범위 (yyyy-mm-dd)\n도장·기록: 도장·도착·지출 기록 가능\n일정 수정: 웹에서 체류 조정·건너뛰기 가능');
    sh.getRange(r, 6).setNote('비우면 PIN 없음. 넣으면 그 사람으로 기록할 때 PIN 필요 (보는 건 누구나)');
  }
  // 주유패스: 사용자 표 바로 위에 2줄 끼워 넣음 (빈 줄 하나 띄움)
  a = labels();
  if (a.indexOf(hn_('주유패스 날짜')) === -1) {
    const h = a.indexOf(hn_('사용자')) + 1;   // 사용자 표 머리글 행 (1부터)
    sh.insertRowsBefore(h, 3);
    sh.getRange(h, 1, 2, 2).setValues([['주유패스 날짜', ''], ['주유패스 노선', CONFIG.PASS_LINES]]);
    sh.getRange(h, 1, 2, 1).setFontWeight('bold');
    sh.getRange(h, 2, 2, 1).setNumberFormat('@').setBackground('#fff3bf');
    sh.getRange(h, 1).setNote('패스 쓰는 날. 이런 형식 가능 (쉼표로 여러 개):\n2026-12-26 2일 → 2일권 (26, 27일)\n2026-12-26~12-27 → 기간\n2026-12-26, 2026-12-27 → 날짜 나열\n이 날의 대중교통 구간이 전부 패스 노선이면 교통비 0원\n일부만 패스 노선이면 요금 그대로 두고 경로 시트 "패스" 열에 표시\n비우면 패스 적용 안 함');
    sh.getRange(h + 1, 1).setNote('패스로 탈 수 있는 노선·회사 이름 (정규식, | 로 구분)\n구글 경로 결과의 노선 이름·회사 이름과 비교\n비우면 스크립트 기본값');
  }
}

// 주유패스 날짜 칸 → ['2026-12-26', '2026-12-27']
// 쓸 수 있는 형식 (쉼표·줄바꿈으로 여러 개):
//   2026-12-26               하루
//   2026-12-26 2일           시작일부터 연속 2일 (2일권)
//   2026-12-26~12-27         기간 (끝 날짜는 월-일만 써도 됨, 해 넘김도 됨)
function expandPassDays_(text) {
  const out = [];
  const ymd = s => {
    const m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  };
  const iso = t => t.getUTCFullYear() + '-' + pad2_(t.getUTCMonth() + 1) + '-' + pad2_(t.getUTCDate());
  String(text || '').split(/[,，\n]+/).forEach(tok => {
    tok = tok.trim();
    const start = ymd(tok);
    if (!start) return;
    let n = 1;
    const parts = tok.split(/\s*[~〜–]\s*/);
    if (parts.length === 2) {
      let end = ymd(parts[1]);
      if (!end) {
        const md = parts[1].match(/(\d{1,2})\D+(\d{1,2})/);
        if (md) end = new Date(Date.UTC(start.getUTCFullYear(), Number(md[1]) - 1, Number(md[2])));
      }
      if (end && end < start) end.setUTCFullYear(end.getUTCFullYear() + 1);   // 12-31~1-1
      if (end) n = Math.round((end - start) / 86400000) + 1;
    } else {
      const days = tok.match(/(\d+)\s*일권?\s*$/);
      if (days) n = Number(days[1]);
    }
    n = Math.min(Math.max(n, 1), 14);
    for (let i = 0; i < n; i++) {
      const day = iso(new Date(start.getTime() + i * 86400000));
      if (out.indexOf(day) === -1) out.push(day);
    }
  });
  return out;
}

let SETTINGS_MEMO_ = null;
// 설정 시트에서 인원수·사용자·주유패스 읽기. 표가 없으면 CONFIG 값
function readSettings_() {
  if (SETTINGS_MEMO_) return SETTINGS_MEMO_;
  const out = {
    travelers: CONFIG.TRAVELERS,
    defaultPeople: CONFIG.DEFAULT_PEOPLE,
    users: CONFIG.USERS.map(u => Object.assign({ pin: '' }, u)),
    passDays: [],
    passLines: CONFIG.PASS_LINES,
  };
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SETTINGS_SHEET);
  if (sh && sh.getLastRow() >= 3) {
    const vals = sh.getRange(1, 1, sh.getLastRow(), 6).getDisplayValues();
    const raw = sh.getRange(1, 1, sh.getLastRow(), 6).getValues();
    const yes = (i, c) => raw[i][c] === true || String(vals[i][c]).toUpperCase() === 'TRUE';
    const d = v => { const m = String(v || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]) : ''; };
    vals.forEach(r => {
      const k = hn_(r[0]);
      if (k === hn_('교통비 인원수') && Number(r[1]) > 0) out.travelers = Number(r[1]);
      if (k === hn_('새 예산 기본 인원수') && Number(r[1]) > 0) out.defaultPeople = Number(r[1]);
      if (k === hn_('주유패스 날짜')) out.passDays = expandPassDays_(r[1]);
      if (k === hn_('주유패스 노선') && String(r[1]).trim()) out.passLines = String(r[1]).trim();
    });
    const h = vals.findIndex(r => hn_(r[0]) === '사용자');
    if (h >= 0) {
      const users = [];
      for (let i = h + 1; i < vals.length; i++) {
        const r = vals[i];
        const id = String(r[0]).trim();
        if (!id) continue;
        users.push({
          id: id, from: d(r[1]) || '0000-01-01', to: d(r[2]) || '9999-12-31',
          canStamp: yes(i, 3), canEdit: yes(i, 4),
          pin: String(r[5]).trim(),
        });
      }
      if (users.length) out.users = users;
    }
  }
  SETTINGS_MEMO_ = out;
  return out;
}

// 웹앱 쓰기 요청의 사용자·PIN·권한 확인
function authUser_(user, pin, need) {
  const u = readSettings_().users.find(x => x.id === user);
  if (!u) throw new Error('없는 사용자: ' + user);
  if (u.pin && String(pin || '') !== u.pin) throw new Error('PIN이 틀림');
  if (need === 'stamp' && !u.canStamp) throw new Error(u.id + '는 기록할 수 없음 (보기 전용)');
  if (need === 'edit' && !u.canEdit) throw new Error(u.id + '는 일정을 수정할 수 없음');
  return u;
}

// 웹앱에서 호출: PIN 확인만
function checkPin(user, pin) { authUser_(user, pin, ''); return true; }

/* ── 웹앱 데이터 캐시: 시트 내용은 10분 캐시, 도장·도착·지출은 매번 새로 ── */
// 웹앱 데이터 모양이 바뀌면 버전 올리기 (새 코드 배포 직후 예전 캐시가 보이지 않게)
const MAP_CACHE_ = 'mapbase:v2';
function cacheGet_() {
  try {
    const c = CacheService.getScriptCache();
    const n = Number(c.get(MAP_CACHE_ + ':n') || 0);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(MAP_CACHE_ + ':' + i);
    const got = c.getAll(keys);
    if (keys.some(k => got[k] == null)) return null;
    return JSON.parse(keys.map(k => got[k]).join(''));
  } catch (e) {
    return null;
  }
}
function cachePut_(obj) {
  try {
    const s = JSON.stringify(obj);
    const size = 30000;   // 캐시 한 칸 100KB 제한 (한글은 3바이트라 넉넉히)
    const parts = {};
    let n = 0;
    for (let i = 0; i < s.length; i += size) parts[MAP_CACHE_ + ':' + (n++)] = s.slice(i, i + size);
    parts[MAP_CACHE_ + ':n'] = String(n);
    CacheService.getScriptCache().putAll(parts, 600);
  } catch (e) {
    // 너무 크면 캐시 없이
  }
}
function invalidateCache_() {
  try { CacheService.getScriptCache().remove(MAP_CACHE_ + ':n'); } catch (e) { /* 무시 */ }
}
// 메뉴: 웹앱이 시트 변경을 못 따라올 때
function clearWebCache() { requireSheetUi_(); invalidateCache_(); alert_('웹앱 캐시 비움. 웹앱 새로고침하면 최신 시트 내용으로 보임'); }