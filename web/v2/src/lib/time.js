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
