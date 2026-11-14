// 할 일·예약·보여주기 카드·비상 연락처 (순수 로직)
import { pname, dayPoints } from './trip.js';

const dayNum = d => Date.parse(d + 'T00:00:00Z') / 864e5;
const forUser = (who, userId) => !who || !who.length || who.indexOf(userId) !== -1;

/** 이 사람에게 보일 할 일 (누구가 비었거나 이 사람이 들어 있음). 시트에서 날짜·시각 순으로 옴 */
export function myTodos(v, userId) {
  return (v.todos || []).filter(t => forUser(t.who, userId));
}

/** 할 일 날짜까지: "D-3" / "오늘" / "2일 지남". 날짜가 없으면 '' */
export function ddayText(date, today) {
  if (!date) return '';
  const n = Math.round(dayNum(date) - dayNum(today));
  return n > 0 ? 'D-' + n : n === 0 ? '오늘' : -n + '일 지남';
}

/** 예약이 붙는 일정 점: 날짜 + 순서, 순서가 없으면 그날 일정에서 장소 이름이 들어 있는 첫 곳 */
export function bookingPoint(v, b) {
  if (!b.date) return null;
  return dayPoints(v, b.date).find(p => (b.order != null ? p.order === b.order
    : !!b.place && (p.place.indexOf(b.place) !== -1 || pname(v, p).indexOf(b.place) !== -1))) || null;
}

/** 이 일정 점에 붙는 예약 */
export function bookingsFor(v, p, userId) {
  return (v.bookings || []).filter(b => b.date === p.date && forUser(b.who, userId) && bookingPoint(v, b) === p);
}

/**
 * 이 사람에게 보일 예약 [{ b, p }] (날짜 순, 날짜 없는 건 맨 뒤). 볼 수 있는 날짜 밖은 뺌
 * @param from 이 날짜부터 (지난 예약 빼기). 없으면 전부
 */
export function myBookings(v, userId, from) {
  const u = v.user;
  return (v.bookings || [])
    .filter(b => forUser(b.who, userId) && (!b.date || !u || (b.date >= u.from && b.date <= u.to)) && (!from || !b.date || b.date >= from))
    .map(b => ({ b, p: bookingPoint(v, b) }))
    .sort((x, y) => {
      const a = x.b.date || '9999', c = y.b.date || '9999';
      if (a !== c) return a < c ? -1 : 1;
      return (x.p ? x.p.order : 999) - (y.p ? y.p.order : 999);
    });
}

/** 보여주기 카드를 띄울 수 있는 장소인지 (일본어 이름이나 주소가 있음) */
export const canShow = pl => !!(pl && (pl.ja || pl.addr));

/**
 * 비상 연락처 한 줄 → { text, tel }. 줄 안의 전화번호(국가번호·하이픈 포함)를 찾아 tel: 주소로
 *  "여행자 보험 OO화재 +82-2-0000-0000" → { text, tel: '+82200000000' }
 */
export function phoneOf(line) {
  const m = String(line || '').match(/\+?\d[\d\-\s().]{5,}\d/);
  return { text: String(line || ''), tel: m ? m[0].replace(/[^\d+]/g, '') : '' };
}

/** 이 사람 일정에 나오는 숙소 (보여주기 카드용, 처음 나오는 순) */
export function lodgings(v) {
  const seen = new Set(), out = [];
  v.points.forEach(p => {
    const pl = p.placeKey ? v.placeByKey.get(p.placeKey) : null;
    if (!pl || pl.type !== '숙소' || seen.has(pl.key)) return;
    seen.add(pl.key);
    out.push(pl);
  });
  return out;
}
