// 여행 데이터 모델. 서버가 준 원본(raw)을 사용자별 화면용 보기(view)로 만들고,
//  그 보기에서 "지금·다음", 지연 예측, 하루 요약 같은 걸 계산함. 화면 코드는 여기 함수만 부름
import { toMin, hhmm, toDateTime, tokyoNow } from './time.js';
import { cityColor, lineColor } from './colors.js';

/** 일정 점의 키 "날짜#순서" (도장·도착·지출 기록이 이 키로 저장됨) */
export const vk = p => p.date + '#' + p.order;

/**
 * 사용자 범위 날짜만 남긴 화면용 보기 + 빠른 조회용 색인
 * @param raw 서버 데이터  @param user 고른 사용자(없으면 전체)  @param pending 아직 서버에 안 간 기록 { visited, arrived, spend }
 */
export function buildView(raw, user, pending) {
  const inR = d => !user || (d >= user.from && d <= user.to);
  const points = raw.points.filter(p => inR(p.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
  const keys = new Set(points.map(p => p.placeKey).filter(Boolean));
  // 날짜 넘는 구간(밤버스 등): 서버가 overnight로 주거나, 예전 서버면 segments에 "13→1"처럼 거꾸로 섞여 옴
  const dl = raw.dates.slice().sort();
  const over = (raw.overnight || []).slice();
  const segs = [];
  raw.segments.forEach(s => {
    if (s.toOrder > s.fromOrder) { segs.push(s); return; }
    const toDate = dl[dl.indexOf(s.date) + 1];
    if (toDate && !over.some(o => o.date === s.date && o.fromOrder === s.fromOrder)) over.push(Object.assign({}, s, { toDate }));
  });
  const allPlaces = raw.places || [];
  const v = Object.assign({}, raw, {
    user: user || null,
    dates: raw.dates.filter(inR),
    points,
    segments: segs.filter(s => inR(s.date)),
    overnight: over.filter(s => inR(s.date) && inR(s.toDate)),
    places: allPlaces.filter(p => keys.has(p.key)),   // 일정에 나오는 장소만
    allPlaces,                                        // 일정 밖 추천 장소까지
    visited: Object.assign({}, user && raw.visitedBy ? raw.visitedBy[user.id] : null, pending && pending.visited),
    arrived: Object.assign({}, user && raw.arrivedBy ? raw.arrivedBy[user.id] : null, pending && pending.arrived),
    spend: Object.assign({}, raw.spend, pending && pending.spend),
  });
  // 대기 중인 "지움"은 null로 들어옴 → 키째 뺌
  ['visited', 'arrived', 'spend'].forEach(k => Object.keys(v[k]).forEach(x => { if (v[k][x] == null || v[k][x] === 0 || v[k][x] === '') delete v[k][x]; }));

  v.placeByKey = new Map(allPlaces.map(p => [p.key, p]));
  v.pointsByDate = new Map();
  points.forEach(p => { if (!v.pointsByDate.has(p.date)) v.pointsByDate.set(p.date, []); v.pointsByDate.get(p.date).push(p); });
  v.segFrom = new Map(v.segments.map(s => [s.date + '#' + s.fromOrder, s]));
  v.segTo = new Map(v.segments.map(s => [s.date + '#' + s.toOrder, s]));
  return v;
}

export function placeOf(v, p) { return p && p.placeKey ? v.placeByKey.get(p.placeKey) || null : null; }
/** 화면에 쓰는 장소 이름 (별칭 있으면 별칭) */
export function pname(v, p) { const pl = placeOf(v, p); return pl && pl.alias ? pl.alias : (p ? p.place : ''); }
export function dayPoints(v, date) { return v.pointsByDate.get(date) || []; }

/** 여행 전체 시작·끝 시각 */
export function tripRange(v) {
  const pts = v.points;
  if (!pts.length) return null;
  const first = pts[0], last = pts[pts.length - 1];
  return {
    start: toDateTime(first.date, first.arrive || first.depart) || new Date(first.date + 'T00:00:00+09:00'),
    end: toDateTime(last.date, last.depart || last.arrive) || new Date(last.date + 'T23:59:00+09:00'),
    first, last,
  };
}

/** 여행 단계: 'before' | 'during' | 'after' | 'empty' */
export function phase(v, now = new Date()) {
  const r = tripRange(v);
  if (!r) return 'empty';
  return now < r.start ? 'before' : now > r.end ? 'after' : 'during';
}

/** 그날 대표 도시 (교통 말고 가장 많이 나오는 도시) */
export function dayCity(v, date) {
  const cnt = {};
  dayPoints(v, date).forEach(p => {
    const pl = placeOf(v, p);
    if (!pl || !pl.city) return;
    cnt[pl.city] = (cnt[pl.city] || 0) + (pl.type === '교통' ? 0.3 : 1);
  });
  const name = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
  return { name, color: cityColor(name) || '' };
}

/** 그날 지나는 도시 순서 (연속 중복 제거) → [{ name, color }] */
export function dayRoute(v, date) {
  const out = [];
  dayPoints(v, date).forEach(p => {
    const pl = placeOf(v, p);
    const c = pl && pl.city;
    if (c && (!out.length || out[out.length - 1].name !== c)) out.push({ name: c, color: cityColor(c) || '' });
  });
  return out;
}

/* ── 기록: 도장·실제 도착 ── */

export function isVisited(v, p) { return !!v.visited[vk(p)]; }
export function arrivedAt(v, p) { return v.arrived[vk(p)] || null; }

/** 그날 마지막으로 도착 기록한 곳 기준 지연(분). 자정 넘김 보정. 기록 없으면 null */
export function dayDelay(v, date) {
  let ref = null;
  dayPoints(v, date).forEach(p => {
    const a = arrivedAt(v, p), pm = toMin(p.arrive);
    if (!a || pm == null) return;
    let d = toMin(a) - pm;
    if (d < -720) d += 1440;
    if (d > 720) d -= 1440;
    ref = { order: p.order, delay: d, at: a, p };
  });
  return ref;
}

/** 기록한 곳 이후 장소는 같은 지연만큼 밀린다고 보고 예상 도착(분). 예측할 게 없으면 null */
export function predictedMin(v, p) {
  const r = dayDelay(v, p.date);
  const pm = toMin(p.arrive);
  if (!r || p.order <= r.order || pm == null) return null;
  return pm + r.delay;
}

/** 실제 도착이 계획보다 몇 분 차이인지 (늦으면 +) */
export function arrivalDiff(v, p) {
  const a = arrivedAt(v, p), pm = toMin(p.arrive);
  if (!a || pm == null) return null;
  let d = toMin(a) - pm;
  if (d < -720) d += 1440;
  return d;
}

/* ── 지금 / 다음 ── */

/**
 * 지금 머무는 곳(cur), 다음 갈 곳(next), 그다음(after). 오늘 일정이 없으면 다가오는 일정에서 찾음
 * @param nt tokyoNow() 결과
 */
export function nowNext(v, nt = tokyoNow()) {
  const today = dayPoints(v, nt.date);
  const list = today.length ? today : v.points.filter(p => p.date > nt.date).slice(0, 3);
  let cur = null, nextIdx = -1;
  list.forEach((p, i) => {
    const a = toMin(p.arrive), d = toMin(p.depart);
    if (p.date === nt.date && a != null && d != null && a <= nt.min && nt.min <= d) cur = p;
    if (nextIdx === -1 && (p.date > nt.date || (a != null && a > nt.min))) nextIdx = i;
  });
  let next = nextIdx >= 0 ? list[nextIdx] : null;
  let after = nextIdx >= 0 ? list[nextIdx + 1] || null : null;
  // 오늘 남은 게 없으면 내일 첫 장소를 다음으로
  if (!next && today.length) next = v.points.find(p => p.date > nt.date) || null;
  return { cur, next, after, today };
}

/** 다음 장소까지 남은 분 (지연 예측 반영). 오늘이 아니면 null */
export function remainMin(v, p, nt) {
  if (!p || p.date !== nt.date) return null;
  const pr = predictedMin(v, p);
  const a = pr != null ? pr : toMin(p.arrive);
  return a == null ? null : a - nt.min;
}

/**
 * 그날 장소마다의 상태: 'now'(머무는 중) | 'next'(다음 갈 곳) | 'past'(지남) | 'future'
 * @returns Map<order, state>
 */
export function stopStates(v, date, nt = tokyoNow()) {
  const out = new Map();
  const pts = dayPoints(v, date);
  if (date < nt.date) { pts.forEach(p => out.set(p.order, 'past')); return out; }
  if (date > nt.date) { pts.forEach(p => out.set(p.order, 'future')); return out; }
  let marked = false;
  pts.forEach(p => {
    const a = toMin(p.arrive), d = toMin(p.depart);
    if (a != null && d != null && a <= nt.min && nt.min <= d) { out.set(p.order, 'now'); marked = true; }
    else if ((d != null ? d : a) != null && (d != null ? d : a) < nt.min) out.set(p.order, 'past');
    else out.set(p.order, 'future');
  });
  // 머무는 곳이 없으면(이동 중) 처음 다가오는 곳이 '다음'. 머무는 중이어도 그 뒤 첫 곳은 '다음'
  const nx = pts.find(p => { const a = toMin(p.arrive); return a != null && a > nt.min; });
  if (nx && out.get(nx.order) === 'future') out.set(nx.order, 'next');
  return out;
}

/* ── 하루 요약 (돈·걷기) ── */

/** 그날 1인당 예산 합계와 결제 여부 (같은 예산 번호는 한 번만). 원화 기준 */
export function daySpend(v, date) {
  const seen = {};
  let total = 0, paid = 0;
  dayPoints(v, date).forEach(p => {
    if (!p.per) return;
    const key = p.budgetId || vk(p);
    if (seen[key]) return;
    seen[key] = true;
    total += p.per;
    if (p.paid) paid += p.per;
  });
  return { total, paid, left: total - paid };
}

/** 그날 교통비 1인 합계(엔)와 요금 미입력 구간 수 */
export function dayFare(v, date) {
  let sum = 0, missing = 0;
  dayPoints(v, date).forEach(p => {
    const s = v.segFrom.get(vk(p));
    if (!s) return;
    if (p.fare == null || isNaN(p.fare)) { if (s.mode === '대중교통' || s.mode === '수동') missing++; return; }
    sum += p.fare;
  });
  return { sum, missing };
}

/** 그날 실제 지출 합계(엔) vs 계획(엔). 기록이 없으면 has=false */
export function dayActual(v, date) {
  let actual = 0, has = false, plan = 0;
  const seen = {};
  dayPoints(v, date).forEach(p => {
    const sp = v.spend[vk(p)];
    if (sp) { actual += sp.amount; has = true; }
    if (p.yen != null && !isNaN(p.yen)) {
      const k = p.budgetId || vk(p);
      if (!seen[k]) { seen[k] = true; plan += p.yen; }
    }
  });
  return { actual, plan, has };
}

/** 그날 걷는 거리 { km, min, many } 또는 null */
export function dayWalk(v, date) {
  const w = v.walk && v.walk[date];
  if (!w || !w.m) return null;
  const km = w.m / 1000;
  return { km, min: w.min || 0, many: !!(v.walkWarnKm && km >= v.walkWarnKm) };
}

/* ── 이동 구간 ── */

export const MODE_KEY = { '대중교통': 'transit', '도보': 'walk', '차': 'car', '수동': 'manual' };
/** 구간 표시 이름. 택시로 바꿔 둔 구간은 택시, 시트에 직접 적은 구간(수동)은 그냥 '이동' */
export function segModeName(s) { return s.taxi && s.taxi.on ? '택시' : s.mode === '수동' ? '이동' : s.mode; }

/**
 * 구간에서 타는 노선들 [{ line, color, vehicle }] (배지용)
 *  같은 노선을 연달아 타면(급행→보통 갈아타기 등) 배지는 하나만. 갈아타는 건 단계 줄과 "환승 N회"가 보여줌
 */
export function segRides(s) {
  if (!Array.isArray(s.steps)) return [];
  return s.steps.filter(x => x.t === 'transit')
    .filter((x, i, a) => i === 0 || x.line !== a[i - 1].line)
    .map(x => ({
      line: x.line, vehicle: x.vehicle || '', color: x.color || lineColor(x.line + ' ' + (x.full || '')) || '',
    }));
}

/**
 * 막차 안내. 서버가 구간마다 last("23:42" / "0:15 (+1)" / "지남" / "-")를 줌
 * @returns {{level:'over'|'tight'|'info', text:string}|null}
 */
export function lastTrain(s, nt = tokyoNow()) {
  const val = String((s && s.last) || '');
  if (!val || val === '-') return null;
  if (val === '지남') return { level: 'over', text: '이 시각엔 막차 끊김 (대중교통 경로 없음)' };
  let lm = toMin(val);
  if (lm == null) return null;
  if (/\(\+1\)/.test(val)) lm += 1440;
  let dep = toMin(s.dep);
  if (dep != null && (/\(\+1\)/.test(String(s.dep)) || dep < 4 * 60)) dep += 1440;
  const hm = val.replace(/\s*\(\+1\)/, '');
  if (s.date === nt.date) {
    const now = nt.min < 4 * 60 ? nt.min + 1440 : nt.min;
    if (now > lm) return { level: 'over', text: '막차 출발(' + hm + ') 지남' };
    if (lm - now <= 60) return { level: 'tight', text: '막차까지 ' + (lm - now) + '분 (' + hm + '까지 출발)' };
  }
  const margin = dep != null ? lm - dep : null;
  return {
    level: margin != null && margin < 30 ? 'tight' : 'info',
    text: '막차 타려면 ' + hm + '까지 출발' + (margin != null ? ', 여유 ' + margin + '분' : ''),
  };
}

export { hhmm };
