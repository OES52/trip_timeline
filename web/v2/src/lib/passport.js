// 기록 화면 로직 (순수): 여권 도장, 금박, 하루 영수증, 여행 전체 돈 요약
import { vk, isVisited, arrivedAt, pname, placeOf, dayPoints, dayRoute, dayFare, dayWalk } from './trip.js';

/** 장소 종류별 도장 잉크 (여권 종이 위에서 4.5:1 이상) */
export const INK = { '숙소': '#5B3FA8', '식당': '#B23A0E', '카페': '#6E4E3C', '관광지': '#1D4ED8', '쇼핑': '#B0185A', '교통': '#3F4B5E', '기타': '#5A606B' };

/** 문자열 → 0 이상 정수 (도장 기울기·번짐 모양을 장소마다 고정) */
export function hashNum(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

/** 여권 칸 열쇠: 장소 키, 없으면 이름 */
export const slotKey = p => p.placeKey || 'n:' + p.place;

/**
 * 여권에 올라갈 장소: 일정 순서대로, 같은 장소는 처음 나오는 날 한 칸
 * @returns {{ key, date, point, place, name, type, visits }[]}
 */
export function passSlots(v) {
  const seen = new Map(), out = [];
  v.points.forEach(p => {
    const k = slotKey(p);
    if (!seen.has(k)) {
      const pl = placeOf(v, p);
      const s = { key: k, date: p.date, point: p, place: pl, name: pname(v, p), type: (pl && pl.type) || '기타', points: [], visits: [] };
      seen.set(k, s);
      out.push(s);
    }
    const s = seen.get(k);
    s.points.push(p);
    if (isVisited(v, p)) s.visits.push(p);
  });
  return out;
}

/**
 * 금박 도장 이유 (없으면 ''). 숙소·교통 빼고: 재방문 > 2시간 넘게 머묾 > 저녁 6시 넘어 들른 관광지·쇼핑
 */
export function rareOf(v, slot) {
  const vs = slot.visits;
  if (!vs.length || slot.type === '숙소' || slot.type === '교통') return '';
  if (vs.length >= 2) return '재방문';
  if (vs.some(p => (p.stay || 0) >= 120)) return '오래 머묾';
  if ((slot.type === '관광지' || slot.type === '쇼핑') && vs.some(p => { const m = /^(\d+):/.exec(arrivedAt(v, p) || p.arrive || ''); return m && Number(m[1]) >= 18; })) return '밤 풍경';
  return '';
}

/** 여권 전체: 날짜별 칸, 찍은 수, 금박 수 */
export function passport(v) {
  const slots = passSlots(v).map(s => Object.assign(s, { rare: rareOf(v, s) }));
  const days = v.dates.map(d => ({ date: d, slots: slots.filter(s => s.date === d) })).filter(d => d.slots.length);
  return { slots, days, got: slots.filter(s => s.visits.length).length, gold: slots.filter(s => s.rare).length };
}

/**
 * 하루 영수증
 * @param nt tokyoNow() 결과 (앞으로 올 날이면 "예정")
 */
export function receipt(v, date, nt, userId) {
  const pts = dayPoints(v, date);
  const items = pts.map(p => {
    const sp = v.spend[vk(p)];
    return { key: vk(p), time: arrivedAt(v, p) || p.arrive || '', name: pname(v, p), done: isVisited(v, p), amount: sp ? Number(sp.amount) || 0 : null, memo: sp && sp.memo ? sp.memo : '' };
  });
  const fare = dayFare(v, date).sum;
  const spent = items.reduce((a, x) => a + (x.amount || 0), 0);
  const w = dayWalk(v, date);
  const no = v.dates.indexOf(date) + 1;
  return {
    date, no, user: userId || '-', route: dayRoute(v, date).map(x => x.name).join(' → '),
    items, stamps: items.filter(x => x.done).length, total: items.length,
    walkKm: w ? w.km : null, walkMin: w ? w.min : null,
    fare, spent, sum: spent + fare,
    planned: date > nt.date || (date === nt.date && !items.some(x => x.done || x.amount != null)),
  };
}

/**
 * 여행 전체 돈: 쓴 돈(기록), 교통비, 예산(엔), 날짜별 합
 * @returns {{ spent, fare, plan, days: { date, spent, fare, plan, n }[], n }}
 */
export function moneySummary(v) {
  const days = v.dates.map(d => {
    let spent = 0, n = 0, plan = 0;
    const seen = {};
    dayPoints(v, d).forEach(p => {
      const sp = v.spend[vk(p)];
      if (sp) { spent += Number(sp.amount) || 0; n++; }
      if (p.yen != null && !isNaN(p.yen)) { const k = p.budgetId || vk(p); if (!seen[k]) { seen[k] = 1; plan += p.yen; } }
    });
    return { date: d, spent, fare: dayFare(v, d).sum, plan, n };
  });
  const sum = k => days.reduce((a, d) => a + d[k], 0);
  return { days, spent: sum('spent'), fare: sum('fare'), plan: sum('plan'), n: sum('n') };
}
