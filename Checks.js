/* ───────────────────────── 일정 점검 ───────────────────────── */
/* Checks.gs  */
// 경로 계산이 끝난 뒤 일정 전체를 훑어서 문제를 모음 (API 호출 없음)
//  1. 영업시간·휴무 충돌 (교통·숙소 종류는 영업시간 비교 제외: 역 첫차 시각 같은 게 걸려서)
//  2. 메모 속 마감 시각 넘김 ("15시 전까지", "21시까지", "최종 입장 16:30", "L.O. 19:45" 등)
//  3. 고정 시각 빠듯함 (그날 첫 행 빼고, 여유 FIXED_TIGHT_MIN분 미만이거나 늦음)
//  4. 막차 시간대(LAST_TRAIN_FROM 이후) 출발 대중교통
//  5. 시작점→종착점(관통) 걷는 시간이 체류보다 김
// 하루 도보량(walkByDate_), 택시 비교(taxiInfo_, taxiHint_)도 여기 둠. 웹앱(WebApps.gs)도 같이 씀

// 웹앱에서 "택시로 가기" 체크한 구간: 출발 장소 메모 맨 앞에 [택시 · 대중교통 41분] (원래 수단·원래 소요)
const TAXI_TAG_RE = /\[택시(?:\s*·\s*([^\s\]]+)(?:\s+(\d+)분)?)?\]/;

// "17:27", "25:10" → 분
function hmToMin_(s) {
  const m = String(s || '').match(/^\s*(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// 분 → "17:27" (자정 넘으면 24시 기준으로 접음)
function minToHm_(min) { return (Math.floor(min / 60) % 24) + ':' + pad2_(min % 60); }

// "11:00~15:00, 17:00~22:00" → [[660,900],[1020,1320]]. 자정 넘는 종료는 +24h
function parseHoursRanges_(text) {
  const out = [];
  const re = /(\d{1,2}):(\d{2})\s*[~\-–〜]\s*(\d{1,2}):(\d{2})/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const a = Number(m[1]) * 60 + Number(m[2]);
    let b = Number(m[3]) * 60 + Number(m[4]);
    if (b <= a) b += 1440;
    out.push([a, b]);
  }
  return out;
}

// 휴무 칸에서 요일·날짜(12/31, 12/30~1/3) 읽어서 그날이 휴무인지 (웹앱 closedOn과 같은 규칙)
function closedOnDate_(text, date) {
  const t = String(text || '');
  if (!t || /연중무휴|무휴|없음/.test(t)) return false;
  const [y, mo, d] = date.split('-').map(Number);
  const dow = '일월화수목금토'[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const tokens = t.split(/[\s,，/·、]+/);
  if (tokens.some(x => x === dow || x === dow + '요일' || x === dow + '요')) return true;
  if (new RegExp(dow + '요일').test(t)) return true;
  const re = /(\d{1,2})\/(\d{1,2})(?:\s*[~\-–〜]\s*(\d{1,2})\/(\d{1,2}))?/g;
  let m;
  const md = mo * 100 + d;
  while ((m = re.exec(t))) {
    const a = Number(m[1]) * 100 + Number(m[2]);
    const b = m[3] ? Number(m[3]) * 100 + Number(m[4]) : a;
    if (a <= b ? (md >= a && md <= b) : (md >= a || md <= b)) return true;
  }
  return false;
}

// 메모 속 마감 시각(분). 여러 개면 가장 이른 것. 없으면 null
//  "15시 전까지", "21시까지", "21시 30분까지", "20:00까지", "최종 입장 16:30", "L.O. 19:45", "라스트오더 20:00"
function memoDeadline_(memo) {
  const t = String(memo || '');
  const out = [];
  const pats = [
    /(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?\s*(?:전)?\s*까지/g,
    /(\d{1,2}):(\d{2})\s*(?:전)?\s*까지/g,
    /최종\s*(?:입장|탑승|주문|접수)?\s*(\d{1,2}):(\d{2})/g,
    /(?:L\.?\s*O\.?|라스트\s*오더)\s*(\d{1,2}):(\d{2})/gi,
  ];
  pats.forEach(re => {
    let m;
    while ((m = re.exec(t))) out.push(Number(m[1]) * 60 + Number(m[2] || 0));
  });
  return out.length ? Math.min.apply(null, out) : null;
}

// 영업시간 칸 형식: 기본 시간표 + 요일별·날짜별 예외를 " / "(앞뒤 띄움)로 이어 붙임
//  "11:00~15:00, 17:00~22:00 / 토·일 11:00~22:00 / 12/31 11:00~18:00 / 1/1 휴무"
//  요일은 "토·일", "월~금", "토요일" 다 됨. 그날 시간표 고르는 순서: 날짜 > 요일 > 기본
//  웹앱 hoursFor()와 같은 규칙
const HOURS_DOW_ = '일월화수목금토';
function hoursDowSet_(label) {
  const t = String(label).replace(/요일/g, '');
  const set = {};
  const rg = t.match(/^([일월화수목금토])\s*[~\-–〜]\s*([일월화수목금토])$/);
  if (rg) {
    let i = HOURS_DOW_.indexOf(rg[1]);
    const j = HOURS_DOW_.indexOf(rg[2]);
    for (let k = 0; k < 7; k++) { set[i] = true; if (i === j) break; i = (i + 1) % 7; }
    return set;
  }
  t.split(/[\s·,，、]+/).forEach(c => { const i = HOURS_DOW_.indexOf(c); if (i >= 0) set[i] = true; });
  return set;
}

// date(yyyy-MM-dd)의 시간표 → { text, label, closed, ranges } / 칸이 비었으면 null
function hoursForDate_(text, date) {
  const t = String(text || '').trim();
  if (!t) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const md = mo * 100 + d;
  let base = null, byDow = null, byDate = null;
  t.split(/\s+\/\s+|\s*;\s*/).forEach(seg => {
    seg = seg.trim();
    if (!seg) return;
    let m = seg.match(/^(\d{1,2})\/(\d{1,2})(?:\s*[~\-–〜]\s*(\d{1,2})\/(\d{1,2}))?\s+(.+)$/);
    if (m) {
      const a = Number(m[1]) * 100 + Number(m[2]);
      const b = m[3] ? Number(m[3]) * 100 + Number(m[4]) : a;
      if (!byDate && (a <= b ? (md >= a && md <= b) : (md >= a || md <= b))) byDate = { body: m[5], label: seg.slice(0, seg.length - m[5].length).trim() };
      return;
    }
    m = seg.match(/^([일월화수목금토](?:요일)?(?:\s*[·,~\-–〜]\s*[일월화수목금토](?:요일)?)*)\s+(.+)$/);
    if (m) {
      if (!byDow && hoursDowSet_(m[1])[dow]) byDow = { body: m[2], label: m[1] };
      return;
    }
    if (!base) base = { body: seg, label: '' };
  });
  const pick = byDate || byDow || base;
  if (!pick) return null;
  const ranges = parseHoursRanges_(pick.body);
  return { text: pick.body, label: pick.label, closed: !ranges.length && /휴무|휴업|closed/i.test(pick.body), ranges: ranges };
}

// 도착·출발 시각과 그날 영업시간 비교 → 문구 (문제 없으면 '')
//  type이 식당·카페면 마감 CLOSE_SOON_MIN분 안쪽 도착도 경고 (라스트오더 대용)
function hoursIssue_(hours, a, d, date, type) {
  const h = date ? hoursForDate_(hours, date) : { ranges: parseHoursRanges_(hours) };
  if (!h || a == null) return '';
  if (h.closed) return '이날 휴무 (영업시간 칸: ' + (h.label ? h.label + ' ' : '') + h.text + ')';
  const ranges = h.ranges;
  if (!ranges.length) return '';
  if (d != null && d < a) d += 1440;
  let inR = ranges.find(r => a >= r[0] && a < r[1]);
  let aa = a;
  // 새벽 도착: 자정 넘어 영업하는 칸(18:00~26:00 꼴)에 걸치는지
  if (!inR) { inR = ranges.find(r => a + 1440 >= r[0] && a + 1440 < r[1]); if (inR) aa = a + 1440; }
  const dd = d == null ? null : d + (aa - a);
  const day = h.label ? ' [' + h.label + ']' : '';
  if (!inR) {
    const nx = ranges.filter(r => r[0] > a).sort((x, y) => x[0] - y[0])[0];
    return nx
      ? '영업 전 도착 (' + minToHm_(nx[0]) + ' 오픈, ' + minToHm_(a) + ' 도착)' + day
      : '영업 끝난 뒤 도착 (' + minToHm_(Math.max.apply(null, ranges.map(r => r[1]))) + ' 종료, ' + minToHm_(a) + ' 도착)' + day;
  }
  if ((type === '식당' || type === '카페') && inR[1] - aa < CONFIG.CLOSE_SOON_MIN) {
    return '마감 ' + minToHm_(inR[1]) + ' 직전 도착 (' + minToHm_(a) + ', 라스트오더 확인)' + day;
  }
  if (dd != null && dd > inR[1]) return '머무는 중 영업 종료 (' + minToHm_(inR[1]) + ' 종료, ' + minToHm_(d % 1440) + ' 출발)' + day;
  return '';
}

// 일정 점검 1~4. rows: 경로 계산 뒤 다시 읽은 일정 행 / routeRows: 경로 시트에 쓴 값 / places: 장소 시트
function runChecks_(rows, routeRows, places) {
  const issues = [];
  const md = d => d.slice(5).replace('-', '/');
  groupByDate_(rows).forEach(g => {
    g.rows.forEach((r, idx) => {
      const tag = md(g.date) + ' ' + r.order + '번 ' + r.place + ': ';
      const a = hmToMin_(r.arrive), d = hmToMin_(r.depart);

      // 2. 메모 마감
      const dl = memoDeadline_(r.memo);
      if (dl != null && a != null && a > dl) issues.push(tag + '메모 마감 ' + minToHm_(dl) + ' 넘김 (' + r.arrive + ' 도착)');

      // 3. 고정 시각 빠듯함
      const slack = Number(r.slack);
      if (idx > 0 && r.fixed != null && r.slack !== '' && r.slack != null && !isNaN(slack) && slack < CONFIG.FIXED_TIGHT_MIN) {
        issues.push(tag + (slack < 0 ? '고정 ' + fmtMin_(r.fixed) + '보다 ' + (-slack) + '분 늦음' : '고정 ' + fmtMin_(r.fixed) + '까지 여유 ' + slack + '분 (빠듯)'));
      }

      // 5. 관통 도보 > 체류
      const iw = innerWalk_(r, false);
      if (iw && iw.min > r.stay) {
        issues.push(tag + '시작점→종착점 걷기만 ' + iw.min + '분' + (iw.est ? ' (어림)' : '') + ', 체류 ' + r.stay + '분보다 김');
      }

      // 1. 영업시간·휴무
      const pl = places.find(p => samePlace_(p, { name: r.place, link: r.link, lat: r.lat, lng: r.lng }));
      if (!pl) return;
      const off = closedOnDate_(pl.closed, g.date);
      if (off) issues.push(tag + '이날 휴무 (' + pl.closed + ')');
      if (!off && CONFIG.PLACES_SKIP_TYPES.indexOf(pl.type) === -1) {
        const w = hoursIssue_(pl.hours, a, d, g.date, pl.type);
        if (w) issues.push(tag + w);
      }
    });
  });

  // 4. 막차 시간대
  routeRows.forEach(v => {
    if (v[R.MODE - 1] !== '대중교통') return;
    const depText = String(v[R.DEP - 1] || '');
    let dep = hmToMin_(depText);
    if (dep == null) return;
    if (/\(\+1\)/.test(depText)) dep += 1440;
    const last = String(v[R.LAST - 1] || '');
    const where = md(String(v[R.DATE - 1])) + ' ' + v[R.FROM - 1] + ' → ' + v[R.TO - 1] + ': ';
    if (last === '지남') { issues.push(where + depText + ' 출발이면 이미 막차 끊김 (대중교통 경로 없음)'); return; }
    let lm = hmToMin_(last);
    if (lm != null) {
      if (/\(\+1\)/.test(last)) lm += 1440;
      if (lm - dep < CONFIG.LAST_WARN_MARGIN) issues.push(where + '🌙 막차 타려면 ' + last + '까지 출발, 계획(' + depText + ') 기준 여유 ' + (lm - dep) + '분');
      return;
    }
    if (last === '-') return;
    if (dep >= CONFIG.LAST_TRAIN_FROM) {
      issues.push(md(String(v[R.DATE - 1])) + ' ' + v[R.FROM - 1] + ' → ' + v[R.TO - 1] + ': ' + depText + ' 출발, 막차 시간대 (막차 시각 확인)');
    }
  });
  return issues;
}

// 날짜별 걸은 거리(m)·시간(분): 도보 구간 + 대중교통 안 도보 단계 + 장소 안 시작점→종착점(저장된 도보 경로, 없으면 직선×1.3)
// routeVals: 경로 시트 행 값(ROUTE_HEADERS 순서) / rows: 일정 행 (종착점용, 없어도 됨)
function walkByDate_(routeVals, rows) {
  const out = {};
  const add = (date, m, min) => {
    const o = out[date] = out[date] || { m: 0, min: 0 };
    o.m += m || 0;
    o.min += min || 0;
  };
  routeVals.forEach(v => {
    const date = String(v[R.DATE - 1] || '');
    if (!date) return;
    const mode = v[R.MODE - 1];
    if (mode === '도보') {
      const mm = String(v[R.SUMMARY - 1] || '').match(/([\d.]+)\s*(km|m)\b/);
      add(date, mm ? Number(mm[1]) * (mm[2] === 'km' ? 1000 : 1) : 0, Number(v[R.MIN - 1]) || 0);
    } else if (mode === '대중교통') {
      let st = [];
      try { st = JSON.parse(v[R.STEPS - 1] || '[]'); } catch (e) { st = []; }
      (st || []).forEach(s => { if (s.t === 'walk') add(date, s.m, s.min); });
    }
  });
  (rows || []).forEach(r => {
    const iw = innerWalk_(r, false);
    if (iw) add(r.date, iw.m, iw.min);
  });
  Object.keys(out).forEach(k => { out[k].m = Math.round(out[k].m); out[k].min = Math.round(out[k].min); });
  return out;
}

// 출발지 좌표로 요금표 고르기
function taxiTariff_(lat, lng) {
  if (lat != null && lng != null) {
    const t = CONFIG.TAXI_TARIFFS.find(x => lat >= x.box[0] && lng >= x.box[1] && lat <= x.box[2] && lng <= x.box[3]);
    if (t) return t;
  }
  return CONFIG.TAXI_DEFAULT;
}

// 택시 요금 범위 [낮게, 높게] (엔, 10엔 단위)
//  낮게: 거리 운임만 (막힘 없이 갈 때)
//  높게: + 시간 가산 어림(정체로 늦어진 시간의 절반을 저속 주행으로 봄) × TAXI_MARGIN
//  22시~5시 출발이면 둘 다 심야 할증
function taxiFareRange_(meters, freeMin, trafficMin, departMin, lat, lng) {
  const t = taxiTariff_(lat, lng);
  const dist = t.base + Math.ceil(Math.max(0, meters - t.baseM) / t.stepM) * 100;
  const drive = Math.max(freeMin || 0, trafficMin || 0);
  const flow = meters / 1000 / 25 * 60;                  // 시속 25km로 막힘 없이 가는 시간
  const slowSec = Math.max(0, drive - flow) * 60 * 0.5;
  const timeAdd = Math.floor(slowSec / t.timeSec) * 100;
  const h = ((departMin || 0) % 1440 + 1440) % 1440;
  const night = (h >= 22 * 60 || h < 5 * 60) ? CONFIG.TAXI_NIGHT_RATE : 1;
  const r10 = n => Math.round(n / 10) * 10;
  return { low: r10(dist * night), high: r10((dist + timeAdd) * night * CONFIG.TAXI_MARGIN), area: t.name, night: night > 1 };
}

// 경로 시트 "택시" 칸("분|미터" 또는 "분|미터|정체 반영 분") → 시간·요금 범위·1인 요금. 칸이 비었거나 '-'면 null
//  departMin: 출발 시각(분, 심야 할증 판단) / lat·lng: 출발지 (요금표 고르기)
function taxiInfo_(cell, people, departMin, lat, lng) {
  const mm = String(cell || '').match(/^(\d+)\|(\d+)(?:\|(\d+))?$/);
  if (!mm) return null;
  const min = Number(mm[1]), meters = Number(mm[2]), traffic = mm[3] ? Number(mm[3]) : min;
  const f = taxiFareRange_(meters, min, traffic, departMin, lat, lng);
  const n = Math.max(1, Number(people) || 1);
  const per = v => Math.round(v / n / 10) * 10;
  return {
    min: Math.max(min, traffic), meters: meters,
    low: f.low, high: f.high, perLow: per(f.low), perHigh: per(f.high),
    people: n, area: f.area, night: f.night,
  };
}

// 경로 계산 결과창용 문구. 대중교통 구간에서 택시가 TAXI_HINT_SAVE분 이상 빠를 때만
function taxiHint_(mode, transitMin, taxi, people, departMin, lat, lng) {
  if (mode !== '대중교통') return '';
  const t = taxiInfo_(taxi, people, departMin, lat, lng);
  if (!t) return '';
  const saved = transitMin - t.min;
  if (saved < CONFIG.TAXI_HINT_SAVE) return '';
  const yen = n => '¥' + Math.round(n).toLocaleString('en-US');
  const range = (a, b) => a === b ? yen(a) : yen(a) + '~' + yen(b).slice(1);
  return '택시 약 ' + t.min + '분 · ' + range(t.low, t.high) +
    (t.people > 1 ? ' (1인 ' + range(t.perLow, t.perHigh) + ')' : '') +
    ' [' + t.area + ' 요금' + (t.night ? '·심야' : '') + '] — 대중교통 ' + transitMin + '분보다 ' + saved + '분 빠름';
}