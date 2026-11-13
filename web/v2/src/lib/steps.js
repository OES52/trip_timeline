// 대중교통 구간의 단계(steps)를 화면 줄로 쪼갬: 역 줄(승차·환승·하차)과 이동 줄(도보·탑승)
//  v1(App_Core splitStepRows)의 규칙 그대로, 다만 HTML 대신 데이터로 돌려줌
import { lineColor } from './colors.js';

const WALK_COLOR = '#13945f';
const TRANSIT_COLOR = '#2b62d9';

const hmMin = v => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const gap = (a, b) => { const x = hmMin(a), y = hmMin(b); return x == null || y == null ? null : (y - x + 1440) % 1440; };

/** 탑승 단계가 하나라도 있어서 쪼개 보여줄 수 있는 구간인지 */
export function canSplit(s) {
  return s.mode === '대중교통' && Array.isArray(s.steps) && s.steps.some(x => x.t === 'transit');
}

/**
 * @returns 줄 목록
 *  역 줄:   { type:'station', name, ja, time, time2, kind, c1, c2 }   c1·c2 = 위·아래 선 색
 *  도보 줄: { type:'walk', min, m, label, from, to, note, wait, c }
 *  탑승 줄: { type:'ride', min, line, color(배지 색, 모르면 ''), vehicle, stops, pass, head, jhead, full, jline, agency, c(선 색) }
 */
export function stepRows(s, fromName, toName) {
  const steps = s.steps || [];
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
  const pushStation = (name, ja, time, kind) => {
    const tail = rows[rows.length - 1];
    // 같은 역에서 바로 갈아타면(사이 도보 없음) 역 줄 하나로: 하차 시각 + 출발 시각
    if (tail && tail.type === 'station' && tail.name === name && kind === '환승') {
      tail.time2 = time;
      tail.kind = '환승';
      return;
    }
    rows.push({ type: 'station', name, ja: ja && ja !== name ? ja : '', time: time || '', time2: '', kind, c1: rail, c2: rail });
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
