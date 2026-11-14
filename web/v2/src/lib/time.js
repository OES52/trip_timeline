// 시각·날짜 도우미. 일정의 시각은 전부 일본 시간(+09:00) 기준 "H:MM" 글자
//  자정 넘긴 시각은 "25:10"처럼 24 넘게 적혀 올 수 있음

export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** "9:30" → 570. 못 읽으면 null */
export function toMin(s) {
  const m = String(s == null ? '' : s).match(/^(\d+):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 570 → "9:30" (24시 넘으면 다시 0시부터) */
export function hhmm(min) {
  return (Math.floor(min / 60) % 24) + ':' + String(min % 60).padStart(2, '0');
}

/** 지금 일본 날짜와 자정부터 지난 분 */
export function tokyoNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = t => parts.find(x => x.type === t).value;
  return { date: g('year') + '-' + g('month') + '-' + g('day'), min: (Number(g('hour')) % 24) * 60 + Number(g('minute')) };
}

/**
 * 일정 시각 글자 → { t: 보일 시각, nd: 익일인지 }
 *  24시를 넘긴 시각("25:10")과 "(+1)"이 붙은 시각("0:15 (+1)")은 익일: { t: "1:10", nd: true }
 */
export function hmParts(s) {
  const raw = String(s == null ? '' : s).trim();
  const m = toMin(raw);
  if (m == null) return { t: raw, nd: false };
  if (m >= 1440 || /\(\+1\)/.test(raw)) return { t: hhmm(m), nd: true };
  return { t: raw, nd: false };
}

/** 일정 시각을 글자 하나로: "25:10" → "익일 1:10", "9:30" → "9:30" */
export function fmtHM(s) {
  const p = hmParts(s);
  return p.nd ? '익일 ' + p.t : p.t;
}

/** 분 → "익일 1:10" (24시 넘으면) / "9:30" */
export function fmtMin(min) {
  return (min >= 1440 ? '익일 ' : '') + hhmm(min);
}

/** 날짜 더하기: ("2026-12-31", 1) → "2027-01-01" */
export function addDays(date, n) {
  return new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
}

/** 일본 시계 "14:05:09" */
export function tokyoClock(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}

/** 날짜 + "H:MM" → Date (일본 시간) */
export function toDateTime(date, hm) {
  const m = toMin(hm);
  if (m == null) return null;
  return new Date(new Date(date + 'T00:00:00+09:00').getTime() + m * 60000);
}

/** 요일 번호 (0=일) */
export function dow(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "2026-12-26" → "12/26" */
export function md(date) {
  const [, m, d] = date.split('-').map(Number);
  return m + '/' + d;
}

/** "2026-12-26" → "12/26 (토)" */
export function dayLabel(date) {
  return md(date) + ' (' + WEEK[dow(date)] + ')';
}

/** 85 → "1시간 25분", 25 → "25분", 60 → "1시간" */
export function fmtDur(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return m + '분';
  return Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
}

/** 초 → { d, h, m, s } (카운트다운) */
export function splitSec(total) {
  let sec = Math.max(0, Math.floor(total));
  const d = Math.floor(sec / 86400); sec -= d * 86400;
  const h = Math.floor(sec / 3600); sec -= h * 3600;
  const m = Math.floor(sec / 60);
  return { d, h, m, s: sec - m * 60 };
}
