/* ───────────────────────── 메뉴 ───────────────────────── */
/* Setup.gs  */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('여행 도구')
    .addItem('시트 생성', 'setupSheets')
    .addItem('시트 구조 업데이트 (기존 시트용)', 'updateSheetStructure')
    .addItem('샘플 데이터 넣기', 'insertSampleData')
    .addSeparator()
    .addItem('경로 계산', 'calculateRoutes')
    .addItem('경로 계산 (캐시 무시)', 'calculateRoutesForce')
    .addSeparator()
    .addItem('예산 동기화', 'syncBudget')
    .addItem('교통비 예산 반영', 'syncTransportBudget')
    .addItem('예산 정리 (안 쓰는 항목 삭제·번호 다시 매기기)', 'cleanupBudget')
    .addSeparator()
    .addItem('장소 가이드 갱신', 'refreshPlaceGuide')
    .addItem('장소 정리 (안 쓰는 장소·중복 삭제)', 'cleanupPlaces')
    .addItem('영업시간 채우기 (Places API, 빈 칸만)', 'fillOpeningHours')
    .addItem('영업시간 다시 받기 (자동으로 채운 칸만)', 'refreshOpeningHours')
    .addItem('Places API 키 설정', 'setPlacesKey')
    .addSeparator()
    .addItem('지도 열기', 'showMapLink')
    .addItem('웹앱 캐시 비우기', 'clearWebCache')
    .addToUi();
}

/* ───────────────────────── 시트 생성 ───────────────────────── */

function setupSheets() {
  requireSheetUi_();
  const ss = SpreadsheetApp.getActive();
  const created = [];

  if (setupSettings_(ss)) created.push(CONFIG.SETTINGS_SHEET);
  ensureSettingsExtra_(ss);

  // 일정 시트의 예산 번호 드롭다운이 예산 시트를 참조하므로 예산 먼저
  let budget = ss.getSheetByName(CONFIG.BUDGET_SHEET);
  if (!budget) {
    budget = ss.insertSheet(CONFIG.BUDGET_SHEET);
    buildBudgetSheet_(budget);
    created.push(CONFIG.BUDGET_SHEET);
  }
  let plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  if (!plan) {
    plan = ss.insertSheet(CONFIG.PLAN_SHEET);
    ensureColumns_(plan, PLAN_HEADERS.length);
    applyPlanFormat_(plan, true);
    created.push(CONFIG.PLAN_SHEET);
  }
  let route = ss.getSheetByName(CONFIG.ROUTE_SHEET);
  if (!route) {
    route = ss.insertSheet(CONFIG.ROUTE_SHEET);
    buildRouteSheet_(route);
    created.push(CONFIG.ROUTE_SHEET);
  }
  if (!ss.getSheetByName(CONFIG.PLACE_SHEET)) {
    buildPlaceSheet_(ss.insertSheet(CONFIG.PLACE_SHEET));
    created.push(CONFIG.PLACE_SHEET);
  }
  if (!ss.getSheetByName(CONFIG.SPEND_SHEET)) {
    buildSpendSheet_(ss.insertSheet(CONFIG.SPEND_SHEET));
    created.push(CONFIG.SPEND_SHEET);
  }

  alert_(created.length
    ? '생성 완료: ' + created.join(', ')
    : '"일정", "경로", "예산" 시트가 이미 있음. 예전 구성이면 "시트 구조 업데이트" 실행');
}

// 예전 구성으로 만든 일정 시트를 새 구성으로 바꿈
function updateSheetStructure() {
  requireSheetUi_();
  const ss = SpreadsheetApp.getActive();
  setupSettings_(ss);
  ensureSettingsExtra_(ss);
  invalidateCache_();
  let budget = ss.getSheetByName(CONFIG.BUDGET_SHEET);
  if (!budget) {
    budget = ss.insertSheet(CONFIG.BUDGET_SHEET);
    buildBudgetSheet_(budget);
  }

  const sh = ss.getSheetByName(CONFIG.PLAN_SHEET);
  if (!sh) { alert_('"일정" 시트가 없음. "시트 생성" 먼저 실행'); return; }

  // 1. 4차 열 이름이 하나라도 없으면 아주 예전 구성(1~3차)으로 보고 4차까지 올림
  // 2. 그 뒤 새로 생긴 열(종착 지도 링크 등)이 없으면 오른쪽 끝에 추가
  // 3. 열 이름 기준으로 PLAN_HEADERS 순서로 옮김 (중간에 빈 열이 끼어 있어도 오른쪽 끝으로 밀려남)
  const h = c => hn_(sh.getRange(1, c).getDisplayValue());
  const names = () => sh.getRange(1, 1, 1, sh.getMaxColumns()).getDisplayValues()[0].map(hn_);
  const hasAllV4 = () => PLAN_HEADERS_V4.every(name => names().indexOf(hn_(name)) !== -1);
  if (!hasAllV4()) {
    if (h(12) === hn_('도착 시각') && h(5) === hn_('지도 링크')) sh.insertColumnsBefore(12, 3);   // 1차 → 3차
    else if (h(12) === hn_('이동(분)') && h(5) === hn_('지도 링크')) sh.insertColumnsBefore(12, 2); // 2차 → 3차
    if (h(12) === hn_('예산 번호') && h(14) === hn_('이동(분)')) {                                 // 3차 → 4차 (교통비)
      sh.insertColumnsBefore(14, 1);   // 수동 교통비
      sh.insertColumnsBefore(16, 2);   // API 요금, 교통비
    }
    if (h(12) !== hn_('예산 번호') || h(5) !== hn_('지도 링크')) {
      alert_('알 수 없는 열 구성. 1행 열 이름을 확인할 것\n없는 열: ' + PLAN_HEADERS_V4.filter(n => names().indexOf(hn_(n)) === -1).join(', '));
      return;
    }
    ensureColumns_(sh, PLAN_HEADERS_V4.length);
    sh.getRange(1, 1, 1, PLAN_HEADERS_V4.length).setValues([PLAN_HEADERS_V4]);
  }
  const added = addMissingPlanHeaders_(sh);                          // 새 열 (종착 지도 링크·종착 좌표 등)
  if (!planHeaderIsCurrent_(sh)) reorderPlanColumns_(sh);            // 열 재배치
  const route = ss.getSheetByName(CONFIG.ROUTE_SHEET);
  if (route) ensureRouteHeader_(route);
  if (!ss.getSheetByName(CONFIG.PLACE_SHEET)) buildPlaceSheet_(ss.insertSheet(CONFIG.PLACE_SHEET));
  else ensurePlaceHeader_(ss.getSheetByName(CONFIG.PLACE_SHEET));
  if (!ss.getSheetByName(CONFIG.SPEND_SHEET)) buildSpendSheet_(ss.insertSheet(CONFIG.SPEND_SHEET));
  ensureColumns_(sh, PLAN_HEADERS.length);
  applyPlanFormat_(sh, false);
  alert_('업데이트 완료.' + (added.length ? '\n새 열 추가: ' + added.join(', ') : '') +
    '\n"경로 계산 (캐시 무시)"를 한 번 실행하면 이동(분)·요금이 다시 채워짐\n환율은 "설정" 시트 B1에서 확인·수정');
}

// PLAN_HEADERS 중 시트에 없는 열을 마지막 열 이름 오른쪽에 추가. 추가한 열 이름 목록 반환
function addMissingPlanHeaders_(sh) {
  const row = sh.getRange(1, 1, 1, sh.getMaxColumns()).getDisplayValues()[0];
  const have = row.map(hn_);
  const missing = PLAN_HEADERS.filter(name => have.indexOf(hn_(name)) === -1);
  if (!missing.length) return [];
  const lastUsed = row.reduce((m, v, i) => v !== '' ? i + 1 : m, 0);
  ensureColumns_(sh, lastUsed + missing.length);
  missing.forEach((name, i) => {
    const key = Object.keys(P).find(k => PLAN_HEADERS[P[k] - 1] === name);
    sh.getRange(1, lastUsed + 1 + i).setValue(name)
      .setFontWeight('bold').setFontColor('#ffffff')
      .setBackground(PLAN_AUTO_KEYS.indexOf(key) !== -1 ? CONFIG.COLOR_HEADER_AUTO : CONFIG.COLOR_HEADER_INPUT);
    sh.getRange(2, lastUsed + 1 + i, sh.getMaxRows() - 1, 1).clearDataValidations();
  });
  return missing;
}

function planHeaderIsCurrent_(sh) {
  if (sh.getMaxColumns() < PLAN_HEADERS.length) return false;
  const row = sh.getRange(1, 1, 1, PLAN_HEADERS.length).getDisplayValues()[0];
  return PLAN_HEADERS.every((name, i) => hn_(row[i]) === hn_(name));
}

// 헤더 이름 기준으로 열을 PLAN_HEADERS 순서로 옮김 (값·서식·노트 같이 이동)
function reorderPlanColumns_(sh) {
  for (let i = 1; i <= PLAN_HEADERS.length; i++) {
    const row = sh.getRange(1, 1, 1, sh.getMaxColumns()).getDisplayValues()[0];
    const j = row.map(hn_).indexOf(hn_(PLAN_HEADERS[i - 1]), i - 1) + 1;
    if (j === 0) throw new Error('열 "' + PLAN_HEADERS[i - 1] + '"을 못 찾음');
    if (j !== i) sh.moveColumns(sh.getRange(colL_(j) + ':' + colL_(j)), i);
  }
}

// fresh=true: 새로 만든 시트라 색·너비·고정까지 전부 / false: 업데이트라 동작에 필요한 것만 (꾸민 모양은 유지)
function applyPlanFormat_(sh, fresh) {
  const n = PLAN_HEADERS.length;
  const rows = sh.getMaxRows() - 1;
  const budget = SpreadsheetApp.getActive().getSheetByName(CONFIG.BUDGET_SHEET);

  // 헤더 이름: 같으면(줄바꿈만 다르면) 그대로, 다르거나 새로 생긴 칸만 이름·헤더 모양 적용
  const cur = sh.getRange(1, 1, 1, n).getDisplayValues()[0];
  PLAN_HEADERS.forEach((name, i) => {
    if (!fresh && hn_(cur[i]) === hn_(name)) return;
    const cell = sh.getRange(1, i + 1).setValue(name).setFontWeight('bold').setFontColor('#ffffff');
    const key = Object.keys(P).find(k => P[k] === i + 1);
    cell.setBackground(PLAN_AUTO_KEYS.indexOf(key) !== -1 ? CONFIG.COLOR_HEADER_AUTO : CONFIG.COLOR_HEADER_INPUT);
  });
  if (fresh) {
    PLAN_AUTO_KEYS.forEach(k => sh.getRange(2, P[k], rows, 1).setBackground(CONFIG.COLOR_AUTO));
    sh.setFrozenRows(1);
    // 참고·연결 열 시작 위치에 구분선
    sh.getRange(1, P.LINK, rows + 1, 1)
      .setBorder(null, true, null, null, null, null, '#5d6b7d', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  sh.getRange(2, P.DATE, rows, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, P.FIXED, rows, 1).setNumberFormat('hh:mm');
  sh.getRange(2, P.COORD, rows, 1).setNumberFormat('@');
  sh.getRange(2, P.END_COORD, rows, 1).setNumberFormat('@');
  sh.getRange(2, P.BUDGET_ID, rows, 1).setNumberFormat('@');
  ['AMOUNT', 'MANUAL_FARE', 'FARE_API', 'FARE', 'PER'].forEach(k =>
    sh.getRange(2, P[k], rows, 1).setNumberFormat(CONFIG.YEN_FORMAT));
  sh.getRange(2, P.MOVE, rows, 1).setNumberFormat('0');
  sh.getRange(2, P.BUFFER, rows, 1).setNumberFormat('+0;-0;""');
  sh.getRange(2, P.SLACK, rows, 1).setNumberFormat('0');
  sh.getRange(2, P.ARRIVE, rows, 1).setNumberFormat('[h]:mm');
  sh.getRange(2, P.DEPART, rows, 1).setNumberFormat('[h]:mm');

  const modeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.MODES, true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, P.MODE, rows, 1).setDataValidation(modeRule);

  if (budget) {
    const idRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(budget.getRange(2, B.ID, budget.getMaxRows() - 1, 1), true)
      .setAllowInvalid(false)
      .build();
    sh.getRange(2, P.BUDGET_ID, rows, 1).setDataValidation(idRule);
  }

  const slackRule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(0)
    .setBackground('#f8d7da')
    .setFontColor('#b3261e')
    .setRanges([sh.getRange(2, P.SLACK, rows, 1)])
    .build();
  const unpaidRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('미결제')
    .setFontColor('#b3261e')
    .setRanges([sh.getRange(2, P.PAID, rows, 1)])
    .build();
  sh.setConditionalFormatRules([slackRule, unpaidRule]);

  writePlanFormulas_(sh);

  const widths = {
    DATE: 95, ORDER: 45, ACTIVITY: 170, PLACE: 190, STAY: 65, FIXED: 70, MODE: 95, MANUAL: 90,
    MANUAL_FARE: 100, AMOUNT: 90, MEMO: 200, ARRIVE: 70, DEPART: 70, SLACK: 65, MOVE: 60, BUFFER: 60,
    FARE: 80, PER: 85, LINK: 120, COORD: 150, END_LINK: 120, END_COORD: 150, BUDGET_ID: 75, PAID: 60, FARE_API: 90,
  };
  if (fresh) Object.keys(widths).forEach(k => sh.setColumnWidth(P[k], widths[k]));

  sh.getRange(1, P.PLACE).setNote('사람이 보는 이름. 좌표·지도 링크가 비어 있으면 이 이름으로 위치를 검색함');
  sh.getRange(1, P.LINK).setNote('선택. 이 장소에 도착하는 지점(시작점)의 구글 지도 링크. 좌표가 비어 있으면 여기서 좌표를 뽑음');
  sh.getRange(1, P.COORD).setNote('시작점. 형식: 위도,경도\n비어 있으면 스크립트가 지도 링크 → 장소명 순서로 찾아서 채움\n노란색 = 자동으로 채운 값. 위치가 맞는지 한 번 확인할 것');
  sh.getRange(1, P.END_LINK).setNote('선택. 이 장소를 떠나는 지점(종착점)의 구글 지도 링크\n시장·상점가를 관통해서 들어간 곳과 나오는 곳이 다를 때만 입력\n비우면 시작점에서 다음 장소로 출발');
  sh.getRange(1, P.END_COORD).setNote('종착점. 형식: 위도,경도\n비어 있고 종착 지도 링크가 있으면 링크에서 뽑아서 채움 (장소명 검색은 안 함)\n체류(분)에 시작점→종착점 걷는 시간까지 포함해서 넣기');
  sh.getRange(1, P.FIXED).setNote('비행기·버스·예약처럼 시각이 정해진 행만 입력\n그날 첫 행에 넣으면 그 시각부터 하루 계산 시작 (비우면 ' + CONFIG.DEFAULT_START + ')');
  sh.getRange(1, P.MODE).setNote('이 장소에서 다음 장소로 갈 때의 수단\n그날 마지막 행은 비워둠');
  sh.getRange(1, P.MEMO).setNote('[고정] → 경로 계산 때 순서 제안에서 이 행 위치를 안 바꿈 (짐 맡기기·찾기, 체크아웃 등)\n[노선:난카이] → 수동 구간 지도 선을 그 노선 지나는 모양으로');
  sh.getRange(1, P.MANUAL).setNote('다음 이동수단이 "수동"일 때만 입력 (비행기 등 경로 계산이 안 되는 구간)\n입력 즉시 아래 행 시각에 반영됨');
  sh.getRange(1, P.MANUAL_FARE).setNote('이 장소 → 다음 장소 구간의 1인 교통비. 넣으면 API 요금 대신 이 값을 씀\n수동 구간(공항철도, 택시 등)이나 API 요금이 비었을 때 입력');
  sh.getRange(1, P.AMOUNT).setNote('엔화 총액. 예산 시트에는 설정 시트 환율로 바꾼 원화로 들어감\n번호가 연결돼 있으면 여기서 고친 금액이 예산 시트에도 반영됨\n번호 없이 입력하면 예산 시트에 새 항목이 생기고 예산 번호가 채워짐');
  sh.getRange(1, P.ARRIVE).setNote('함수로 자동 계산. 직접 입력하지 말 것\n자정 넘으면 25:10처럼 표시');
  sh.getRange(1, P.SLACK).setNote('고정 시각 - 도착 시각. 마이너스면 늦음');
  sh.getRange(1, P.MOVE).setNote('다음 장소까지 이동 시간 (구글 경로 원래 값). "경로 계산" 실행 때 채워짐\n수동 구간은 비어 있고 수동 소요(분)가 대신 쓰임\n도착 시각 계산에는 ' + CONFIG.ROUND_MIN + '분 단위로 올린 값이 쓰임 (13 → 15)');
  sh.getRange(1, P.BUFFER).setNote('올림으로 생긴 여유 (분)\n= 이 장소로 오는 이동 올림분 + 이 장소 출발 시각 올림분\n예) 이동 13→15분(+2), 출발 14:36→14:40(+4) → +6\n올림 단위는 Config.gs ROUND_MIN');
  sh.getRange(1, P.FARE).setNote('최종 1인 교통비 = 수동 교통비 있으면 그 값, 없으면 API 요금\n예산 시트 "교통비 MM/DD" 행이 이 열을 일자별로 합산');
  sh.getRange(1, P.PER).setNote('예산 시트 1인당 비용(₩)을 환율로 나눈 엔화');
  sh.getRange(1, P.BUDGET_ID).setNote('예산 시트의 번호 선택 → 금액 자동으로 불러옴');
  sh.getRange(1, P.FARE_API).setNote('"경로 계산" 때 구글 경로 결과에 요금이 있으면 채워짐. 일본은 비는 구간이 있을 수 있음');
}

// 일정 시트 함수. 도착·출발은 바로 윗행을 참조하므로 행은 일자·순서대로 정렬돼 있어야 함
function writePlanFormulas_(sh) {
  const rows = sh.getMaxRows() - 1;
  const startHM = parseHHmm_(CONFIG.DEFAULT_START);
  const startTime = 'TIME(' + Math.floor(startHM / 60) + ',' + (startHM % 60) + ',0)';
  const bName = "'" + CONFIG.BUDGET_SHEET + "'!";
  const bId = bName + '$' + colL_(B.ID) + ':$' + colL_(B.ID);
  const bPer = bName + '$' + colL_(B.PER) + ':$' + colL_(B.PER);
  const bPaid = bName + '$' + colL_(B.PAID) + ':$' + colL_(B.PAID);

  const c = k => '$' + colL_(P[k]);
  const step = roundStep_();
  const out = { FARE: [], PER: [], PAID: [], ARRIVE: [], DEPART: [], SLACK: [], BUFFER: [] };
  for (let r = 2; r <= rows + 1; r++) {
    const q = r - 1;
    const match = 'MATCH(' + c('BUDGET_ID') + r + ',' + bId + ',0)';
    const per =
      '=IF(' + c('BUDGET_ID') + r + '="","",IFERROR(ROUND(INDEX(' + bPer + ',' + match + ')/' + CONFIG.RATE_NAME + '),""))';
    const paid =
      '=IF(' + c('BUDGET_ID') + r + '="","",IFERROR(IF(INDEX(' + bPaid + ',' + match + ')=TRUE,"결제","미결제"),"없는 번호"))';
    // 윗행에서 이 행까지 이동(분) 원래 값 / 올린 값
    const moveQ = 'IF(' + c('MODE') + q + '="수동",N(' + c('MANUAL') + q + '),N(' + c('MOVE') + q + '))';
    const moveUp = 'CEILING(' + moveQ + ',' + step + ')';
    // 체류 끝나는 시각 (올리기 전)
    const rawDepart = 'MAX(' + c('ARRIVE') + r + ',IF(' + c('FIXED') + r + '="",' +
      c('ARRIVE') + r + ',' + c('FIXED') + r + '))+N(' + c('STAY') + r + ')/1440';
    const arrive =
      '=IF(' + c('DATE') + r + '="","",IF(' + c('DATE') + r + '<>' + c('DATE') + q + ',' +
      'IF(' + c('FIXED') + r + '="",' + startTime + ',' + c('FIXED') + r + '),' +
      c('DEPART') + q + '+' + moveUp + '/1440))';
    // 분 단위 정수로 바꾼 뒤 올림 (소수 오차로 14:40이 14:45로 밀리는 것 방지)
    const depart =
      '=IF(' + c('DATE') + r + '="","",CEILING(ROUND((' + rawDepart + ')*1440),' + step + ')/1440)';
    const buffer =
      '=IF(' + c('DATE') + r + '="","",IF(' + c('DATE') + r + '<>' + c('DATE') + q + ',0,' + moveUp + '-' + moveQ + ')+' +
      'ROUND((' + c('DEPART') + r + '-(' + rawDepart + '))*1440))';
    const slack =
      '=IF(OR(' + c('DATE') + r + '="",' + c('FIXED') + r + '=""),"",ROUND((' +
      c('FIXED') + r + '-' + c('ARRIVE') + r + ')*1440))';
    const fare =
      '=IF(' + c('DATE') + r + '="","",IF(' + c('MANUAL_FARE') + r + '<>"",' + c('MANUAL_FARE') + r + ',IF(' +
      c('FARE_API') + r + '="","",' + c('FARE_API') + r + ')))';
    out.FARE.push([fare]);
    out.PER.push([per]);
    out.PAID.push([paid]);
    out.ARRIVE.push([arrive]);
    out.DEPART.push([depart]);
    out.SLACK.push([slack]);
    out.BUFFER.push([buffer]);
  }
  Object.keys(out).forEach(k => sh.getRange(2, P[k], rows, 1).setFormulas(out[k]));
}

// 환율 설정 시트. 새로 만들었으면 true
function setupSettings_(ss) {
  if (ss.getRangeByName(CONFIG.RATE_NAME)) return false;
  let sh = ss.getSheetByName(CONFIG.SETTINGS_SHEET);
  if (!sh) sh = ss.insertSheet(CONFIG.SETTINGS_SHEET);

  sh.getRange('A1:A2').setValues([['엔화 환율 (1엔당 원, 고정)'], ['실시간 참고값']]).setFontWeight('bold');
  sh.getRange('B2').setFormula('=GOOGLEFINANCE("CURRENCY:JPYKRW")');
  SpreadsheetApp.flush();
  let live = Number(sh.getRange('B2').getValue());
  if (!(live > 0)) live = 9;
  sh.getRange('B1').setValue(Math.round(live * 100) / 100).setBackground('#fff3bf');
  sh.getRange('B1:B2').setNumberFormat('0.00');
  sh.setColumnWidth(1, 200);
  sh.getRange('B1').setNote('일정 ¥ ↔ 예산 ₩ 변환에 쓰는 환율. 실제 환전한 환율로 고쳐두면 됨\n실시간 값을 쓰면 환율이 바뀔 때마다 금액이 흔들려서 고정값 사용');
  ss.setNamedRange(CONFIG.RATE_NAME, sh.getRange('B1'));
  return true;
}

function getRate_(ss) {
  const r = ss.getRangeByName(CONFIG.RATE_NAME);
  const v = r ? Number(r.getValue()) : NaN;
  if (!(v > 0)) throw new Error('"설정" 시트 환율(B1)이 비었거나 0. 여행 도구 → 시트 구조 업데이트 실행 또는 직접 입력');
  return v;
}

const yenToWon_ = (yen, rate) => Math.round(Number(yen) * rate);
const wonToYen_ = (won, rate) => Math.round(Number(won) / rate);

// 예전 경로 시트에 새로 생긴 열(요금, 경고 등) 추가. 경로 시트는 스크립트 전용이라 이름이 다른 칸은 덮어씀
function ensureRouteHeader_(sh) {
  ensureColumns_(sh, ROUTE_HEADERS.length);
  const rows = sh.getMaxRows() - 1;
  const cur = sh.getRange(1, 1, 1, ROUTE_HEADERS.length).getDisplayValues()[0];
  ROUTE_HEADERS.forEach((name, i) => {
    const c = i + 1;
    if (hn_(cur[i]) === hn_(name)) return;
    sh.getRange(1, c).setValue(name)
      .setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_AUTO);
    sh.getRange(2, c, rows, 1).setBackground(CONFIG.COLOR_AUTO);
    if (c === R.FARE) {
      sh.getRange(2, c, rows, 1).setNumberFormat(CONFIG.YEN_FORMAT);
      sh.setColumnWidth(c, 75);
    }
    if (c === R.WARN) {
      sh.setColumnWidth(c, 260);
      sh.getRange(1, c).setNote('대중교통 구간을 ' + CONFIG.LATE_CHECK_MIN + '분 늦게 출발해서 다시 조회한 결과\nOK = 문제 없음 / 빈 칸 = 아직 점검 안 함');
    }
    if (c === R.STEPS) {
      sh.getRange(2, c, rows, 1).setNumberFormat('@');
      sh.setColumnWidth(c, 90);
      sh.getRange(1, c).setNote('대중교통 단계 (도보·승차·환승·하차) JSON. 웹앱용');
      sh.hideColumns(c);
    }
    if (c === R.TAXI) {
      sh.setColumnWidth(c, 90);
      sh.getRange(2, c, rows, 1).setNumberFormat('@');
      sh.getRange(1, c).setNote('대중교통 구간을 차로 가면 "분|미터"\n대중교통 ' + CONFIG.TAXI_CHECK_MIN_TRANSIT + '분 이상 + 직선 ' + CONFIG.TAXI_CHECK_M + 'm 이내 구간만 확인\n택시가 ' + CONFIG.TAXI_HINT_SAVE + '분 이상 빠르면 결과창·웹앱에 대략 요금과 같이 표시\n빈 칸 = 아직 확인 안 함 / - = 대상 아님');
    }
    if (c === R.WALK) {
      sh.setColumnWidth(c, 75);
      sh.getRange(1, c).setNote('대중교통 구간을 걸어가면 몇 분인지\n걸어서 ' + CONFIG.WALK_HINT_MIN + '분 이하이거나 대중교통보다 빠르면 경로 계산 결과·웹앱에 "도보 추천"\n빈 칸 = 아직 확인 안 함 / - = 직선 ' + CONFIG.WALK_CHECK_M + 'm 넘어서 확인 안 함');
    }
    if (c === R.PASS) {
      sh.setColumnWidth(c, 170);
      sh.getRange(1, c).setNote('주유패스 = 탑승 노선이 전부 패스 노선이라 일정 시트 교통비 0원\n주유패스 일부 = 일부만 패스 노선이라 요금 그대로 (필요하면 수동 교통비 입력)\n요금(¥) 열은 패스 적용 전 원래 요금');
    }
  });
}

function buildRouteSheet_(sh) {
  const n = ROUTE_HEADERS.length;
  ensureColumns_(sh, n);
  const rows = sh.getMaxRows() - 1;

  sh.getRange(1, 1, 1, n).setValues([ROUTE_HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_AUTO);
  sh.setFrozenRows(1);
  sh.getRange(2, 1, rows, n).setBackground(CONFIG.COLOR_AUTO);
  sh.getRange(2, R.DATE, rows, 2).setNumberFormat('@');
  sh.getRange(2, R.DEP, rows, 2).setNumberFormat('@');

  [95, 60, 170, 170, 75, 70, 70, 65, 380, 50, 90, 80, 125, 90, 75, 260, 90, 170, 75, 90]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(2, R.FARE, rows, 1).setNumberFormat(CONFIG.YEN_FORMAT);
  sh.getRange(2, R.STEPS, rows, 1).setNumberFormat('@');
  sh.getRange(2, R.TAXI, rows, 1).setNumberFormat('@');
  sh.hideColumns(R.KEY);
  sh.hideColumns(R.STEPS);

  sh.getRange(1, 1).setNote('이 시트는 "경로 계산" 실행 때마다 덮어씀. 직접 수정하지 말 것');
  sh.getRange(1, R.WARN).setNote('대중교통 구간을 ' + CONFIG.LATE_CHECK_MIN + '분 늦게 출발해서 다시 조회한 결과\nOK = 문제 없음 / 빈 칸 = 아직 점검 안 함');
  sh.protect().setDescription('스크립트 전용').setWarningOnly(true);
}

function buildBudgetSheet_(sh) {
  const n = BUDGET_HEADERS.length;
  ensureColumns_(sh, n);
  const rows = sh.getMaxRows() - 1;

  sh.getRange(1, 1, 1, n).setValues([BUDGET_HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_INPUT);
  sh.getRange(1, B.ID).setBackground(CONFIG.COLOR_HEADER_AUTO);
  sh.getRange(1, B.PER).setBackground(CONFIG.COLOR_HEADER_AUTO);
  sh.setFrozenRows(1);

  sh.getRange(2, B.ID, rows, 1).setNumberFormat('@').setBackground(CONFIG.COLOR_AUTO);
  sh.getRange(2, B.DATE, rows, 1).setNumberFormat('yyyy. m. d');
  sh.getRange(2, B.TOTAL, rows, 1).setNumberFormat(CONFIG.CURRENCY_FORMAT);
  sh.getRange(2, B.PAID, rows, 1).insertCheckboxes();
  sh.getRange(2, B.PEOPLE, rows, 1).setNumberFormat('0');
  sh.getRange(2, B.PER, rows, 1).setNumberFormat(CONFIG.CURRENCY_FORMAT).setBackground(CONFIG.COLOR_AUTO);

  const per = [];
  for (let r = 2; r <= rows + 1; r++) per.push([budgetPerFormula_(r)]);
  sh.getRange(2, B.PER, rows, 1).setFormulas(per);

  [70, 100, 220, 120, 55, 65, 120, 240].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(1, B.ID).setNote('스크립트가 자동 부여. 비워두고 비용·총 비용만 입력해도 번호가 생김');
  sh.getRange(1, B.PAID).setNote('체크 = 이미 결제함');
  sh.getRange(1, B.PEOPLE).setNote('비우면 1인당 비용 = 총 비용');
}

function budgetPerFormula_(r) {
  const t = '$' + colL_(B.TOTAL) + r;
  const p = '$' + colL_(B.PEOPLE) + r;
  return '=IF(' + t + '="","",IF(N(' + p + ')=0,' + t + ',' + t + '/' + p + '))';
}

// 샘플: 12/27 오사카 마지막 날 (현재 계획 기준)
function insertSampleData() {
  requireSheetUi_();
  invalidateCache_();
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.PLAN_SHEET);
  if (!sh) { alert_('먼저 "시트 생성" 실행'); return; }
  const d = '2026-12-27';
  // 일자, 순서, 활동, 장소, 체류, 고정 시각, 다음 이동수단, 수동 소요, 수동 교통비, 금액, 메모
  const rows = [
    [d, 1, '아침 카페', '도톤보리', 60, '09:00', '도보', '', '', '', ''],
    [d, 2, '체크아웃', 'Yeah Room Namba Hotel', 15, '11:00', '도보', '', '', '', '11시 체크아웃'],
    [d, 3, '짐 맡기기', '난바역', 15, '', '도보', '', '', '', '코인로커'],
    [d, 4, '시장 구경', '구로몬 시장', 90, '', '도보', '', '', '', ''],
    [d, 5, '굿즈 구경', '덴덴타운', 90, '', '대중교통', '', '', '', ''],
    [d, 6, '짐 회수', '난바역', 15, '', '대중교통', '', '', '', ''],
    [d, 7, '쇼핑, 저녁', '우메다', 180, '', '도보', '', '', '', ''],
    [d, 8, '신주쿠행 버스', '오사카역 고속버스 터미널', 0, '21:00', '', '', '', '', '이동안 미정 (버스/비행기/신칸센)'],
  ];
  const start = lastDataRow_(sh) + 1;
  sh.getRange(start, P.DATE, rows.length, P.MEMO).setValues(rows);
}