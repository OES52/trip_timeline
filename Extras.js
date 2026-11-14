/* ───────────────────────── 할 일 · 예약 · 일본어 이름·주소 · 집 서버 감시 ───────────────────────── */
/* Extras.gs  */
// 웹앱(v2)이 쓰는 것
//  - 할 일 시트: 출발 전 할 일. "오늘" 화면에 날짜순, 그 시각에 알림(홈랩 프록시 pushTick). 웹앱에서 끝냄 체크
//  - 예약 시트: 예약번호·링크·티켓 그림. 그날 일정 줄에 붙고, 한 번 열면 폰에 저장돼 인터넷 없이도 보임
//  - 장소 시트 "일본어 이름"·"주소": 택시 기사에게 보여주는 카드. "장소 일본어 이름·주소 채우기"가 빈 칸을 채움
//  - 설정 시트 "비상 연락처": 웹앱 설정의 비상 연락처에 같이 나옴 (줄마다 하나)
//  - 집 서버 감시: 10분마다 홈랩 주소 확인 → 30분 넘게 안 되면 메일 + 비상 주소(이 Apps Script 웹앱, 예전 화면) 열기

const TODO_HEADERS = ['날짜', '시각', '할 일', '메모', '누구', '완료', '완료한 사람'];
const T = { DATE: 1, TIME: 2, TEXT: 3, MEMO: 4, WHO: 5, DONE: 6, BY: 7 };
const BOOK_HEADERS = ['날짜', '순서', '장소', '제목', '예약번호', '링크', '그림', '메모', '누구'];
const K = { DATE: 1, ORDER: 2, PLACE: 3, TITLE: 4, NO: 5, LINK: 6, IMAGE: 7, MEMO: 8, WHO: 9 };

// 메뉴: 할 일·예약 시트, 장소 시트 새 열, 설정 시트 비상 연락처 칸 (없는 것만 만듦)
function setupExtraSheets() {
  requireSheetUi_();
  const ss = SpreadsheetApp.getActive();
  const made = [];
  if (!ss.getSheetByName(CONFIG.TODO_SHEET)) { buildTodoSheet_(ss.insertSheet(CONFIG.TODO_SHEET)); made.push(CONFIG.TODO_SHEET); }
  if (!ss.getSheetByName(CONFIG.BOOK_SHEET)) { buildBookSheet_(ss.insertSheet(CONFIG.BOOK_SHEET)); made.push(CONFIG.BOOK_SHEET); }
  const pl = ss.getSheetByName(CONFIG.PLACE_SHEET);
  if (pl) ensurePlaceHeader_(pl);
  ensureSettingsExtra_(ss);
  invalidateCache_();
  alert_((made.length ? '만듦: ' + made.join(', ') : '"할 일"·"예약" 시트는 이미 있음') +
    '\n장소 시트 "일본어 이름"·"주소" 열, 설정 시트 "비상 연락처" 칸도 확인함');
}

function headerRow_(sh, headers) {
  ensureColumns_(sh, headers.length);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_INPUT);
  sh.setFrozenRows(1);
}

function buildTodoSheet_(sh) {
  headerRow_(sh, TODO_HEADERS);
  sh.getRange(1, T.BY).setBackground(CONFIG.COLOR_HEADER_AUTO);
  const rows = sh.getMaxRows() - 1;
  sh.getRange(2, T.DATE, rows, 2).setNumberFormat('@');
  sh.getRange(2, T.DONE, rows, 1).insertCheckboxes();
  sh.getRange(2, T.BY, rows, 1).setBackground(CONFIG.COLOR_AUTO);
  [100, 60, 260, 260, 100, 50, 130].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(1, T.DATE).setNote('할 일 날짜 (yyyy-mm-dd). 웹앱 "오늘" 화면에 날짜순으로 나옴');
  sh.getRange(1, T.TIME).setNote('알림 시각 (HH:MM). 일본·한국 시각이 같음. 비우면 그날 9:00\n출발 알림을 켜 둔 폰으로 감');
  sh.getRange(1, T.WHO).setNote('비우면 모두. 특정 사람만이면 사용자 이름을 쉼표로 (예: OES, KanoC)');
  sh.getRange(1, T.DONE).setNote('웹앱에서 체크해도 여기 체크됨. 끝낸 일은 알림이 안 감');
  sh.getRange(1, T.BY).setNote('웹앱에서 체크한 사람·시각 (자동)');
  // 이미 알고 있는 날짜 두 개 (고치거나 지워도 됨)
  sh.getRange(2, 1, 2, 4).setValues([
    ['2026-11-25', '', '라피트 예약 (탑승 1개월 전부터 열림)', '12/25 간사이공항 → 난바'],
    ['2026-12-05', '', '코미케 C109 eplus AM 전자티켓 사기', '판매 시작 시각 확인해서 시각 칸에 넣기. 실명 티켓이라 여권 원본 챙기기'],
  ]);
}

function buildBookSheet_(sh) {
  headerRow_(sh, BOOK_HEADERS);
  const rows = sh.getMaxRows() - 1;
  sh.getRange(2, K.DATE, rows, 1).setNumberFormat('@');
  sh.getRange(2, K.NO, rows, 1).setNumberFormat('@');
  [100, 50, 160, 220, 140, 200, 220, 220, 100].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(1, K.DATE).setNote('이날 일정에 붙음 (yyyy-mm-dd)');
  sh.getRange(1, K.ORDER).setNote('일정 시트의 순서 번호. 비우면 "장소" 이름으로 그날 일정에서 찾음\n날짜·순서·장소가 다 비면 웹앱 "예약·티켓" 목록에만 나옴 (보험 등)');
  sh.getRange(1, K.PLACE).setNote('순서를 모를 때 일정의 장소 이름 (일부만 써도 됨)');
  sh.getRange(1, K.TITLE).setNote('예: 라피트 β 12:05 · 2호차 5·6석');
  sh.getRange(1, K.NO).setNote('예약번호. 웹앱에서 크게 보여주고 복사 버튼');
  sh.getRange(1, K.LINK).setNote('예약 확인 페이지 주소');
  sh.getRange(1, K.IMAGE).setNote('QR·티켓 그림 주소 (여러 개는 쉼표). 구글 드라이브는 "링크가 있는 모든 사용자 보기"로 공유한 링크\n웹앱에서 한 번 열거나 "지도·사진 미리 받기"를 하면 폰에 저장돼 인터넷 없이도 보임');
  sh.getRange(1, K.WHO).setNote('비우면 모두. 특정 사람만이면 사용자 이름을 쉼표로');
}

const whoList_ = s => String(s || '').split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
const hmText_ = s => { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) + ':' + m[2] : ''; };

function todoKey_(date, text) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, date + '|' + text, Utilities.Charset.UTF_8);
  return 'T' + d.slice(0, 5).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// 할 일 목록 (row는 쓰기용, 내보낼 때 뺌). 날짜·시각 순
function readTodos_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CONFIG.TODO_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const range = sh.getRange(2, 1, sh.getLastRow() - 1, TODO_HEADERS.length);
  const vals = range.getValues(), disp = range.getDisplayValues();
  const tz = ss.getSpreadsheetTimeZone();
  const out = [];
  vals.forEach((v, i) => {
    const text = String(v[T.TEXT - 1]).trim();
    if (!text) return;
    const date = parseDateStr_(v[T.DATE - 1], disp[i][T.DATE - 1], tz) || '';
    out.push({
      row: i + 2, key: todoKey_(date, text), date: date, time: hmText_(disp[i][T.TIME - 1]), text: text,
      memo: String(v[T.MEMO - 1]).trim(), who: whoList_(v[T.WHO - 1]),
      done: v[T.DONE - 1] === true, doneBy: String(disp[i][T.BY - 1]).trim(),
    });
  });
  const tm = t => { const m = t.time.match(/(\d+):(\d+)/); return m ? Number(m[1]) * 60 + Number(m[2]) : 540; };
  return out.sort((a, b) => (a.date || '9') < (b.date || '9') ? -1 : (a.date || '9') > (b.date || '9') ? 1 : tm(a) - tm(b));
}
const noRow_ = o => { const c = Object.assign({}, o); delete c.row; return c; };

// 웹앱에서 호출: 할 일 끝냄/되돌림. 결과 = 할 일 전체
function setTodo(key, done, user, pin) {
  const u = authUser_(user, pin, 'stamp');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const t = readTodos_().find(x => x.key === key);
    if (!t) throw new Error('할 일이 시트에서 바뀌었거나 지워짐. 새로 받은 뒤 다시');
    SpreadsheetApp.getActive().getSheetByName(CONFIG.TODO_SHEET).getRange(t.row, T.DONE, 1, 2)
      .setValues([[!!done, done ? u.id + ' ' + Utilities.formatDate(new Date(), CONFIG.TRIP_TZ, 'M/d HH:mm') : '']]);
  } finally {
    lock.releaseLock();
  }
  return readTodos_().map(noRow_);
}

// 예약 목록. 순서가 비면 웹앱이 "장소" 이름으로 그날 일정에서 찾음
function readBookings_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CONFIG.BOOK_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const range = sh.getRange(2, 1, sh.getLastRow() - 1, BOOK_HEADERS.length);
  const vals = range.getValues(), disp = range.getDisplayValues();
  const tz = ss.getSpreadsheetTimeZone();
  const out = [];
  vals.forEach((v, i) => {
    const title = String(v[K.TITLE - 1]).trim(), no = String(disp[i][K.NO - 1]).trim();
    const images = parsePhotos_(v[K.IMAGE - 1]);
    if (!title && !no && !images.length) return;
    const order = Number(v[K.ORDER - 1]);
    out.push({
      key: 'R' + (i + 2),
      date: parseDateStr_(v[K.DATE - 1], disp[i][K.DATE - 1], tz) || '',
      order: order > 0 ? order : null,
      place: String(v[K.PLACE - 1]).trim(),
      title: title, no: no, link: String(v[K.LINK - 1]).trim(), images: images,
      memo: String(v[K.MEMO - 1]).trim(), who: whoList_(v[K.WHO - 1]),
    });
  });
  return out;
}

/* ── 장소 일본어 이름·주소 (Places API) ── */
// 메뉴: 일본어 이름이나 주소가 빈 장소만. 장소 ID가 없으면 무료 검색으로 먼저 찾음
function fillPlaceJa() {
  requireSheetUi_();
  const ui = SpreadsheetApp.getUi();
  const key = PropertiesService.getScriptProperties().getProperty('PLACES_API_KEY');
  if (!key) { ui.alert('Places API 키가 없음. 여행 도구 → Places API 키 설정 먼저'); return; }
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.PLACE_SHEET);
  if (!sh) { ui.alert('"장소" 시트가 없음'); return; }
  ensurePlaceHeader_(sh);
  const places = readPlaces_(sh);
  const col = places.length ? places[0].col : null;
  if (!col || col.JA < 0 || col.ADDR < 0 || col.PID < 0) { ui.alert('장소 시트에 일본어 이름·주소·Place ID 열이 없음. 할 일·예약 시트 만들기 먼저'); return; }
  const list = places.filter(p => p.pid !== 'none' && (!p.ja || !p.addr)).slice(0, 100);
  if (!list.length) { ui.alert('채울 장소 없음 (일본어 이름·주소가 다 있음)'); return; }
  const ok = ui.alert('장소 일본어 이름·주소 채우기',
    list.length + '곳 조회 (빈 칸만 채움)\n- 장소 ID 찾기 ' + list.filter(p => !p.pid).length + '건 (무료)\n- 이름·주소 조회 ' + list.length + '건 (유료 등급, 월 5,000건 무료)',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  let filled = 0, missed = 0;
  list.forEach(p => {
    try {
      let pid = p.pid;
      if (!pid) {
        pid = placesSearchId_(key, p) || 'none';
        sh.getRange(p.row, col.PID + 1).setValue(pid);
      }
      if (pid === 'none') { missed++; return; }
      const res = UrlFetchApp.fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(pid) + '?languageCode=ja&regionCode=JP', {
        muteHttpExceptions: true,
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'displayName,formattedAddress' },
      });
      checkPlacesRes_(res);
      const j = JSON.parse(res.getContentText() || '{}');
      const ja = j.displayName && j.displayName.text ? j.displayName.text : '';
      const addr = String(j.formattedAddress || '').replace(/^日本、\s*/, '');
      if (!p.ja && ja) sh.getRange(p.row, col.JA + 1).setValue(ja);
      if (!p.addr && addr) sh.getRange(p.row, col.ADDR + 1).setValue(addr);
      if (ja || addr) filled++; else missed++;
    } catch (e) {
      if (/Places API/.test(e.message)) throw e;   // 키·할당량 문제는 바로 멈춤
      missed++;
    }
    Utilities.sleep(CONFIG.SLEEP_MS);
  });
  invalidateCache_();
  alert_(filled + '곳 채움' + (missed ? ', ' + missed + '곳은 못 찾음 (직접 입력)' : '') + '\n숙소처럼 주소가 중요한 곳은 예약 메일의 주소와 한 번 대조하기');
}

/* ── 집 서버 감시 + 비상 주소 ── */
//  비상 주소 = 이 Apps Script 웹앱(CONFIG.WEBAPP_URL)이 보여주는 예전 화면(v1). 평소엔 닫아 둠
//  스크립트 속성: FALLBACK('1'이면 열림), ACCESS_CODE(비상 주소 접속 코드, 홈랩 접속 코드와 같게), HOME_FAILS, HOME_DOWN
const HOME_FAIL_LIMIT = 3;   // 10분 간격으로 이만큼 연달아 안 되면 "죽음"

function checkHomeServer() {
  const props = PropertiesService.getScriptProperties();
  let ok = false, why = '';
  try {
    const res = UrlFetchApp.fetch(CONFIG.HOME_URL + 'api/session', { muteHttpExceptions: true, followRedirects: false });
    ok = res.getResponseCode() === 200;
    if (!ok) why = 'HTTP ' + res.getResponseCode();
  } catch (e) {
    why = String((e && e.message) || e).slice(0, 200);
  }
  const fails = ok ? 0 : Number(props.getProperty('HOME_FAILS') || 0) + 1;
  props.setProperty('HOME_FAILS', String(fails));
  const down = props.getProperty('HOME_DOWN') === '1';
  if (!ok && !down && fails >= HOME_FAIL_LIMIT) {
    props.setProperties({ HOME_DOWN: '1', FALLBACK: '1' });
    mailMe_('[여행] 집 서버 응답 없음',
      '집 서버(' + CONFIG.HOME_URL + ')가 ' + (fails * 10) + '분 넘게 응답하지 않음 (' + why + ').\n\n' +
      '폰 앱은 저장해 둔 일정으로 계속 볼 수 있고, 도장·도착·지출 기록은 폰에 쌓였다가 서버가 돌아오면 보내짐.\n' +
      '출발 알림은 서버가 돌아올 때까지 안 옴.\n\n' +
      '지금 바로 시트 내용을 봐야 하면 비상 주소(예전 화면)를 쓰기:\n' + fallbackUrl_() + '\n\n' +
      '서버가 돌아오면 메일이 한 번 더 오고 비상 주소는 저절로 닫힘.');
  } else if (ok && down) {
    props.setProperties({ HOME_DOWN: '0', FALLBACK: '0' });
    mailMe_('[여행] 집 서버 다시 됨', '집 서버(' + CONFIG.HOME_URL + ')가 다시 응답함. 비상 주소는 닫음.\n폰에 쌓인 기록은 앱을 열면 보내짐.');
  }
}

function fallbackUrl_() {
  const code = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  return CONFIG.WEBAPP_URL + (code ? '?code=' + encodeURIComponent(code) : '');
}

function mailMe_(subject, body) {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
}

// 메뉴: 10분마다 감시 (켜면 한 번 바로 확인)
function installHomeMonitor() {
  requireSheetUi_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkHomeServer').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkHomeServer').timeBased().everyMinutes(10).create();
  PropertiesService.getScriptProperties().setProperties({ HOME_FAILS: '0' });
  checkHomeServer();
  alert_('집 서버 감시 켬. 10분마다 확인하고, 30분 넘게 안 되면 ' + Session.getEffectiveUser().getEmail() + ' 로 메일 + 비상 주소를 엶');
}

function removeHomeMonitor() {
  requireSheetUi_();
  const list = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkHomeServer');
  list.forEach(t => ScriptApp.deleteTrigger(t));
  alert_(list.length ? '집 서버 감시 끔' : '감시가 켜져 있지 않음');
}

// 메뉴: 비상 주소 직접 열기/닫기
function toggleFallback() {
  requireSheetUi_();
  const props = PropertiesService.getScriptProperties();
  const on = props.getProperty('FALLBACK') !== '1';
  props.setProperty('FALLBACK', on ? '1' : '0');
  alert_(on ? '비상 주소 엶:\n' + fallbackUrl_() : '비상 주소 닫음 (주소로 들어와도 안내 글만 보임)');
}

// 메뉴: 비상 주소 접속 코드 (홈랩 ACCESS_CODE와 같게. 비우면 코드 없이 열림)
function setFallbackCode() {
  requireSheetUi_();
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('비상 주소 접속 코드', '홈랩 접속 코드와 같은 값. 비우고 확인하면 코드 없이 열림', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const v = r.getResponseText().trim();
  const props = PropertiesService.getScriptProperties();
  if (v) props.setProperty('ACCESS_CODE', v); else props.deleteProperty('ACCESS_CODE');
  alert_(v ? '저장함. 비상 주소는 ?code=… 가 붙은 주소로만 열림 (감시 메일에 붙어서 감)' : '코드 지움');
}

// doGet: 예전 화면(비상 주소)을 보여줘도 되는지. 안 되면 안내 글 (google.script.run이 없는 글자 응답)
function fallbackGate_(p) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FALLBACK') !== '1') {
    return ContentService.createTextOutput('여행 타임라인 비상 주소. 지금은 닫혀 있음.\n' + CONFIG.HOME_URL);
  }
  const code = props.getProperty('ACCESS_CODE');
  if (code && String((p && p.code) || '') !== code) return ContentService.createTextOutput('접속 코드가 필요함');
  return null;
}
