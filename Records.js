/* ───────────────────────── 실제 지출 ───────────────────────── */
/* Records.gs  */
function buildSpendSheet_(sh) {
  const n = SPEND_HEADERS.length;
  ensureColumns_(sh, n);
  sh.getRange(1, 1, 1, n).setValues([SPEND_HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_AUTO);
  sh.setFrozenRows(1);
  const rows = sh.getMaxRows() - 1;
  sh.getRange(2, X.KEY, rows, 1).setNumberFormat('@');
  sh.getRange(2, X.DATE, rows, 1).setNumberFormat('@');
  sh.getRange(2, X.AMOUNT, rows, 1).setNumberFormat(CONFIG.YEN_FORMAT);
  [110, 95, 50, 200, 100, 220, 140].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(1, 1).setNote('웹앱 타임라인에서 "지출" 버튼으로 입력한 값이 쌓이는 곳. 키 = 일자#순서\n여기서 직접 고쳐도 웹앱에 반영됨');
}

function spendSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CONFIG.SPEND_SHEET);
  if (!sh) { sh = ss.insertSheet(CONFIG.SPEND_SHEET); buildSpendSheet_(sh); }
  return sh;
}

function readSpend_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SPEND_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, SPEND_HEADERS.length).getValues().forEach(v => {
    const key = String(v[X.KEY - 1]).trim();
    const amt = v[X.AMOUNT - 1];
    if (key && amt !== '' && amt !== null && !isNaN(Number(amt))) {
      out[key] = { amount: Number(amt), memo: String(v[X.MEMO - 1] || '') };
    }
  });
  return out;
}

// 웹앱에서 호출: 실제 지출 저장. amount 비우면 삭제
function setSpend(key, place, amount, memo, user, pin) {
  authUser_(user, pin, 'stamp');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = spendSheet_();
    const last = sh.getLastRow();
    const keys = last >= 2 ? sh.getRange(2, X.KEY, last - 1, 1).getValues().map(v => String(v[0])) : [];
    const idx = keys.indexOf(key);
    const empty = amount === '' || amount === null || isNaN(Number(amount));
    if (empty) {
      if (idx !== -1) sh.deleteRow(idx + 2);
    } else {
      const parts = String(key).split('#');
      const row = [key, parts[0] || '', Number(parts[1]) || '', place || '', Number(amount), memo || '',
        Utilities.formatDate(new Date(), CONFIG.TRIP_TZ, 'yyyy-MM-dd HH:mm')];
      if (idx !== -1) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
      else sh.appendRow(row);
    }
  } finally {
    lock.releaseLock();
  }
  return readSpend_();
}

/* ───────────────────────── 도장 · 도착 · 일정 수정 (웹앱에서 호출) ───────────────────────── */

// 웹앱에서 호출: 방문 체크 저장 (키: 일자#순서). 사용자마다 따로
function setVisited(key, on, user, pin) {
  const changes = {};
  changes[key] = on ? 1 : 0;
  return setVisitedMany(changes, user, pin);
}

// 웹앱에서 호출: 여러 도장을 한 번에 (연달아 눌러도 한 번에 묶어서 저장)
function setVisitedMany(changes, user, pin) {
  const u = authUser_(user, pin, 'stamp');
  // 연달아 눌러도(도장 여러 개 지우기·되돌리기) 서로 덮어쓰지 않게 잠금
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const name = 'visited:' + u.id;
    const map = JSON.parse(props.getProperty(name) || '{}');
    // 값은 1만 저장: 속성 한 칸이 9KB까지라 날짜를 넣으면 일정이 많을 때 넘칠 수 있음
    Object.keys(changes || {}).forEach(k => { if (changes[k]) map[k] = 1; else delete map[k]; });
    props.setProperty(name, JSON.stringify(map));
    return map;
  } finally {
    lock.releaseLock();
  }
}

// 사용자별 방문 기록. 예전(사용자 구분 전) 기록은 첫 사용자에게 한 번 옮김
function getVisitedBy_() {
  const props = PropertiesService.getScriptProperties();
  const legacy = props.getProperty('visited');
  const users = readSettings_().users;
  const first = users[0].id;
  if (legacy && !props.getProperty('visited:' + first)) {
    props.setProperty('visited:' + first, legacy);
    props.deleteProperty('visited');
  }
  const out = {};
  users.forEach(u => {
    try { out[u.id] = JSON.parse(props.getProperty('visited:' + u.id) || '{}'); } catch (e) { out[u.id] = {}; }
    // 예전에 날짜로 저장된 값은 1로 줄여서 다시 저장
    const keys = Object.keys(out[u.id]);
    if (keys.some(k => out[u.id][k] !== 1)) {
      keys.forEach(k => { out[u.id][k] = 1; });
      props.setProperty('visited:' + u.id, JSON.stringify(out[u.id]));
    }
  });
  return out;
}

// 웹앱에서 호출: 실제 도착 시각 기록 ("HH:MM", 빈 값이면 삭제). 사용자마다 따로
function setArrived(key, hhmm, user, pin) {
  const u = authUser_(user, pin, 'stamp');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const name = 'arrived:' + u.id;
    const map = JSON.parse(props.getProperty(name) || '{}');
    if (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm)) map[key] = hhmm;
    else delete map[key];
    props.setProperty(name, JSON.stringify(map));
    return map;
  } finally {
    lock.releaseLock();
  }
}

function getArrivedBy_() {
  const props = PropertiesService.getScriptProperties();
  const out = {};
  readSettings_().users.forEach(u => {
    try { out[u.id] = JSON.parse(props.getProperty('arrived:' + u.id) || '{}'); } catch (e) { out[u.id] = {}; }
  });
  return out;
}

// 웹앱에서 호출: 일정 살짝 고치기 (canEdit 사용자만)
//  op = 'stay'  : 체류(분)에 value만큼 더함 (음수 가능). 출발 시각이 바뀌므로 경로 다시 계산
//  경로 재계산은 quick 모드 (배차 점검 호출 생략, 시트에서 경로 계산할 때 점검)
//  op = 'skip'  : 그 장소 건너뛰기 (일자를 비우고 메모에 표시, 경로 다시 계산)
//  op = 'unskip': 건너뛴 장소 되돌리기
//  op = 'taxi'  : value 1 = 다음 구간을 택시로 (이동수단 차 + 메모 [택시 · …]), 0 = 원래 수단으로
function editPlan(key, op, value, user, pin) {
  authUser_(user, pin, 'edit');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
    const tag = '[건너뜀 ' + key + ']';
    if (op === 'unskip') {
      const last = lastDataRow_(plan);
      const memos = plan.getRange(2, P.MEMO, Math.max(1, last - 1), 1).getValues();
      const i = memos.findIndex(v => String(v[0]).indexOf(tag) === 0);
      if (i === -1) throw new Error('되돌릴 장소를 못 찾음');
      const parts = key.split('#');
      plan.getRange(i + 2, P.DATE).setValue(parts[0]);
      plan.getRange(i + 2, P.ORDER).setValue(Number(parts[1]));
      plan.getRange(i + 2, P.MEMO).setValue(String(memos[i][0]).slice(tag.length).trim());
      runCalc_(false, { quick: true });
    } else {
      const r = readPlanRows_(plan, ss.getSpreadsheetTimeZone()).find(x => x.date + '#' + x.order === key);
      if (!r) throw new Error('일정에서 이 장소를 못 찾음 (' + key + ')');
      if (op === 'stay') {
        plan.getRange(r.sheetRow, P.STAY).setValue(Math.max(0, r.stay + Number(value || 0)));
        runCalc_(false, { quick: true });   // 출발 시각이 바뀌면 대중교통 시간표 결과도 달라져서 다시 계산 (배차 점검은 생략)
      } else if (op === 'taxi') {
        // 택시로 가기: 다음 이동수단을 차로 바꾸고 메모 앞에 [택시 · 원래수단 원래분] / 끄면 원래 수단으로
        const m = r.memo.match(TAXI_TAG_RE);
        if (Number(value)) {
          if (!m) {
            const prev = r.mode && r.mode !== '차' ? r.mode : '대중교통';
            const moveMin = Number(plan.getRange(r.sheetRow, P.MOVE).getValue()) || 0;
            const tagText = '[택시 · ' + prev + (moveMin ? ' ' + moveMin + '분' : '') + ']';
            plan.getRange(r.sheetRow, P.MEMO).setValue((tagText + ' ' + r.memo).trim());
            plan.getRange(r.sheetRow, P.MODE).setValue('차');
          }
        } else if (m) {
          plan.getRange(r.sheetRow, P.MODE).setValue(m[1] || '대중교통');
          plan.getRange(r.sheetRow, P.MEMO).setValue(r.memo.replace(TAXI_TAG_RE, ' ').replace(/\s+/g, ' ').trim());
        }
        runCalc_(false, { quick: true });
      } else if (op === 'skip') {
        plan.getRange(r.sheetRow, P.DATE).setValue('');
        plan.getRange(r.sheetRow, P.MEMO).setValue((tag + ' ' + r.memo).trim());
        runCalc_(false, { quick: true });   // 앞뒤 장소가 바로 이어지게 경로 다시 (배차 점검은 생략)
      } else {
        throw new Error('알 수 없는 수정: ' + op);
      }
    }
    SpreadsheetApp.flush();
    invalidateCache_();
  } finally {
    lock.releaseLock();
  }
  return getMapData();
}