/* ───────────────────────── 웹앱 ───────────────────────── */
/* WebApps.gs  */
// 그냥 열면 웹앱 화면, ?api=... 이면 JSON (외부 정적 페이지용)
//  GET ?api=data  → getMapData() 결과
//  GET ?api=users → 사용자 목록 (PIN 값은 빼고 있는지만)
//  GET ?api=ping  → 살아 있는지 (키 없이도 됨)
//  GET ?api=auth  → 사용자별 PIN 해시 (홈랩 프록시가 PIN을 먼저 확인하는 용도, 키 필수)
//  스크립트 속성 PROXY_KEY 가 있으면 ping 말고는 &key=PROXY_KEY 가 맞아야 응답 (POST는 본문 key)
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.api) {
    return apiRespond_(() => {
      if (p.api === 'ping') return { ok: true, at: new Date().toISOString() };
      requireProxyKey_(p.key);   // 스크립트 속성 PROXY_KEY 있으면 홈랩 프록시만 통과
      if (p.api === 'data') return getMapData();
      if (p.api === 'auth') return authList_();
      if (p.api === 'users') return JSON.parse(bootUsersJson_());   // \u003c 이스케이프는 JSON.parse가 그대로 풀어줌
      throw new Error('알 수 없는 api: ' + p.api);
    });
  }
  // 예전 화면(v1)은 집 서버가 죽었을 때 쓰는 비상 주소. 평소엔 닫아 둠 (Extras.js)
  const gate = fallbackGate_(p);
  if (gate) return gate;
  const t = HtmlService.createTemplateFromFile('Index');
  t.bootUsers = bootUsersJson_();
  return t.evaluate()
    .setTitle('여행 타임라인')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

// 첫 화면용 사용자 목록 (PIN 값은 빼고 있는지만). <script> 안에 들어가므로 < 이스케이프
function bootUsersJson_() {
  let list = [];
  try {
    list = readSettings_().users.map(u => ({ id: u.id, from: u.from, to: u.to, canStamp: u.canStamp, canEdit: u.canEdit, hasPin: !!u.pin }));
  } catch (e) {
    list = [];
  }
  return JSON.stringify(list).replace(/</g, '\\u003c');
}

/* ── 외부 정적 페이지용 API ── */
// 정적 페이지가 호출할 수 있는 서버 함수 목록. 여기 없는 이름은 거부
//  (google.script.run으로 부르던 함수와 같은 이름·같은 인자)
const API_FNS_ = {
  getMapData: () => getMapData(),
  checkPin: (user, pin) => checkPin(user, pin),
  setSpend: (key, place, amount, memo, user, pin) => setSpend(key, place, amount, memo, user, pin),
  setVisited: (key, on, user, pin) => setVisited(key, on, user, pin),
  setVisitedMany: (changes, user, pin) => setVisitedMany(changes, user, pin),
  setArrived: (key, hhmm, user, pin) => setArrived(key, hhmm, user, pin),
  editPlan: (key, op, value, user, pin) => editPlan(key, op, value, user, pin),
  setTodo: (key, done, user, pin) => setTodo(key, done, user, pin),
};

// POST 본문: {"fn":"setSpend","args":[...]}
//  브라우저가 CORS 사전 요청을 안 보내게 정적 페이지는 Content-Type: text/plain 으로 보냄
function doPost(e) {
  return apiRespond_(() => {
    let body;
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { throw new Error('JSON 형식이 아님'); }
    requireProxyKey_(body.key);
    API_CALL_ = true;   // 프록시가 직접 부른 쓰기라 프록시에 다시 알릴 필요 없음
    const fn = API_FNS_[body.fn];
    if (!fn) throw new Error('호출할 수 없는 함수: ' + body.fn);
    return fn.apply(null, Array.isArray(body.args) ? body.args : []);
  });
}

// 홈랩 프록시 전용 키. 속성이 없으면 확인 안 함 (예전처럼 누구나)
function requireProxyKey_(given) {
  const want = PropertiesService.getScriptProperties().getProperty('PROXY_KEY');
  if (want && String(given || '') !== want) throw new Error('키가 틀림');
}

// 사용자별 PIN 해시 (SHA-256 hex, PIN 없으면 빈 값). 프록시가 PIN 틀린 요청을 여기까지 안 보내게
function authList_() {
  return readSettings_().users.map(u => ({ id: u.id, pin: u.pin ? sha256Hex_(u.pin) : '' }));
}
function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// 결과를 {ok, result} / {ok:false, error} JSON으로
function apiRespond_(work) {
  let out;
  try {
    out = { ok: true, result: work() };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Index.html에서 <?!= include('Style'); ?> 처럼 다른 HTML 파일을 끼워 넣음
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// CONFIG.WEBAPP_URL 우선. 비어 있을 때만 스크립트가 아는 주소 (예전 배포가 나올 수 있음)
function showMapLink() {
  requireSheetUi_();
  const url = CONFIG.HOME_URL || CONFIG.WEBAPP_URL || ScriptApp.getService().getUrl();
  if (!url) {
    alert_('웹앱이 아직 배포되지 않음.\nApps Script 편집기 → 배포 → 새 배포 → 유형: 웹 앱 으로 먼저 배포할 것');
    return;
  }
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px;line-height:1.6">' +
    '<a href="' + url + '" target="_blank">지도 열기</a>' +
    '<p style="color:#5d6b7d;margin-top:8px">폰에서도 이 주소로 열면 됨</p></div>'
  ).setWidth(320).setHeight(110);
  SpreadsheetApp.getUi().showModalDialog(html, '여행 타임라인');
}

// 웹앱에서 호출: 일자별 장소·구간·예산 데이터 + 사람별 기록
function getMapData() {
  let base = cacheGet_();
  if (!base) {
    base = buildMapBase_();
    cachePut_(base);
  }
  return Object.assign({}, base, {
    today: Utilities.formatDate(new Date(), CONFIG.TRIP_TZ, 'yyyy-MM-dd'),
    // PIN은 내보내지 않음
    users: readSettings_().users.map(u => ({ id: u.id, from: u.from, to: u.to, canStamp: u.canStamp, canEdit: u.canEdit, hasPin: !!u.pin })),
    visitedBy: getVisitedBy_(),
    arrivedBy: getArrivedBy_(),
    spend: readSpend_(),
    todos: readTodos_().map(noRow_),       // 할 일 (웹앱에서 끝냄 체크)
    bookings: readBookings_(),             // 예약번호·티켓 그림
    emergency: readSettings_().emergency,  // 설정 시트 비상 연락처 (줄마다)
  });
}

// 구간 택시 정보 (웹앱 택시 비교 상자)
//  대중교통 구간: 경로 시트 택시 칸 있으면 { min, low, high, perLow, perHigh, …, on: false, transitMin, saved }
//  택시로 가기 구간(차 + 출발 장소 메모 [택시 …]): on: true, transitMin은 메모에 적힌 원래 소요
function segTaxi_(v, from, travelers) {
  const mode = v[R.MODE - 1];
  const tag = from ? String(from.memo || '').match(TAXI_TAG_RE) : null;
  if (mode !== '대중교통' && !(mode === '차' && tag)) return null;
  const dep = (hmToMin_(v[R.DEP - 1]) || 0) + (/\(\+1\)/.test(v[R.DEP - 1]) ? 1440 : 0);
  const lat = from ? (from.endLat != null ? from.endLat : from.lat) : null;
  const lng = from ? (from.endLat != null ? from.endLng : from.lng) : null;
  const t = taxiInfo_(v[R.TAXI - 1], travelers, dep, lat, lng);
  if (!t) return null;
  t.on = mode === '차';
  t.transitMin = t.on ? (tag[2] ? Number(tag[2]) : null) : (Number(v[R.MIN - 1]) || 0);
  t.saved = t.transitMin != null ? t.transitMin - t.min : null;
  return t;
}

// 시트에서 읽는 무거운 부분 (캐시 대상)
function buildMapBase_() {
  const ss = SpreadsheetApp.getActive();
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  const routeSh = ss.getSheetByName(CONFIG.ROUTE_SHEET);
  const budgetSh = ss.getSheetByName(CONFIG.BUDGET_SHEET);
  if (!plan) throw new Error('"일정" 시트가 없음. 시트에서 여행 도구 → 시트 생성 먼저 실행');

  let rate = null;
  try { rate = getRate_(ss); } catch (e) { rate = null; }
  const budget = {};
  if (budgetSh) readBudget_(budgetSh).forEach(b => {
    if (b.id) budget[b.id] = { name: b.name, total: Number(b.total) || 0, per: Number(b.per) || 0, paid: b.paid, cur: b.cur };
  });

  const placeSh = ss.getSheetByName(CONFIG.PLACE_SHEET);
  const places = placeSh ? readPlaces_(placeSh) : [];

  const rows = readPlanRows_(plan, ss.getSpreadsheetTimeZone());
  const points = rows.map(r => {
    const b = r.budgetId ? budget[r.budgetId] : null;
    const place = places.find(p => samePlace_(p, { name: r.place, link: r.link, lat: r.lat, lng: r.lng }));
    return {
      placeKey: place ? place.key : '',
      date: r.date,
      order: r.order,
      activity: r.activity,
      place: r.place,
      lat: r.lat,
      lng: r.lng,
      endLat: r.endLat,   // 종착점 (없으면 null = 시작점에서 출발)
      endLng: r.endLng,
      inner: innerWalk_(r, false),   // 시작점→종착점 걷는 시간 { min, m, est } (종착점 없으면 null)
      stay: r.stay,
      fixed: r.fixed != null ? fmtMin_(r.fixed) : '',
      arrive: r.arrive,
      depart: r.depart,
      slack: r.slack === '' ? null : Number(r.slack),
      memo: r.memo,
      budgetId: r.budgetId,
      yen: r.amount,
      // per·won: 원화 환산 (엔화 예산은 환율 곱함). 화면은 money()로 엔화 표시
      // perCur·perOrig: 예산 시트의 원래 통화·1인당 금액 (한국에서 미리 낸 건 ₩로 보여주려고)
      won: b ? (b.cur === CUR_YEN && rate ? yenToWon_(b.total, rate) : b.total) : (r.amount != null && rate ? yenToWon_(r.amount, rate) : null),
      per: b ? (b.cur === CUR_YEN && rate ? b.per * rate : b.per) : null,
      perCur: b ? b.cur : null,
      perOrig: b ? b.per : null,
      paid: b ? b.paid : false,
      fare: r.fare,
    };
  });

  const pointIndex = {};
  points.forEach(p => { pointIndex[p.date + '#' + p.order] = p; });

  const segments = [];
  const overnight = [];   // 날짜를 넘는 구간 (밤버스 등). 구간 칸 "8→+1" = 이날 8번 → 다음 날 1번
  const dateList = Array.from(new Set(points.map(p => p.date))).sort();
  const travelers = readSettings_().travelers;
  // 주유패스 날: 탑승 단계마다 패스 노선인지 표시 (웹앱에서 QR·IC카드 구분용)
  const stt = readSettings_();
  const passDaySet = {};
  stt.passDays.forEach(d => { passDaySet[d] = true; });
  let passRe = null;
  try { passRe = new RegExp(stt.passLines, 'i'); } catch (e) { passRe = null; }
  let walk = {};
  if (routeSh && routeSh.getLastRow() >= 2) {
    const vals = routeSh.getRange(2, 1, routeSh.getLastRow() - 1, ROUTE_HEADERS.length).getDisplayValues();
    walk = walkByDate_(vals, rows);   // 날짜별 도보 거리·시간
    vals.forEach(v => {
      const date = v[R.DATE - 1];
      const seg = String(v[R.SEG - 1]).split('→');
      if (!date || seg.length !== 2) return;
      if (/^\s*\+/.test(seg[1])) {
        const toDate = dateList[dateList.indexOf(date) + 1];
        if (!toDate) return;
        overnight.push({
          date: date,
          toDate: toDate,
          fromOrder: Number(seg[0]),
          toOrder: Number(String(seg[1]).replace(/[^\d]/g, '')),
          mode: v[R.MODE - 1],
          dep: v[R.DEP - 1],
          arr: v[R.ARR - 1],
          minutes: Number(v[R.MIN - 1]) || 0,
          summary: v[R.SUMMARY - 1],
          polyline: v[R.POLY - 1],
        });
        return;
      }
      const from = pointIndex[date + '#' + Number(seg[0])];
      const to = pointIndex[date + '#' + Number(seg[1])];
      let steps = [];
      try { steps = v[R.STEPS - 1] ? JSON.parse(v[R.STEPS - 1]) : []; } catch (e) { steps = []; }
      if (!Array.isArray(steps)) steps = [];
      if (passRe && passDaySet[date]) {
        steps.forEach(st => { if (st.t === 'transit') st.pass = passRe.test([st.line, st.full, st.ag].filter(Boolean).join(' ')); });
      }
      // 단계별 선 모양이 다 있으면 전체 선(polyline)은 같은 내용이라 빼고 보냄 (웹앱이 단계 선을 이어 붙여 복원)
      const fromSteps = steps.length > 0 && steps.every(x => x.poly);
      segments.push({
        steps: steps,              // 도보·승차·환승·하차 단계 (대중교통만)
        fromSteps: fromSteps,
        date: date,
        fromOrder: Number(seg[0]),
        toOrder: Number(seg[1]),
        mode: v[R.MODE - 1],
        dep: v[R.DEP - 1],
        arr: v[R.ARR - 1],
        minutes: Number(v[R.MIN - 1]) || 0,
        summary: v[R.SUMMARY - 1],
        transfers: v[R.TRANSFER - 1],
        polyline: fromSteps ? '' : v[R.POLY - 1],
        link: from && to ? mapsLink_(from, to, v[R.MODE - 1]) : '',
        fare: from ? from.fare : null,
        warn: v[R.WARN - 1] && v[R.WARN - 1] !== 'OK' ? v[R.WARN - 1] : '',   // 배차 드묾 등
        pass: v[R.PASS - 1] || '',   // 주유패스 / 주유패스 일부
        passFare: Number(String(v[R.FARE - 1] || '').replace(/[^\d]/g, '')) || 0,   // 패스 적용 전 원래 요금 (1인)
        walkHint: walkHint_(v[R.MODE - 1], Number(v[R.MIN - 1]) || 0, v[R.WALK - 1], v[R.SUMMARY - 1]),   // 도보 추천
        taxi: segTaxi_(v, from, travelers),   // 택시 비교·택시로 가기 상태
        last: String(v[R.LAST - 1] || ''),     // 막차 출발 시각 / 지남 / - / 빈 칸
      });
    });
  }

  const dates = Array.from(new Set(points.map(p => p.date))).sort();
  return {
    dates: dates,
    points: points,
    segments: segments,
    overnight: overnight,
    rate: rate,
    walk: walk,
    walkWarnKm: CONFIG.WALK_DAY_KM,
    closeSoonMin: CONFIG.CLOSE_SOON_MIN,
    tzOffsetMin: tzOffsetMin_(dates[0]),   // 일몰 계산용 (여행 시간대, 분)
    weather: getWeather_(points),
    places: places.map(p => ({
      key: p.key, name: p.name, alias: p.alias, type: p.type, city: p.city, area: p.area, costMin: p.costMin, costMax: p.costMax,
      hours: p.hours, closed: p.closed, menu: p.menu, intro: p.intro, memo: p.memo,
      link: p.link, lat: p.lat, lng: p.lng, photos: p.photos, web: p.web, ja: p.ja, addr: p.addr,
    })),
  };
}

// 여행 시간대의 UTC 차이(분). Asia/Tokyo → 540. 날짜 주면 그날 기준 (서머타임 있는 곳 대비)
function tzOffsetMin_(date) {
  const d = date ? new Date(date + 'T12:00:00Z') : new Date();
  const m = Utilities.formatDate(d, CONFIG.TRIP_TZ, 'Z').match(/([+-])(\d{2})(\d{2})/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 540;
}