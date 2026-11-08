/* ───────────────────────── 좌표 ───────────────────────── */
/* Util.gs  */
function resolveCoord_(r) {
  if (r.link) {
    const c = coordFromLink_(r.link);
    if (c) return Object.assign(c, { source: '지도 링크' });
  }
  try {
    const geocoder = Maps.newGeocoder().setLanguage(CONFIG.GEOCODE_LANG);
    if (CONFIG.GEOCODE_REGION) geocoder.setRegion(CONFIG.GEOCODE_REGION);
    const res = geocoder.geocode(r.place);
    if (res.status === 'OK' && res.results.length) {
      const top = res.results[0];
      return { lat: top.geometry.location.lat, lng: top.geometry.location.lng, source: '장소명 검색: ' + top.formatted_address };
    }
  } catch (e) {
    // 검색 실패
  }
  return null;
}

function coordFromLink_(url) {
  let u = url;
  // 짧은 공유 링크는 리다이렉트를 따라가서 전체 주소를 얻음
  for (let i = 0; i < 5 && /goo\.gl|maps\.app|g\.co\//.test(u); i++) {
    try {
      const resp = UrlFetchApp.fetch(u, { followRedirects: false, muteHttpExceptions: true });
      const h = resp.getHeaders();
      const loc = h['Location'] || h['location'];
      if (!loc) break;
      u = loc;
    } catch (e) {
      break;
    }
  }
  const patterns = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,                                  // 장소 정확한 좌표
    /[?&](?:q|query|ll|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,                                      // 지도 화면 중심
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = u.match(patterns[i]);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

function parseCoord_(s) {
  const m = String(s || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: lat, lng: lng };
}

// 다음 장소로 떠나는 지점: 종착점이 있으면 종착점, 없으면 시작점 (원래 행은 안 바꿈)
function departFrom_(r) {
  if (r.endLat == null || r.endLng == null) return r;
  return Object.assign({}, r, { lat: r.endLat, lng: r.endLng });
}

/* ───────────────────────── 읽기 공통 ───────────────────────── */

function readPlanRows_(plan, ssTz) {
  const lastRow = lastDataRow_(plan);
  if (lastRow < 2) return [];
  const range = plan.getRange(2, 1, lastRow - 1, PLAN_HEADERS.length);
  const vals = range.getValues();
  const disp = range.getDisplayValues();
  const rows = [];

  vals.forEach((v, i) => {
    const date = parseDateStr_(v[P.DATE - 1], disp[i][P.DATE - 1], ssTz);
    const place = String(v[P.PLACE - 1]).trim();
    if (!date || !place) return;
    const coord = parseCoord_(disp[i][P.COORD - 1]);
    const endCoord = parseCoord_(disp[i][P.END_COORD - 1]);
    const amount = v[P.AMOUNT - 1];
    rows.push({
      sheetRow: i + 2,
      date: date,
      order: Number(v[P.ORDER - 1]) || 0,
      activity: String(v[P.ACTIVITY - 1]).trim(),
      place: place,
      link: String(v[P.LINK - 1]).trim(),
      lat: coord ? coord.lat : null,
      lng: coord ? coord.lng : null,
      endLink: String(v[P.END_LINK - 1]).trim(),
      endLat: endCoord ? endCoord.lat : null,
      endLng: endCoord ? endCoord.lng : null,
      stay: Number(v[P.STAY - 1]) || 0,
      fixed: parseHHmm_(disp[i][P.FIXED - 1]),
      mode: String(v[P.MODE - 1]).trim(),
      manual: Number(v[P.MANUAL - 1]) || 0,
      memo: String(v[P.MEMO - 1]).trim(),
      budgetId: String(v[P.BUDGET_ID - 1]).trim(),
      amount: amount === '' || amount === null ? null : Number(amount),
      fare: v[P.FARE - 1] === '' || v[P.FARE - 1] === null ? null : Number(v[P.FARE - 1]),
      arrive: disp[i][P.ARRIVE - 1],
      depart: disp[i][P.DEPART - 1],
      slack: v[P.SLACK - 1],
    });
  });
  return rows;
}

function groupByDate_(rows) {
  const map = {};
  rows.forEach(r => { (map[r.date] = map[r.date] || []).push(r); });
  return Object.keys(map).sort().map(date => ({
    date: date,
    rows: map[date].sort((a, b) => a.order - b.order),
  }));
}

/* ───────────────────────── 시간 유틸 ───────────────────────── */

// 시트 표시값 기준으로 날짜 읽기 (시간대 차이로 하루 밀리는 문제 방지)
function parseDateStr_(value, display, ssTz) {
  const m = String(display || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  if (value instanceof Date) return Utilities.formatDate(value, ssTz, 'yyyy-MM-dd');
  return null;
}

// "08:30" → 510 (분)
function parseHHmm_(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 출발 시각·이동 시간 올림 단위 (분). 1이면 올림 안 함
function roundStep_() {
  return Math.max(1, Math.round(Number(CONFIG.ROUND_MIN) || 1));
}

// 분을 step 단위로 올림. 13 → 15, 876(14:36) → 880(14:40)
function ceilTo_(min, step) {
  return Math.ceil(Math.round(min) / step) * step;
}

// 510 → "08:30", 1500 → "01:00 (+1)"
function fmtMin_(min) {
  if (min == null || min === '') return '';
  const day = Math.floor(min / 1440);
  const rest = ((min % 1440) + 1440) % 1440;
  const s = pad2_(Math.floor(rest / 60)) + ':' + pad2_(rest % 60);
  return day > 0 ? s + ' (+' + day + ')' : s;
}

function toDate_(dateStr, minutes) {
  const base = Utilities.parseDate(dateStr + ' 00:00', CONFIG.TRIP_TZ, 'yyyy-MM-dd HH:mm');
  return new Date(base.getTime() + minutes * 60000);
}

// 오늘 이후 가장 가까운 같은 요일, 같은 시각
function proxyDate_(target) {
  const tz = CONFIG.TRIP_TZ;
  const targetDow = Utilities.formatDate(target, tz, 'u');
  const hhmm = Utilities.formatDate(target, tz, 'HH:mm');
  const now = new Date();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    if (Utilities.formatDate(d, tz, 'u') === targetDow) {
      return Utilities.parseDate(Utilities.formatDate(d, tz, 'yyyy-MM-dd') + ' ' + hhmm, tz, 'yyyy-MM-dd HH:mm');
    }
  }
  return target;
}

function pad2_(n) { return String(n).padStart(2, '0'); }

/* ───────────────────────── 기타 유틸 ───────────────────────── */

function mapsLink_(from, to, mode) {
  const o = from.lat != null ? from.lat + ',' + from.lng : encodeURIComponent(from.place);
  const d = to.lat != null ? to.lat + ',' + to.lng : encodeURIComponent(to.place);
  return 'https://www.google.com/maps/dir/?api=1&origin=' + o + '&destination=' + d + '&travelmode=' + (MODE_URL[mode] || 'transit');
}

// 메뉴 함수 잠금: 웹앱(google.script.run)에서 부르면 막음. 시트 화면에서만 getUi()가 됨
function requireSheetUi_() {
  try { SpreadsheetApp.getUi(); } catch (e) { throw new Error('시트 메뉴에서만 실행할 수 있음'); }
}

// 헤더 비교용: 줄바꿈·공백 무시 ("체류⏎(분)" == "체류(분)")
function hn_(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }

// 1 → A, 27 → AA
function colL_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// 함수가 전체 행에 채워져 있어서 getLastRow()는 못 씀. 일자나 장소가 있는 마지막 행
function lastDataRow_(sh) {
  const max = sh.getMaxRows();
  if (max < 2) return 1;
  const v = sh.getRange(2, 1, max - 1, P.PLACE).getDisplayValues();
  for (let i = v.length - 1; i >= 0; i--) {
    if (v[i][P.DATE - 1] !== '' || v[i][P.PLACE - 1] !== '') return i + 2;
  }
  return 1;
}

function ensureColumns_(sh, n) {
  const have = sh.getMaxColumns();
  if (have < n) sh.insertColumnsAfter(have, n - have);
}

function alert_(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg); // 편집기에서 직접 실행한 경우
  }
}