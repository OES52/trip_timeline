/* ───────────────────────── 관리용 시트 읽기·쓰기 ───────────────────────── */
// 홈랩 프록시 POST /api/admin (ADMIN_KEY 확인) → doPost {fn: 'admin', args: [요청], key: PROXY_KEY} → adminSheet_
//  Claude 같은 관리 도구가 시트를 직접 보고 고치는 통로. 화면(정적 페이지)은 이 함수를 못 부름 (프록시 /api/call 목록에 없음)
//
// 요청 { op, ... }
//  sheets                                   시트 목록 [{ name, rows, cols, frozenRows, frozenCols }]
//  read    { sheet, range?, formulas? }     값 읽기. range 없으면 데이터 있는 범위 전체
//                                            → { range, values(보이는 글자), formulas?(수식 칸만, 나머지 '') }
//  write   { sheet, range, values, edit? }  값 쓰기. range는 왼쪽 위 칸("B3")이나 전체("B3:D5"). '='로 시작하면 수식
//                                            edit !== false 면 손으로 고친 것처럼 onEdit 연동(장소 이름 바뀜·예산)도 돌림
//                                            → { range, before(쓰기 전 보이던 값), after }
//  append  { sheet, values, edit? }         마지막 줄 아래에 줄 추가 → write와 같음
//  clear   { sheet, range }                 내용만 지움 (서식 그대로) → { range, before }
//  insertRows { sheet, after, count? }      after번 줄 아래에 빈 줄 (after = 0이면 맨 위)
//  deleteRows { sheet, row, count? }        row번 줄부터 지움 → { before }
//  placePhoto { pid | query, lat?, lng?, count? }  구글 장소 사진 주소 (시트는 안 고침) → { pid, name, photos: [{ uri, by }] }
//  innerWalks { fetch? }                    관통 장소 시작점→종착점 도보 시간·거리 (fetch면 없는 곳만 구글에서 받아 저장)
//  끝나면 웹앱 캐시를 비움 (프록시는 돌려받은 뒤 알아서 다시 받음)
const ADMIN_MAX_CELLS_ = 50000;

function adminSheet_(req) {
  req = req || {};
  const ss = SpreadsheetApp.getActive();
  if (req.op === 'sheets') {
    return ss.getSheets().map(sh => ({
      name: sh.getName(), rows: sh.getLastRow(), cols: sh.getLastColumn(),
      frozenRows: sh.getFrozenRows(), frozenCols: sh.getFrozenColumns(),
    }));
  }
  if (req.op === 'placePhoto') return adminPlacePhoto_(req);
  if (req.op === 'innerWalks') return adminInnerWalks_(ss, !!req.fetch);
  const sh = ss.getSheetByName(String(req.sheet || ''));
  if (!sh) throw new Error('없는 시트: ' + req.sheet);

  if (req.op === 'read') {
    const rg = req.range ? sh.getRange(String(req.range)) : sh.getDataRange();
    adminLimit_(rg);
    const out = { range: rg.getA1Notation(), values: rg.getDisplayValues() };
    if (req.formulas) {
      const f = rg.getFormulas();
      if (f.some(r => r.some(Boolean))) out.formulas = f;
    }
    return out;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let out;
    if (req.op === 'write' || req.op === 'append') {
      const values = req.values;
      if (!Array.isArray(values) || !values.length || !values.every(r => Array.isArray(r) && r.length === values[0].length) || !values[0].length) {
        throw new Error('values는 줄 길이가 같은 2차원 배열이어야 함');
      }
      let rg;
      if (req.op === 'append') rg = sh.getRange(sh.getLastRow() + 1, 1, values.length, values[0].length);
      else {
        const top = sh.getRange(String(req.range || ''));
        rg = sh.getRange(top.getRow(), top.getColumn(), values.length, values[0].length);
        if (String(req.range).indexOf(':') !== -1 && (top.getNumRows() !== values.length || top.getNumColumns() !== values[0].length)) {
          throw new Error('범위 ' + top.getA1Notation() + '와 values 크기(' + values.length + '×' + values[0].length + ')가 다름');
        }
      }
      adminLimit_(rg);
      const before = rg.getDisplayValues();
      rg.setValues(values.map(r => r.map(v => (v == null ? '' : v))));
      SpreadsheetApp.flush();
      if (req.edit !== false) adminOnEdit_(ss, rg, before);
      out = { range: rg.getA1Notation(), before: before, after: rg.getDisplayValues() };
    } else if (req.op === 'clear') {
      const rg = sh.getRange(String(req.range || ''));
      adminLimit_(rg);
      const before = rg.getDisplayValues();
      rg.clearContent();
      out = { range: rg.getA1Notation(), before: before };
    } else if (req.op === 'insertRows') {
      const after = Number(req.after), n = Math.max(1, Number(req.count) || 1);
      if (!(after >= 0)) throw new Error('after 줄 번호가 필요함');
      if (after === 0) sh.insertRowsBefore(1, n); else sh.insertRowsAfter(after, n);
      out = { inserted: n, at: after + 1 };
    } else if (req.op === 'deleteRows') {
      const row = Number(req.row), n = Math.max(1, Number(req.count) || 1);
      if (!(row >= 1)) throw new Error('row 줄 번호가 필요함');
      const rg = sh.getRange(row, 1, n, Math.max(1, sh.getLastColumn()));
      const before = rg.getDisplayValues();
      sh.deleteRows(row, n);
      out = { deleted: n, before: before };
    } else {
      throw new Error('알 수 없는 op: ' + req.op);
    }
    invalidateCache_();
    return out;
  } finally {
    lock.releaseLock();
  }
}

// 종착점 있는 장소(시장·상점가 관통)의 시작점→종착점 도보 { row, date, order, place, stay, min, m, est, shaped }
//  fetch = true면 저장된 도보 경로가 없는 곳만 구글에서 받아 저장 (메뉴 "관통 도보 길만 받기"와 같음)
function adminInnerWalks_(ss, fetch) {
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  if (!plan) throw new Error('"일정" 시트가 없음');
  const out = [];
  readPlanRows_(plan, ss.getSpreadsheetTimeZone()).forEach(r => {
    const iw = innerWalk_(r, fetch);
    if (!iw) return;
    out.push({ row: r.sheetRow, date: r.date, order: r.order, place: r.place, stay: r.stay, min: iw.min, m: iw.m, est: iw.est, shaped: !!iw.poly });
  });
  if (fetch) invalidateCache_();
  return out;
}

// 구글 장소 사진 주소 받기 (시트는 안 고침. 받은 주소를 write로 사진 칸에 넣음)
//  { pid } 또는 { query, lat?, lng? } (pid 없으면 이름으로 찾음) → { pid, name, photos: [{ uri, by }] } 최대 count(기본 1)장
//  Places API: 장소 찾기(무료) + 상세 photos(유료 등급) + 사진 주소(장당 유료, 월 무료 한도 안)
function adminPlacePhoto_(req) {
  const key = PropertiesService.getScriptProperties().getProperty('PLACES_API_KEY');
  if (!key) throw new Error('Places API 키가 없음 (시트 메뉴 → Places API 키 설정)');
  let pid = String(req.pid || '');
  if (!pid) {
    if (!req.query) throw new Error('pid나 query가 필요함');
    pid = placesSearchId_(key, { name: String(req.query), lat: req.lat != null ? Number(req.lat) : null, lng: req.lng != null ? Number(req.lng) : null });
    if (!pid) throw new Error('구글에서 장소를 못 찾음: ' + req.query);
  }
  const res = UrlFetchApp.fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(pid) + '?languageCode=ko', {
    muteHttpExceptions: true,
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'displayName,photos' },
  });
  checkPlacesRes_(res);
  const det = JSON.parse(res.getContentText() || '{}');
  const n = Math.min(5, Math.max(1, Number(req.count) || 1));
  const photos = (det.photos || []).slice(0, n).map(ph => {
    const r = UrlFetchApp.fetch('https://places.googleapis.com/v1/' + ph.name + '/media?maxWidthPx=960&skipHttpRedirect=true', {
      muteHttpExceptions: true, headers: { 'X-Goog-Api-Key': key },
    });
    checkPlacesRes_(r);
    const j = JSON.parse(r.getContentText() || '{}');
    const by = (ph.authorAttributions || []).map(a => a.displayName).filter(Boolean).join(', ');
    return { uri: j.photoUri || '', by: by };
  }).filter(p => p.uri);
  return { pid: pid, name: det.displayName ? det.displayName.text : '', photos: photos };
}

function adminLimit_(rg) {
  if (rg.getNumRows() * rg.getNumColumns() > ADMIN_MAX_CELLS_) throw new Error('칸이 너무 많음 (최대 ' + ADMIN_MAX_CELLS_ + '칸). range를 좁힐 것');
}

// 손으로 고친 것과 같은 연동 (Budget.js onEdit: 장소 이름 바뀜, 예산 ID·금액, 통화)
//  스크립트가 쓴 값은 onEdit 트리거가 안 불려서 직접 부름. 오류는 토스트 대신 던짐
function adminOnEdit_(ss, rg, before) {
  const one = rg.getNumRows() === 1 && rg.getNumColumns() === 1;
  const err = [];
  onEdit({
    range: rg,
    source: { toast: msg => err.push(msg) },
    value: one ? rg.getValue() : undefined,
    oldValue: one ? before[0][0] : undefined,
  });
  if (err.length) throw new Error('값은 썼지만 연동 오류: ' + err.join(' / '));
}
