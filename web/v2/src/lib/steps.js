// 대중교통 구간의 단계(steps)를 화면 줄로 쪼갬: 역 줄(승차·환승·하차)과 이동 줄(도보·탑승)
//  v1(App_Core splitStepRows)의 규칙 그대로, 다만 HTML 대신 데이터로 돌려줌
import { lineColor } from './colors.js';
import { hhmm } from './time.js';

const WALK_COLOR = '#13945f';
const TRANSIT_COLOR = '#2b62d9';

const hmMin = v => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const gap = (a, b) => { const x = hmMin(a), y = hmMin(b); return x == null || y == null ? null : (y - x + 1440) % 1440; };

/**
 * 구간 안의 시각을 앞에서부터 차례로 읽는 함수. 자정을 넘기면(앞 시각보다 반나절 넘게 작아지면) 하루를 더함
 *  첫 기준은 구간 출발 시각 (익일 "(+1)"이면 +1440). 단계 시각은 구글이 0시부터 다시 세서 주므로 여기서 이어 붙임
 */
function clockSeq(s) {
  const d = hmMin(s && s.dep);
  let prev = d == null ? null : d + (/\(\+1\)/.test(String(s.dep)) ? 1440 : 0);
  return m => {
    if (m == null) return null;
    let x = m;
    if (prev != null) while (x < prev - 720) x += 1440;
    prev = x;
    return x;
  };
}

/**
 * 지금 시각에 이 구간의 어느 단계인지 (다음 장소 카드에 한두 줄로). 계획 시각 기준
 * @param nowMin 일정 기준 지금(tripClock().min). 자정 넘어 전날 일정이 이어지는 중이면 24시를 넘긴 값
 * @returns null |
 *  { kind:'board',    ride }        아직 안 탐: ride.from 에서 ride.dep 에 탐
 *  { kind:'transfer', ride, prev }  내렸고 다음 탈 것 기다림: ride.from 에서 ride.dep 에 갈아탐
 *  { kind:'ride',     ride, next }  타는 중: ride.to 에서 ride.arr 에 내림. next = 그다음 탈 것
 *  { kind:'walk',     ride, min }   마지막으로 내린 뒤: ride.to 에서 걸어서 min분
 */
export function stepNow(s, nowMin) {
  if (!s || !canSplit(s) || nowMin == null) return null;
  const seq = clockSeq(s);
  const rides = [];
  s.steps.forEach(x => {
    if (x.t !== 'transit') return;
    const dep = seq(hmMin(x.dep)), arr = seq(hmMin(x.arr));
    if (dep != null && arr != null) rides.push({ x, dep, arr });
  });
  if (!rides.length) return null;
  for (let i = 0; i < rides.length; i++) {
    const r = rides[i];
    if (nowMin < r.dep) return i === 0 ? { kind: 'board', ride: r.x } : { kind: 'transfer', ride: r.x, prev: rides[i - 1].x };
    if (nowMin < r.arr) return { kind: 'ride', ride: r.x, next: rides[i + 1] ? rides[i + 1].x : null };
  }
  const last = rides[rides.length - 1].x;
  const after = s.steps.slice(s.steps.indexOf(last) + 1).filter(x => x.t !== 'transit');
  return { kind: 'walk', ride: last, min: after.reduce((a, x) => a + (Number(x.min) || 0), 0) };
}

/** 탑승 단계가 하나라도 있어서 쪼개 보여줄 수 있는 구간인지 */
export function canSplit(s) {
  return s.mode === '대중교통' && Array.isArray(s.steps) && s.steps.some(x => x.t === 'transit');
}

/**
 * @returns 줄 목록
 *  역 줄:   { type:'station', name, ja, time, time2, nd, nd2, kind, c1, c2 }   c1·c2 = 위·아래 선 색, nd·nd2 = 그 시각이 익일인지
 *  도보 줄: { type:'walk', min, m, label, from, to, note, wait, c }
 *  탑승 줄: { type:'ride', min, line, color(배지 색, 모르면 ''), vehicle, stops, pass, head, jhead, full, jline, agency, c(선 색) }
 */
export function stepRows(s, fromName, toName) {
  const steps = s.steps || [];
  const seq = clockSeq(s);
  const at = t => { const m = seq(hmMin(t)); return m == null ? { time: t || '', nd: false } : { time: hhmm(m), nd: m >= 1440 }; };
  const prevRide = i => { for (let k = i - 1; k >= 0; k--) if (steps[k].t === 'transit') return steps[k]; return null; };
  const nextRide = i => { for (let k = i + 1; k < steps.length; k++) if (steps[k].t === 'transit') return steps[k]; return null; };
  const colorOf = st => (st.t === 'transit' ? (st.color || lineColor(st.line + ' ' + (st.full || '')) || TRANSIT_COLOR) : WALK_COLOR);
  const rows = [];
  let rail = TRANSIT_COLOR;
  const pushStep = row => {
    const tail = rows[rows.length - 1];
    if (tail && tail.type === 'station') tail.c2 = row.c;
    rows.push(row);
    rail = row.c;
  };
  const pushStation = (name, ja, t, kind) => {
    const { time, nd } = at(t);   // 시각은 나온 차례대로 읽어야 자정 넘김을 알 수 있음
    const tail = rows[rows.length - 1];
    // 같은 역에서 바로 갈아타면(사이 도보 없음) 역 줄 하나로: 하차 시각 + 출발 시각
    if (tail && tail.type === 'station' && tail.name === name && kind === '환승') {
      tail.time2 = time;
      tail.nd2 = nd;
      tail.kind = '환승';
      return;
    }
    rows.push({ type: 'station', name, ja: ja && ja !== name ? ja : '', time, time2: '', nd, nd2: false, kind, c1: rail, c2: rail });
  };
  steps.forEach((st, i) => {
    const c = colorOf(st);
    const pr = prevRide(i), nx = nextRide(i);
    if (st.t !== 'transit') {
      if (!st.min) return;
      let from, to, note = '', wait = null;
      if (pr && nx) {
        from = pr.to; to = nx.from;
        note = pr.to === nx.from ? '같은 역 안 환승' : '환승';
        const g = gap(pr.arr, nx.dep);
        if (g != null && g - st.min > 0) wait = g - st.min;
      } else if (!pr) {
        from = fromName || '출발지'; to = nx ? nx.from : (toName || '도착지');
        note = nx ? '승차' : '';
      } else {
        from = pr.to; to = toName || '도착지';
        note = '';
      }
      pushStep({ type: 'walk', i, c, min: st.min, m: st.m || 0, label: st.t === 'walk' ? '도보' : '이동', from, to, note, wait });
      return;
    }
    pushStation(st.from, st.jfrom, st.dep, pr ? '환승' : '승차');
    const ride = gap(st.dep, st.arr);
    pushStep({
      type: 'ride', i, c, min: ride != null ? ride : st.min,
      line: st.line, color: st.color || lineColor(st.line + ' ' + (st.full || '')) || '', vehicle: st.vehicle || '', stops: st.stops || 0,
      pass: st.pass === true ? 'pass' : st.pass === false ? 'card' : '',
      head: st.head || '', jhead: st.jhead && st.jhead !== st.head ? st.jhead : '',
      full: st.full && st.full !== st.line ? st.full : '',
      jline: st.jline && st.jline !== st.line ? st.jline : '',
      agency: st.ag || '',
    });
    pushStation(st.to, st.jto, st.arr, nx ? '하차 후 환승' : '하차');
  });
  return rows;
}
