// 도착 제안: 오늘 일정 장소 근처에 1분 넘게 있으면 "도착 찍을까?" (답할 때까지 떠 있음)
import { view } from '../data/store.js';
import { recordArrivalNow } from '../data/records.js';
import { arriveAsk, answerAsk, pos } from '../data/location.js';
import { pname, dayCity } from '../lib/trip.js';
import { haversine, fmtDist } from '../lib/geo.js';
import { Icon } from './Icon.jsx';

export function ArriveAsk() {
  const k = arriveAsk.value, v = view.value;
  const p = k && v ? v.points.find(x => x.date + '#' + x.order === k) : null;
  if (!p) return null;
  const at = pos.value ? haversine([pos.value.lat, pos.value.lng], [p.lat, p.lng]) : null;
  const c = dayCity(v, p.date);
  return (
    <div class="ask-wrap">
      <div class="ask" role="alertdialog" aria-labelledby="ask-t" style={{ '--c': c.color || 'var(--ink)' }}>
        <p class="ask-t" id="ask-t"><b>{pname(v, p)}</b>{at != null ? fmtDist(at) + ' 근처. ' : '근처. '}도착 찍을까?</p>
        <button type="button" class="btn btn-quiet btn-sm" onClick={answerAsk}>아님</button>
        <button type="button" class="btn btn-exit btn-sm" onClick={() => { answerAsk(); recordArrivalNow(p); }}><Icon name="clock" />도착</button>
      </div>
    </div>
  );
}
