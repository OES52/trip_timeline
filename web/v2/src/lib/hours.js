// 영업시간·휴무·메모 마감 읽기와 경고. v1(App_Records)의 규칙 그대로 (서버 hoursForDate_와 같은 규칙)
import { toMin, hhmm, dow } from './time.js';

/** "11:00~15:00, 17:00~22:00" → [[660,900],[1020,1320]]. 자정 넘는 종료는 +24h */
export function parseHours(text) {
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

const DOW = '일월화수목금토';
function dowSet(label) {
  const t = String(label).replace(/요일/g, '');
  const set = {};
  const rg = t.match(/^([일월화수목금토])\s*[~\-–〜]\s*([일월화수목금토])$/);
  if (rg) {
    let i = DOW.indexOf(rg[1]);
    const j = DOW.indexOf(rg[2]);
    for (let k = 0; k < 7; k++) { set[i] = true; if (i === j) break; i = (i + 1) % 7; }
    return set;
  }
  t.split(/[\s·,，、]+/).forEach(c => { const i = DOW.indexOf(c); if (i >= 0) set[i] = true; });
  return set;
}

/**
 * 그날의 시간표. 영업시간 칸 형식: 기본 + 요일별·날짜별 예외를 " / "로 이어 붙임
 *  "11:00~15:00, 17:00~22:00 / 토·일 11:00~22:00 / 12/31 11:00~18:00 / 1/1 휴무"
 *  고르는 순서: 날짜 > 요일 > 기본
 * @returns {{text:string,label:string,closed:boolean,ranges:number[][]}|null} 칸이 비었으면 null
 */
export function hoursFor(text, date) {
  const t = String(text || '').trim();
  if (!t) return null;
  const [, mo, d] = date.split('-').map(Number);
  const wd = dow(date);
  const mdNum = mo * 100 + d;
  let base = null, byDow = null, byDate = null;
  t.split(/\s+\/\s+|\s*;\s*/).forEach(seg => {
    seg = seg.trim();
    if (!seg) return;
    let m = seg.match(/^(\d{1,2})\/(\d{1,2})(?:\s*[~\-–〜]\s*(\d{1,2})\/(\d{1,2}))?\s+(.+)$/);
    if (m) {
      const a = Number(m[1]) * 100 + Number(m[2]);
      const b = m[3] ? Number(m[3]) * 100 + Number(m[4]) : a;
      if (!byDate && (a <= b ? (mdNum >= a && mdNum <= b) : (mdNum >= a || mdNum <= b))) byDate = { body: m[5], label: seg.slice(0, seg.length - m[5].length).trim() };
      return;
    }
    m = seg.match(/^([일월화수목금토](?:요일)?(?:\s*[·,~\-–〜]\s*[일월화수목금토](?:요일)?)*)\s+(.+)$/);
    if (m) {
      if (!byDow && dowSet(m[1])[wd]) byDow = { body: m[2], label: m[1] };
      return;
    }
    if (!base) base = { body: seg, label: '' };
  });
  const pick = byDate || byDow || base;
  if (!pick) return null;
  const ranges = parseHours(pick.body);
  return { text: pick.body, label: pick.label, closed: !ranges.length && /휴무|휴업|closed/i.test(pick.body), ranges };
}

/** 휴무 칸에서 요일·날짜(12/31, 12/30~1/3)를 읽어 그날이 휴무인지 */
export function closedOn(text, date) {
  const t = String(text || '');
  if (!t || /연중무휴|무휴|없음/.test(t)) return false;
  const [, mo, d] = date.split('-').map(Number);
  const wd = DOW[dow(date)];
  const tokens = t.split(/[\s,，/·、]+/);
  if (tokens.some(x => x === wd || x === wd + '요일' || x === wd + '요')) return true;
  if (new RegExp(wd + '요일').test(t)) return true;
  const re = /(\d{1,2})\/(\d{1,2})(?:\s*[~\-–〜]\s*(\d{1,2})\/(\d{1,2}))?/g;
  const mdNum = mo * 100 + d;
  let m;
  while ((m = re.exec(t))) {
    const a = Number(m[1]) * 100 + Number(m[2]);
    const b = m[3] ? Number(m[3]) * 100 + Number(m[4]) : a;
    if (a <= b ? (mdNum >= a && mdNum <= b) : (mdNum >= a || mdNum <= b)) return true;   // 12/30~1/3처럼 해 넘김
  }
  return false;
}

/** 메모 속 마감 시각(분). "15시 전까지", "최종 입장 16:30", "L.O. 19:45" 등. 여러 개면 가장 이른 것 */
export function memoDeadline(memo) {
  const t = String(memo || '');
  const out = [];
  [
    /(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?\s*(?:전)?\s*까지/g,
    /(\d{1,2}):(\d{2})\s*(?:전)?\s*까지/g,
    /최종\s*(?:입장|탑승|주문|접수)?\s*(\d{1,2}):(\d{2})/g,
    /(?:L\.?\s*O\.?|라스트\s*오더)\s*(\d{1,2}):(\d{2})/gi,
  ].forEach(re => {
    let m;
    while ((m = re.exec(t))) out.push(Number(m[1]) * 60 + Number(m[2] || 0));
  });
  return out.length ? Math.min.apply(null, out) : null;
}

/**
 * 장소 하나의 경고 글 목록: 메모 마감 넘김 / 휴무 / 영업시간 밖
 *  교통·숙소는 영업시간 비교 안 함 (역 첫차 시각 같은 게 걸려서)
 * @param p 일정 점  @param pl 장소(없으면 null)  @param closeSoonMin 마감 직전 기준(분)
 */
export function warnings(p, pl, closeSoonMin = 30) {
  const out = [];
  const a = toMin(p.arrive), d = toMin(p.depart);
  const dl = memoDeadline(p.memo);
  if (dl != null && a != null && a > dl) out.push('메모 마감 ' + hhmm(dl) + ' 넘김 (' + p.arrive + ' 도착)');
  // 시작점→종착점 걷기만으로 체류 시간 초과 (시장·상점가 관통)
  if (p.inner && p.inner.min > (p.stay || 0)) {
    out.push('시작점→종착점 걷기만 ' + p.inner.min + '분' + (p.inner.est ? ' (어림)' : '') + ', 체류 ' + (p.stay || 0) + '분보다 김');
  }
  if (!pl) return out;
  if (closedOn(pl.closed, p.date)) { out.push('이날 휴무 (' + pl.closed + ')'); return out; }
  if (pl.type === '교통' || pl.type === '숙소') return out;
  const h = hoursFor(pl.hours, p.date);
  if (!h || a == null) return out;
  const day = h.label ? ' [' + h.label + ']' : '';
  if (h.closed) { out.push('이날 휴무' + day); return out; }
  const ranges = h.ranges;
  if (!ranges.length) return out;
  let inRange = ranges.find(r => a >= r[0] && a < r[1]);
  let aa = a;
  // 새벽 도착: 자정 넘어 영업하는 칸(18:00~02:00)에 걸치는지
  if (!inRange) { inRange = ranges.find(r => a + 1440 >= r[0] && a + 1440 < r[1]); if (inRange) aa = a + 1440; }
  let dd = d;
  if (dd != null && dd < a) dd += 1440;
  if (dd != null) dd += aa - a;
  if (!inRange) {
    const nextOpen = ranges.filter(r => r[0] > a).sort((x, y) => x[0] - y[0])[0];
    out.push((nextOpen ? '영업 전 도착 (' + hhmm(nextOpen[0]) + ' 오픈)' : '영업 끝난 뒤 도착 (' + hhmm(Math.max.apply(null, ranges.map(r => r[1]))) + ' 종료)') + day);
  } else if ((pl.type === '식당' || pl.type === '카페') && inRange[1] - aa < closeSoonMin) {
    out.push('마감 ' + hhmm(inRange[1]) + ' 직전 도착, 라스트오더 확인' + day);
  } else if (dd != null && dd > inRange[1]) {
    out.push('머무는 중 영업 종료 (' + hhmm(inRange[1]) + ')' + day);
  }
  return out;
}
