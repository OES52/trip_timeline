// 할 일·예약·보여주기 카드·비상 연락처 (순수 로직)
import { pname, dayPoints } from './trip.js';
import { dayLabel } from './time.js';

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

/** 예약의 날짜 목록 ['2026-12-26', ...]. 예전 서버 데이터(date만 있음)도 지원 */
export function bookingDates(b) {
  if (!b) return [];
  if (Array.isArray(b.dates) && b.dates.length) return b.dates;
  return b.date ? [b.date] : [];
}

/** 예약 날짜 표시: 하루면 "12/26 (토)", 이어진 기간이면 "12/26 (토) ~ 12/27 (일)", 떨어져 있으면 쉼표 */
export function bookingDateText(b) {
  const ds = bookingDates(b);
  if (!ds.length) return '';
  if (ds.length === 1) return dayLabel(ds[0]);
  const cont = ds.every((d, i) => i === 0 || Math.round(dayNum(d) - dayNum(ds[i - 1])) === 1);
  return cont ? dayLabel(ds[0]) + ' ~ ' + dayLabel(ds[ds.length - 1]) : ds.map(dayLabel).join(', ');
}

/** 예약이 붙는 일정 점: 날짜 + 순서, 순서가 없으면 그날 일정에서 장소 이름이 들어 있는 첫 곳 */
export function bookingPoint(v, b, date) {
  const ds = bookingDates(b);
  if (!ds.length || (b.order == null && !b.place)) return null;
  const list = date ? (ds.indexOf(date) !== -1 ? [date] : []) : ds;
  for (const d of list) {
    const p = dayPoints(v, d).find(pt => (b.order != null ? pt.order === b.order
      : !!b.place && (pt.place.indexOf(b.place) !== -1 || pname(v, pt).indexOf(b.place) !== -1)));
    if (p) return p;
  }
  return null;
}

/** 이 일정 점에 붙는 예약 */
export function bookingsFor(v, p, userId) {
  return (v.bookings || []).filter(b =>
    forUser(b.who, userId) && bookingDates(b).indexOf(p.date) !== -1 && bookingPoint(v, b, p.date) === p
  );
}

/** 그날 내내 위에 고정해 둘 패스·종일 티켓 (날짜가 그날을 포함하고, 특정 일정 점에 붙지 않는 것) */
export function dayBookings(v, date, userId) {
  if (!date) return [];
  const u = v.user;
  if (u && (date < u.from || date > u.to)) return [];
  return (v.bookings || []).filter(b =>
    forUser(b.who, userId) && bookingDates(b).indexOf(date) !== -1 && !bookingPoint(v, b, date)
  );
}

/**
 * 이 사람에게 보일 예약 [{ b, p }] (날짜 순, 날짜 없는 건 맨 뒤). 볼 수 있는 날짜 밖은 뺌
 * @param from 이 날짜부터 (지난 예약 빼기). 없으면 전부
 */
export function myBookings(v, userId, from) {
  const u = v.user;
  return (v.bookings || [])
    .filter(b => {
      if (!forUser(b.who, userId)) return false;
      const ds = bookingDates(b);
      if (!ds.length) return true;
      if (u && !ds.some(d => d >= u.from && d <= u.to)) return false;
      if (from && !ds.some(d => d >= from)) return false;
      return true;
    })
    .map(b => ({ b, p: bookingPoint(v, b) }))
    .sort((x, y) => {
      const a = bookingDates(x.b)[0] || '9999', c = bookingDates(y.b)[0] || '9999';
      if (a !== c) return a < c ? -1 : 1;
      return (x.p ? x.p.order : 0) - (y.p ? y.p.order : 0);
    });
}

/** 보여주기 카드를 띄울 수 있는 장소인지: 일본어 이름이나 주소가 있고, 한국 주소가 아님 (출발지 역·공항은 카드가 필요 없음) */
export const canShow = pl => !!(pl && (pl.ja || pl.addr) && !/^(大韓民国|韓国)/.test(pl.addr || ''));

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
