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
