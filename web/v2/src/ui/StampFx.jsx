// 도장 찍는 장면: 방금 도장 찍은 곳의 도장이 화면 가운데 쾅 찍혔다가 사라짐 (움직임 줄이기 설정이면 짧게 보이기만)
import { useEffect } from 'preact/hooks';
import { view, stampFx } from '../data/store.js';
import { passport, slotKey } from '../lib/passport.js';
import { Stamp } from './Stamp.jsx';

export function StampFx() {
  const k = stampFx.value, v = view.value;
  const p = k && v ? v.points.find(x => x.date + '#' + x.order === k) : null;
  const s = p ? passport(v).slots.find(x => x.key === slotKey(p)) : null;
  useEffect(() => {
    if (!k) return undefined;
    if (navigator.vibrate) navigator.vibrate(30);
    const t = setTimeout(() => { if (stampFx.value === k) stampFx.value = null; }, s && s.rare ? 1700 : 1300);
    return () => clearTimeout(t);
  }, [k]);
  if (!s) return null;
  return (
    <div class="stampfx" key={k} aria-hidden="true" onClick={() => { stampFx.value = null; }}>
      <div class="stampfx-in"><Stamp name={s.name} type={s.type} sub={p.date.slice(5).replace('-', '.')} seed={s.key} rare={s.rare} /></div>
    </div>
  );
}
