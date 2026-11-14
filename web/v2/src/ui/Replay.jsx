// 하루 리플레이: 그날 일정대로 점이 움직이며 지나온 길을 그림. 시계는 실제 일정 시각
//  약 45초에 하루(1배속). 2·4배속, 끌어서 넘기기, 일시정지. 카메라는 머무는 곳은 가깝게, 이동은 구간이 한 화면에 들어오게
import { useEffect, useRef, useState } from 'preact/hooks';
import { buildReplay, frameAt, trailUntil } from '../lib/replay.js';
import { boundsOf } from '../lib/route.js';
import { hhmm, dayLabel } from '../lib/time.js';
import { Icon } from './Icon.jsx';

const SECS = 45;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ReplayPanel({ map, ml, v, date, onClose }) {
  const R = useRef(null);
  const st = useRef({ u: 0, last: null, raf: 0, camZ: null, dt: 0 }).current;
  const [playing, setPlaying] = useState(!reduced());
  const [speed, setSpeed] = useState(1);
  const [ui, setUi] = useState({ clock: '', label: '', pct: 0 });
  const panel = useRef(null);
  const ref = useRef({ playing, speed });
  ref.current = { playing, speed };

  // 준비: 사건 목록, 지나온 길 층, 움직이는 점
  useEffect(() => {
    const r = buildReplay(v, date);
    R.current = r;
    if (!r.ev.length) return undefined;
    r.ev.forEach(e => {
      if (e.type === 'stay') { e.zoom = 16; return; }
      const b = boundsOf(e.coords);
      let z = 14;
      try { const cam = map.cameraForBounds(b, { padding: 80 }); if (cam && cam.zoom != null) z = cam.zoom; } catch (err) { /* 그대로 */ }
      e.zoom = Math.max(10, Math.min(16, z));
    });
    map.addSource('rp', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'rp-trail', type: 'line', source: 'rp', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FF3B30', 'line-width': 5, 'line-opacity': 0.9 } });
    const dot = document.createElement('span');
    dot.className = 'rp-dot';
    dot.setAttribute('aria-hidden', 'true');
    const marker = new ml.Marker({ element: dot }).setLngLat([r.ev[0].type === 'stay' ? r.ev[0].p.lng : r.ev[0].coords[0][1], r.ev[0].type === 'stay' ? r.ev[0].p.lat : r.ev[0].coords[0][0]]).addTo(map);
    r.marker = marker;
    st.u = 0; st.camZ = null; st.last = null;
    draw(true);
    return () => {
      cancelAnimationFrame(st.raf);
      marker.remove();
      try { map.removeLayer('rp-trail'); map.removeSource('rp'); } catch (err) { /* 스타일이 바뀌었으면 이미 없음 */ }
      try { map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); } catch (err) { /* 무시 */ }
    };
  }, [date]);

  // 재생 위치(st.u)에 맞춰 점·길·카메라·글자를 그림. seek = 끌어서 넘겼을 때(길을 다시 그림, 카메라 바로)
  function draw(seek) {
    const r = R.current;
    if (!r || !r.ev.length) return;
    const f = frameAt(v, r, Math.min(st.u, r.total - 1e-6));
    r.marker.setLngLat([f.pos[1], f.pos[0]]);
    const src = map.getSource('rp');
    if (src) {
      if (seek || !r.trail) r.trail = trailUntil(v, r, st.u);
      else r.trail.push(f.pos);
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.trail.map(c => [c[1], c[0]]) } });
    }
    // 카메라: 지금 구간과 조금 뒤 구간 중 넓은 쪽 확대 단계를 부드럽게 따라감
    const look = (r.total / SECS) * Math.max(1, ref.current.speed);
    let tz = 99;
    r.ev.forEach(x => { if (x.u0 < st.u + look && x.u0 + x.len > st.u) tz = Math.min(tz, x.zoom); });
    if (tz === 99) tz = map.getZoom();
    if (st.camZ == null || seek) st.camZ = tz;
    else st.camZ += (tz - st.camZ) * (1 - Math.exp(-st.dt / 0.45));
    const ph = panel.current ? panel.current.offsetHeight + 24 : 0;
    let center = [f.pos[1], f.pos[0]];
    if (!seek) {
      const c = map.getCenter(), k = 1 - Math.exp(-st.dt / 0.3);
      center = [c.lng + (center[0] - c.lng) * k, c.lat + (center[1] - c.lat) * k];
    }
    map.jumpTo({ center, zoom: st.camZ, padding: { top: 0, left: 0, right: 0, bottom: ph } });
    setUi({ clock: hhmm(Math.round(f.clock)), label: f.label, pct: Math.round((st.u / r.total) * 1000) });
  }

  // 재생 루프
  useEffect(() => {
    const r = R.current;
    if (!playing || !r || !r.ev.length) return undefined;
    st.last = null;
    const frame = ts => {
      st.dt = st.last != null ? Math.min(0.1, (ts - st.last) / 1000) : 0;
      if (st.last != null) st.u += st.dt * (r.total / SECS) * ref.current.speed;
      st.last = ts;
      if (st.u >= r.total) {
        st.u = r.total;
        draw(false);
        setPlaying(false);
        const b = boundsOf(r.trail || []);
        if (b) map.fitBounds(b, { padding: { top: 60, left: 40, right: 60, bottom: (panel.current ? panel.current.offsetHeight : 0) + 40 }, duration: 800 });
        return;
      }
      draw(false);
      st.raf = requestAnimationFrame(frame);
    };
    st.raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(st.raf);
  }, [playing]);

  const r = R.current;
  if (r && !r.ev.length) {
    return (
      <section class="mapcard rp" ref={panel} aria-label="리플레이">
        <p>이날은 좌표·시각이 있는 일정이 없어서 리플레이를 못 함</p>
        <button type="button" class="btn btn-plate btn-sm" onClick={onClose}>닫기</button>
      </section>
    );
  }
  return (
    <section class="mapcard rp" ref={panel} aria-label={dayLabel(date) + ' 리플레이'}>
      <div class="rp-top">
        <span class="rp-clock num" aria-live="off">{ui.clock}</span>
        <span class="rp-label">{ui.label}</span>
      </div>
      <input class="rp-range" type="range" min="0" max="1000" value={ui.pct} aria-label="재생 위치"
        onInput={e => { if (!r) return; st.u = (e.currentTarget.value / 1000) * r.total; st.dt = 0; draw(true); }} />
      <div class="rp-ctrl">
        <button type="button" class="btn btn-exit btn-sm" onClick={() => { if (r && st.u >= r.total) { st.u = 0; r.trail = null; } setPlaying(p => !p); }}>
          <Icon name={playing ? 'pause' : 'play'} />{playing ? '멈춤' : '재생'}
        </button>
        <button type="button" class="btn btn-plate btn-sm" onClick={() => setSpeed(s => (s === 1 ? 2 : s === 2 ? 4 : 1))} aria-label={'재생 속도 ' + speed + '배, 바꾸기'}>{speed}배속</button>
        <button type="button" class="btn btn-quiet btn-sm" onClick={onClose}>리플레이 끝내기</button>
      </div>
    </section>
  );
}
