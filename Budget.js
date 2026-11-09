/* ───────────────────────── 예산 연동 ───────────────────────── */
/* Budget.gs  */
// 손으로 고칠 때마다 실행 (스크립트가 쓴 값에는 반응하지 않음)
function onEdit(e) {
  if (!e || !e.range) return;
  invalidateCache_();   // 시트를 손으로 고치면 웹앱이 바로 최신 내용 보게
  const sh = e.range.getSheet();
  const name = sh.getName();
  try {
    if (name === CONFIG.PLAN_SHEET) onPlanEdit_(sh, e.range);
    else if (name === CONFIG.BUDGET_SHEET) onBudgetEdit_(sh, e.range, e);
  } catch (err) {
    e.source.toast(String(err.message || err), '예산 연동 오류', 8);
  }
}

function onPlanEdit_(plan, range) {
  const c1 = range.getColumn();
  const c2 = range.getLastColumn();
  if (c1 <= P.PLACE && P.PLACE <= c2) onPlaceRenamed_(plan, range);
  const editedId = c1 <= P.BUDGET_ID && P.BUDGET_ID <= c2;
  const editedAmt = c1 <= P.AMOUNT && P.AMOUNT <= c2;
  if (!editedId && !editedAmt) return;

  const ss = plan.getParent();
  const budget = ss.getSheetByName(CONFIG.BUDGET_SHEET);
  if (!budget) return;

  const r1 = Math.max(range.getRow(), 2);
  const r2 = Math.min(range.getLastRow(), r1 + 49);  // 한 번에 최대 50행
  if (r2 < r1) return;
  const rate = getRate_(ss);
  const vals = plan.getRange(r1, 1, r2 - r1 + 1, PLAN_HEADERS.length).getValues();
  const created = [];

  vals.forEach((v, i) => {
    const row = r1 + i;
    const id = String(v[P.BUDGET_ID - 1]).trim();
    const amount = v[P.AMOUNT - 1];
    const hasAmount = amount !== '' && amount !== null;

    if (editedAmt && hasAmount) {
      if (id) {
        const b = findBudget_(budget, id);
        if (b) {
          budget.getRange(b.row, B.TOTAL).setValue(b.cur === CUR_YEN ? Math.round(Number(amount)) : yenToWon_(amount, rate));
          syncPlanAmounts_(plan, id, amount, row);
        }
      } else {
        const newId = createBudgetRow_(budget, budgetFromPlan_(v, row, amount, rate));
        plan.getRange(row, P.BUDGET_ID).setValue(newId);
        created.push(newId);
      }
    } else if (editedId && id) {
      const b = findBudget_(budget, id);
      if (b && b.total !== '') plan.getRange(row, P.AMOUNT).setValue(budgetYen_(b, rate));
    }
  });

  if (created.length) ss.toast('예산에 추가: ' + created.join(', '), '예산 연동', 4);
}

// 장소 이름을 바꾸면 예전 장소 좌표가 그대로 남아 경로·도감이 예전 곳을 가리킴
//  - 자동으로 채운 좌표(노란 칸)는 시작점·종착점 둘 다 지움 → 다음 경로 계산 때 새 이름·링크로 다시 찾음
//  - 지도 링크(시작·종착)가 남아 있으면 예전 장소 링크일 수 있어서 알림만
function onPlaceRenamed_(plan, range) {
  const r1 = Math.max(range.getRow(), 2);
  const n = Math.min(range.getLastRow(), r1 + 49) - r1 + 1;
  if (n < 1) return;
  const bgs = plan.getRange(r1, P.COORD, n, 1).getBackgrounds();
  const endBgs = plan.getRange(r1, P.END_COORD, n, 1).getBackgrounds();
  const links = plan.getRange(r1, P.LINK, n, 1).getDisplayValues();
  const endLinks = plan.getRange(r1, P.END_LINK, n, 1).getDisplayValues();
  const isAuto = b => String(b).toLowerCase() === CONFIG.COLOR_AUTO_COORD;
  const cleared = [], linked = [];
  bgs.forEach((b, i) => {
    let did = false;
    if (isAuto(b)) {
      plan.getRange(r1 + i, P.COORD).clearContent().setBackground(null).clearNote();
      did = true;
    }
    if (isAuto(endBgs[i][0])) {
      plan.getRange(r1 + i, P.END_COORD).clearContent().setBackground(null).clearNote();
      did = true;
    }
    if (did) cleared.push(r1 + i);
    if (links[i][0] || endLinks[i][0]) linked.push(r1 + i);
  });
  const msg = [];
  if (cleared.length) msg.push(cleared.join(', ') + '행 자동 좌표 지움 (경로 계산 때 다시 찾음)');
  if (linked.length) msg.push(linked.join(', ') + '행 지도 링크가 예전 장소 것이면 새 링크로 바꾸거나 지우기');
  if (msg.length) plan.getParent().toast(msg.join('\n'), '장소 이름 바뀜', 8);
}

function onBudgetEdit_(budget, range, e) {
  if (range.getLastRow() < 2) return;
  const c1 = range.getColumn(), c2 = range.getLastColumn();
  const curEdit = c1 <= B.CUR && B.CUR <= c2;
  if (c1 > B.TOTAL && !curEdit) return;  // 번호·날짜·비용·총 비용·통화 열만 감시

  const ss = budget.getParent();
  if (curEdit) onBudgetCurEdit_(budget, range, e, getRate_(ss));
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  assignMissingBudgetIds_(budget);

  const r1 = Math.max(range.getRow(), 2);
  const r2 = Math.min(range.getLastRow(), r1 + 49);
  if (!plan) return;
  const rate = getRate_(ss);
  const vals = budget.getRange(r1, 1, r2 - r1 + 1, B.TOTAL).getValues();
  vals.forEach(v => {
    const id = String(v[B.ID - 1]).trim();
    const total = v[B.TOTAL - 1];
    if (id && total !== '' && total !== null) syncPlanAmounts_(plan, id, budgetYen_({ total: total, cur: curOf_(v[B.CUR - 1]) }, rate), null);
  });
}

// 예산 행 총 비용 → 일정 시트용 엔화
function budgetYen_(b, rate) {
  return b.cur === CUR_YEN ? Math.round(Number(b.total)) : wonToYen_(b.total, rate);
}

// 통화 칸을 바꾸면: 금액 서식 맞추고, 한 칸만 바꾼 경우 총 비용을 환율로 바꿈 (함수 칸은 그대로)
function onBudgetCurEdit_(budget, range, e, rate) {
  const r1 = Math.max(range.getRow(), 2), r2 = Math.min(range.getLastRow(), r1 + 49);
  if (r2 < r1) return;
  const single = r1 === r2 && range.getNumColumns() === 1 && range.getColumn() === B.CUR;
  const msgs = [];
  for (let r = r1; r <= r2; r++) {
    const cell = budget.getRange(r, B.CUR);
    const raw = String(cell.getValue()).trim();
    const cur = raw === '' ? '' : (raw === '¥' || /^(엔|jpy|yen|円)$/i.test(raw)) ? CUR_YEN : CUR_WON;
    if (raw !== '' && raw !== cur) cell.setValue(cur);   // "엔", "jpy" 등을 기호로
    setBudgetRowFormat_(budget, r, cur || CUR_WON);
    if (!single || !e) continue;
    const before = curOf_(e.oldValue), after = cur || CUR_WON;   // 빈 칸 = 원화
    if (before === after) continue;
    const tCell = budget.getRange(r, B.TOTAL);
    if (tCell.getFormula()) continue;
    const t = tCell.getValue();
    if (t === '' || t === null || isNaN(t)) continue;
    const v = after === CUR_YEN ? wonToYen_(t, rate) : yenToWon_(t, rate);
    tCell.setValue(v);
    msgs.push(r + '행 ' + (after === CUR_YEN ? '₩' + Number(t).toLocaleString('en-US') + ' → ¥' : '¥' + Number(t).toLocaleString('en-US') + ' → ₩') + v.toLocaleString('en-US'));
  }
  if (msgs.length) budget.getParent().toast(msgs.join('\n') + '\n설정 시트 환율로 바꿈. 실제 결제 금액이 다르면 고치기', '통화 바뀜', 8);
}

function setBudgetRowFormat_(budget, row, cur) {
  const f = cur === CUR_YEN ? CONFIG.YEN_FORMAT : CONFIG.CURRENCY_FORMAT;
  budget.getRange(row, B.TOTAL).setNumberFormat(f);
  budget.getRange(row, B.PER).setNumberFormat(f);
}

// 메뉴: 전체 동기화 (예산 시트 금액 기준)
function syncBudget() {
  requireSheetUi_();
  invalidateCache_();
  const ss = SpreadsheetApp.getActive();
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  const budget = ss.getSheetByName(CONFIG.BUDGET_SHEET);
  if (!plan || !budget) { alert_('먼저 "시트 생성" 실행'); return; }

  const rate = getRate_(ss);
  const assigned = assignMissingBudgetIds_(budget);
  const map = {};
  readBudget_(budget).forEach(b => { if (b.id) map[b.id] = b; });

  const last = lastDataRow_(plan);
  const created = [];
  const updated = [];
  const missing = [];
  if (last >= 2) {
    const vals = plan.getRange(2, 1, last - 1, PLAN_HEADERS.length).getValues();
    vals.forEach((v, i) => {
      const row = i + 2;
      const id = String(v[P.BUDGET_ID - 1]).trim();
      const amount = v[P.AMOUNT - 1];
      if (id) {
        const b = map[id];
        if (!b) { missing.push(row + '행 ' + id); return; }
        if (b.total === '' || b.total === null) return;
        const yen = budgetYen_(b, rate);
        if (yen !== amount) {
          plan.getRange(row, P.AMOUNT).setValue(yen);
          updated.push(row + '행');
        }
      } else if (amount !== '' && amount !== null) {
        const newId = createBudgetRow_(budget, budgetFromPlan_(v, row, amount, rate));
        plan.getRange(row, P.BUDGET_ID).setValue(newId);
        created.push(newId);
      }
    });
  }

  const tr = syncTransportBudget_(ss);
  const lines = ['예산 동기화 완료'];
  if (tr.created.length) lines.push('교통비 행 추가: ' + tr.created.join(', '));
  if (assigned.length) lines.push('예산 시트 번호 부여: ' + assigned.join(', '));
  if (created.length) lines.push('일정에서 예산 추가: ' + created.join(', '));
  if (updated.length) lines.push('일정 금액을 예산 기준으로 수정: ' + updated.join(', '));
  if (missing.length) lines.push('예산에 없는 번호: ' + missing.join(', '));
  alert_(lines.join('\n'));
}

/* ── 예산 정리: 안 쓰는 항목 삭제 · 날짜를 일정에 맞춤 · 번호 다시 매기기 ── */

// 일정에서 금액을 입력해 자동으로 생긴 항목은 메모 끝이 "(¥1,500)" 형식
const AUTO_BUDGET_MEMO = /\(¥[\d,]+\)\s*$/;

// 메뉴: 예산 정리
//  - 삭제: 일정에 연결 안 된 자동 생성 항목, 일정에 없는 날짜의 "교통비 MM/DD" 행
//  - 유지: 일정에 연결된 항목, 직접 입력한 항목(숙소·항공처럼 메모가 자동 형식이 아닌 것)
//  - 연결된 항목의 날짜를 일정 날짜로 맞춤 (일정을 옮겨도 예산 날짜는 안 따라가서)
//  - 날짜 → 일정 순서 → 예전 번호 순으로 정렬해서 B001부터 다시 매기고, 일정 시트 예산 번호도 같이 바꿈
function cleanupBudget() {
  requireSheetUi_();
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  const budget = ss.getSheetByName(CONFIG.BUDGET_SHEET);
  if (!plan || !budget) { alert_('먼저 "시트 생성" 실행'); return; }
  const ssTz = ss.getSpreadsheetTimeZone();
  const fmt = d => d instanceof Date ? Utilities.formatDate(d, ssTz, 'yyyy-MM-dd') : '';

  // 1. 일정 시트: 예산 번호별 처음 나오는 행·날짜, 일정에 있는 날짜 목록
  const pLast = lastDataRow_(plan);
  const pn = Math.max(0, pLast - 1);
  const pIds = pn ? plan.getRange(2, P.BUDGET_ID, pn, 1).getValues() : [];
  const pDates = pn ? plan.getRange(2, P.DATE, pn, 1).getValues() : [];
  const pDisp = pn ? plan.getRange(2, P.DATE, pn, 1).getDisplayValues() : [];
  const links = {};
  const planDays = {};
  pIds.forEach((v, i) => {
    const d = pDates[i][0];
    const key = parseDateStr_(d, pDisp[i][0], ssTz);
    if (key && d instanceof Date) planDays[key] = true;
    const id = String(v[0]).trim();
    if (!id) return;
    const l = links[id] = links[id] || { first: i, date: null };
    if (!l.date && d instanceof Date) l.date = d;   // 건너뛴 행(일자 빈 칸)은 날짜 없음
  });

  // 2. 예산 시트 분류
  const bLast = lastBudgetRow_(budget);
  if (bLast < 2) { alert_('예산 시트가 비어 있음'); return; }
  const range = budget.getRange(2, 1, bLast - 1, BUDGET_HEADERS.length);
  const vals = range.getValues();
  const forms = range.getFormulas();
  const keep = [], drop = [], redated = [];
  vals.forEach((v, i) => {
    const id = String(v[B.ID - 1]).trim();
    const name = String(v[B.NAME - 1]).trim();
    const memo = String(v[B.MEMO - 1]);
    const total = v[B.TOTAL - 1];
    if (!id && !name && (total === '' || total === null)) return;   // 빈 줄
    const m = id.match(/^B(\d+)$/);
    const row = { v: v, f: forms[i], id: id, name: name, memo: memo, date: v[B.DATE - 1], kind: 'manual', order: -1, num: m ? Number(m[1]) : 1e9 + i };
    if (memo.indexOf(TRANSPORT_MARK) !== -1) {
      row.kind = 'transport';
      if (!planDays[fmt(row.date)]) { drop.push(row); return; }
      row.order = 1e6;   // 그날 맨 끝
    } else if (id && links[id]) {
      row.kind = 'linked';
      row.order = links[id].first;
      const pd = links[id].date;
      if (pd && fmt(pd) !== fmt(row.date)) {
        redated.push(id + ' ' + name + ': ' + (fmt(row.date) || '날짜 없음') + ' → ' + fmt(pd));
        row.date = pd;
      }
    } else if (AUTO_BUDGET_MEMO.test(memo)) {
      drop.push(row);
      return;
    }
    keep.push(row);
  });

  // 3. 정렬 후 새 번호
  keep.sort((a, b) => {
    const da = fmt(a.date) || '9999-99-99', db = fmt(b.date) || '9999-99-99';
    return da < db ? -1 : da > db ? 1 : (a.order - b.order) || (a.num - b.num);
  });
  const remap = {};
  keep.forEach((r, i) => { r.newId = budgetIdFrom_(i + 1); if (r.id) remap[r.id] = r.newId; });
  const renum = keep.filter(r => r.id !== r.newId);
  const missing = Object.keys(links).filter(id => !keep.some(r => r.id === id));

  if (!drop.length && !redated.length && !renum.length) {
    alert_('정리할 것 없음' + (missing.length ? '\n일정에 있는데 예산에 없는 번호: ' + missing.join(', ') : ''));
    return;
  }

  // 4. 확인
  const lines = [];
  if (drop.length) {
    lines.push('삭제 ' + drop.length + '건:\n- ' + drop.map(r =>
      (r.id || '(번호 없음)') + ' ' + r.name + (r.kind === 'transport' ? ' (일정에 없는 날짜)' : (r.memo ? ' / ' + r.memo : ''))).join('\n- '));
  }
  if (redated.length) lines.push('날짜를 일정에 맞춤 ' + redated.length + '건:\n- ' + redated.join('\n- '));
  if (renum.length) lines.push('번호 다시 매김: ' + keep.length + '개를 날짜·일정 순서대로 B001부터 (일정 시트 예산 번호도 같이 바뀜)');
  if (missing.length) lines.push('일정에 있는데 예산에 없는 번호 (그대로 둠): ' + missing.join(', '));
  lines.push('일정에 연결 안 된 직접 입력 항목(숙소·항공 등)은 그대로 둠');
  const ok = ui.alert('예산 정리', lines.join('\n\n') + '\n\n계속할까? (되돌리려면 파일 → 버전 기록)', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  // 5. 예산 시트 다시 쓰기 (1인당 비용 열은 행마다 함수라 안 건드림)
  const out = keep.map(r => {
    const v = r.v.slice();
    v[B.ID - 1] = r.newId;
    v[B.DATE - 1] = r.date;
    v[B.TOTAL - 1] = r.kind === 'transport' ? '' : (r.f[B.TOTAL - 1] || v[B.TOTAL - 1]);   // 교통비 함수는 아래에서 다시 씀
    v[B.PAID - 1] = v[B.PAID - 1] === true;
    return v;
  });
  const rows = bLast - 1;
  budget.getRange(2, B.ID, rows, B.PEOPLE).clearContent();
  budget.getRange(2, B.MEMO, rows, 1).clearContent();
  budget.getRange(2, B.CUR, rows, 1).clearContent();
  if (out.length) {
    budget.getRange(2, B.ID, out.length, B.PEOPLE).setValues(out.map(v => v.slice(0, B.PEOPLE)));
    budget.getRange(2, B.MEMO, out.length, 1).setValues(out.map(v => [v[B.MEMO - 1]]));
    budget.getRange(2, B.CUR, out.length, 1).setValues(out.map(v => [v[B.CUR - 1] || '']));
    out.forEach((v, i) => setBudgetRowFormat_(budget, i + 2, curOf_(v[B.CUR - 1])));
  }

  // 6. 일정 시트 예산 번호 바꾸기
  if (pn) {
    plan.getRange(2, P.BUDGET_ID, pn, 1).setValues(pIds.map(v => {
      const id = String(v[0]).trim();
      return [id && remap[id] ? remap[id] : v[0]];
    }));
  }

  // 7. 교통비 행 함수 다시 쓰기 (행 위치가 바뀌어서)
  syncTransportBudget_(ss);
  invalidateCache_();
  alert_('예산 정리 완료\n삭제 ' + drop.length + '건, 날짜 맞춤 ' + redated.length + '건, 번호 ' + keep.length + '개 다시 매김');
}

// 메뉴: 교통비 예산 반영
function syncTransportBudget() {
  requireSheetUi_();
  invalidateCache_();
  const r = syncTransportBudget_(SpreadsheetApp.getActive());
  alert_(r.created.length ? '교통비 행 추가: ' + r.created.join(', ') : '교통비 행이 이미 모두 있음. 금액은 일정 시트와 자동 연동');
}

// 일정에 있는 날짜마다 예산 시트에 "교통비 MM/DD" 행 하나. 총 비용은 함수로 일정 시트 교통비 합계와 연동
function syncTransportBudget_(ss) {
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  const budget = ss.getSheetByName(CONFIG.BUDGET_SHEET);
  const created = [];
  if (!plan || !budget) return { created: created };

  const last = lastDataRow_(plan);
  if (last < 2) return { created: created };
  const ssTz = ss.getSpreadsheetTimeZone();
  const vals = plan.getRange(2, P.DATE, last - 1, 1).getValues();
  const disp = plan.getRange(2, P.DATE, last - 1, 1).getDisplayValues();
  const dates = {};
  vals.forEach((v, i) => {
    const key = parseDateStr_(v[0], disp[i][0], ssTz);
    if (key && v[0] instanceof Date && !dates[key]) dates[key] = v[0];
  });

  const existing = {};
  readBudget_(budget).forEach(b => {
    if (b.memo.indexOf(TRANSPORT_MARK) === -1) return;
    const d = budget.getRange(b.row, B.DATE).getValue();
    const key = d instanceof Date ? Utilities.formatDate(d, ssTz, 'yyyy-MM-dd') : '';
    if (key) existing[key] = b;
  });

  const planName = "'" + CONFIG.PLAN_SHEET + "'!";
  const fareCol = planName + '$' + colL_(P.FARE) + ':$' + colL_(P.FARE);
  const dateCol = planName + '$' + colL_(P.DATE) + ':$' + colL_(P.DATE);
  const formula = row =>
    '=ROUND(SUMIFS(' + fareCol + ',' + dateCol + ',$' + colL_(B.DATE) + row + ')*N($' + colL_(B.PEOPLE) + row + '))';

  Object.keys(dates).sort().forEach(key => {
    const b = existing[key];
    if (b) {
      budget.getRange(b.row, B.TOTAL).setFormula(formula(b.row));  // 직접 고친 경우 함수로 되돌림
      budget.getRange(b.row, B.CUR).setValue(CUR_YEN);
      budget.getRange(b.row, B.MEMO).setValue(TRANSPORT_MARK + ' 일정 시트 교통비(¥) 합계 × 인원수. 직접 수정하지 말 것');
      setBudgetRowFormat_(budget, b.row, CUR_YEN);
      return;
    }
    const list = readBudget_(budget);
    const id = budgetIdFrom_(maxBudgetNum_(list) + 1);
    const row = lastBudgetRow_(budget) + 1;
    if (row > budget.getMaxRows()) budget.insertRowsAfter(budget.getMaxRows(), 20);
    budget.getRange(row, B.PAID).insertCheckboxes();
    budget.getRange(row, B.ID, 1, 3).setValues([[id, dates[key], '교통비 ' + key.slice(5).replace('-', '/')]]);
    budget.getRange(row, B.TOTAL).setFormula(formula(row));
    budget.getRange(row, B.PEOPLE).setValue(readSettings_().travelers);
    budget.getRange(row, B.PER).setFormula(budgetPerFormula_(row));
    budget.getRange(row, B.MEMO).setValue(TRANSPORT_MARK + ' 일정 시트 교통비(¥) 합계 × 인원수. 직접 수정하지 말 것');
    budget.getRange(row, B.CUR).setValue(CUR_YEN);
    setBudgetRowFormat_(budget, row, CUR_YEN);
    created.push(id);
  });
  return { created: created };
}

// 일정 행 → 새 예산 항목 (일본에서 쓰는 돈이라 엔화 그대로. 메모 끝 "(¥1,500)"은 예산 정리에서 자동 항목 표시)
function budgetFromPlan_(v, row, yen, rate) {
  const place = String(v[P.PLACE - 1]).trim();
  const yenText = '¥' + Number(yen).toLocaleString('en-US');
  return {
    date: v[P.DATE - 1],
    name: String(v[P.ACTIVITY - 1]).trim() || place || '일정 ' + row + '행',
    total: Math.round(Number(yen)),
    cur: CUR_YEN,
    people: readSettings_().defaultPeople,
    memo: place ? place + ' (' + yenText + ')' : yenText,
  };
}

function readBudget_(budget) {
  const last = lastBudgetRow_(budget);
  if (last < 2) return [];
  const vals = budget.getRange(2, 1, last - 1, BUDGET_HEADERS.length).getValues();
  return vals.map((v, i) => ({
    row: i + 2,
    id: String(v[B.ID - 1]).trim(),
    name: String(v[B.NAME - 1]).trim(),
    total: v[B.TOTAL - 1],
    paid: v[B.PAID - 1] === true,
    people: v[B.PEOPLE - 1],
    per: v[B.PER - 1],
    memo: String(v[B.MEMO - 1]),
    cur: curOf_(v[B.CUR - 1]),
  }));
}

function findBudget_(budget, id) {
  const list = readBudget_(budget);
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

// 비용이나 총 비용이 있는데 번호가 없는 예산 행에 번호 부여
function assignMissingBudgetIds_(budget) {
  const list = readBudget_(budget);
  let next = maxBudgetNum_(list);
  const assigned = [];
  list.forEach(b => {
    if (b.id) return;
    if (!b.name && (b.total === '' || b.total === null)) return;
    next++;
    const id = budgetIdFrom_(next);
    budget.getRange(b.row, B.ID).setValue(id);
    assigned.push(id);
  });
  return assigned;
}

function createBudgetRow_(budget, data) {
  const list = readBudget_(budget);
  const id = budgetIdFrom_(maxBudgetNum_(list) + 1);
  const row = lastBudgetRow_(budget) + 1;
  if (row > budget.getMaxRows()) budget.insertRowsAfter(budget.getMaxRows(), 20);

  budget.getRange(row, B.PAID).insertCheckboxes();
  budget.getRange(row, B.ID, 1, 4).setValues([[id, data.date || '', data.name, data.total]]);
  budget.getRange(row, B.PEOPLE).setValue(data.people || '');
  budget.getRange(row, B.PER).setFormula(budgetPerFormula_(row));
  if (data.memo) budget.getRange(row, B.MEMO).setValue(data.memo);
  budget.getRange(row, B.CUR).setValue(data.cur || CUR_WON);
  setBudgetRowFormat_(budget, row, data.cur || CUR_WON);
  return id;
}

// 같은 번호가 연결된 일정 행 금액을 모두 맞춤 (skipRow는 방금 사람이 고친 행)
// 예산 번호·금액 열이 떨어져 있어서 따로 읽음
function syncPlanAmounts_(plan, id, total, skipRow) {
  const last = lastDataRow_(plan);
  if (last < 2) return;
  const ids = plan.getRange(2, P.BUDGET_ID, last - 1, 1).getValues();
  const amts = plan.getRange(2, P.AMOUNT, last - 1, 1).getValues();
  ids.forEach((v, i) => {
    const row = i + 2;
    if (row === skipRow) return;
    if (String(v[0]).trim() === id && amts[i][0] !== total) plan.getRange(row, P.AMOUNT).setValue(total);
  });
}

function maxBudgetNum_(list) {
  let max = 0;
  list.forEach(b => {
    const m = String(b.id).match(/^B(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

function budgetIdFrom_(n) { return 'B' + String(n).padStart(3, '0'); }

// 1인당 비용 함수가 전체 행에 있어서 getLastRow()는 못 씀. 번호·비용·총 비용이 있는 마지막 행
function lastBudgetRow_(sh) {
  const max = sh.getMaxRows();
  if (max < 2) return 1;
  const v = sh.getRange(2, 1, max - 1, B.TOTAL).getDisplayValues();
  for (let i = v.length - 1; i >= 0; i--) {
    if (v[i][B.ID - 1] !== '' || v[i][B.NAME - 1] !== '' || v[i][B.TOTAL - 1] !== '') return i + 2;
  }
  return 1;
}

/* ── 메뉴: 예산 통화 정리 (한 번만) ──
 *  예전엔 예산 시트가 전부 원화였음 → 통화 칸(¥/₩)을 만들고
 *  - 일정에서 금액 입력해 생긴 항목(메모 끝 "(¥1,500)") → 엔화, 총 비용은 메모의 원래 엔화 금액 그대로
 *  - 교통비 행 → 엔화 (일정 교통비 합계 × 인원수)
 *  - 직접 입력한 항목(항공·숙소 등 한국에서 미리 결제) → 원화 그대로
 *  - 일정 시트 1인당 칸 함수를 통화에 맞게 다시 씀
 *  다르게 분류된 행은 통화 칸만 바꾸면 금액도 환율로 바뀜 */
function migrateBudgetCurrency() {
  requireSheetUi_();
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  const budget = ss.getSheetByName(CONFIG.BUDGET_SHEET);
  if (!plan || !budget) { alert_('먼저 "시트 생성" 실행'); return; }
  ensureColumns_(budget, BUDGET_HEADERS.length);
  budget.getRange(1, B.CUR).setValue('통화').setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_INPUT)
    .setNote('¥ = 일본에서 쓰는 돈(엔화), ₩ = 한국에서 미리 결제(원화). 바꾸면 총 비용도 환율로 바뀜');
  budget.setColumnWidth(B.CUR, 50);

  const list = readBudget_(budget);
  const raw = list.length ? budget.getRange(2, B.CUR, list.length, 1).getValues() : [];
  const forms = list.length ? budget.getRange(2, B.TOTAL, list.length, 1).getFormulas() : [];
  const toYen = [], toWon = [];
  list.forEach((b, i) => {
    if (String(raw[i][0]).trim()) return;                       // 이미 정함
    if (!b.id && !b.name && (b.total === '' || b.total === null)) return;
    if (b.memo.indexOf(TRANSPORT_MARK) !== -1) return;          // 교통비는 아래에서
    const m = b.memo.match(/\(¥([\d,]+)\)\s*$/);
    if (m && !forms[i][0]) toYen.push({ b: b, yen: Number(m[1].replace(/,/g, '')) });
    else toWon.push(b);
  });
  const name = b => (b.id || '') + ' ' + b.name;
  const ok = ui.alert('예산 통화 정리',
    '엔화(¥)로 바꿈 ' + toYen.length + '건 (일정에서 입력한 금액, 원래 엔화 금액으로):\n- ' + (toYen.map(x => name(x.b) + ' ¥' + x.yen.toLocaleString('en-US')).join('\n- ') || '없음') +
    '\n\n원화(₩) 그대로 ' + toWon.length + '건 (직접 입력, 한국에서 미리 결제로 봄):\n- ' + (toWon.map(name).join('\n- ') || '없음') +
    '\n\n교통비 행은 엔화로 다시 계산.\n잘못 분류된 건 나중에 통화 칸만 바꾸면 금액도 환율로 바뀜.\n\n계속할까? (되돌리려면 파일 → 버전 기록)', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  toYen.forEach(x => {
    budget.getRange(x.b.row, B.TOTAL).setValue(x.yen);
    budget.getRange(x.b.row, B.CUR).setValue(CUR_YEN);
    setBudgetRowFormat_(budget, x.b.row, CUR_YEN);
  });
  toWon.forEach(b => {
    budget.getRange(b.row, B.CUR).setValue(CUR_WON);
    setBudgetRowFormat_(budget, b.row, CUR_WON);
  });
  // 통화 칸 고르기 목록
  const rows = budget.getMaxRows() - 1;
  budget.getRange(2, B.CUR, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList([CUR_YEN, CUR_WON], true).setAllowInvalid(true).build()).setHorizontalAlignment('center');
  syncTransportBudget_(ss);
  rewritePlanPerFormulas_(plan);
  invalidateCache_();
  alert_('예산 통화 정리 완료\n엔화 ' + toYen.length + '건, 원화 ' + toWon.length + '건, 교통비 행은 엔화');
}

// 일정 시트 "1인당" 칸: 예산이 엔화면 그대로, 원화면 환율로 나눔
function rewritePlanPerFormulas_(plan) {
  const rows = plan.getMaxRows() - 1;
  const out = [];
  for (let r = 2; r <= rows + 1; r++) out.push([planPerFormula_(r)]);
  plan.getRange(2, P.PER, rows, 1).setFormulas(out);
  plan.getRange(1, P.PER).setNote('예산 시트 1인당 비용을 엔화로 (원화 항목은 설정 시트 환율로 나눔)');
}
