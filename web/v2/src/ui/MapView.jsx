// 지도: 하루치 경로와 번호 핀. 지도 라이브러리(MapLibre)는 지도를 처음 열 때만 받음
//  선 색 = 노선 색(타임라인 선과 같음), 핀 번호 = 그날 순서. 핀을 누르면 아래 카드(좁은 화면)나 타임라인(넓은 화면)에 그 장소
import { useEffect, useRef, useState } from 'preact/hooks';
import { view, nt, picked, pick, setPlanView } from '../data/store.js';
import { dayLines, pinGroups, pinState, boundsOf } from '../lib/route.js';
import { stopStates, dayPoints, pname, placeOf, vk } from '../lib/trip.js';
import { navUrl } from '../lib/geo.js';
import { Icon } from './Icon.jsx';
import { ICONS } from './icons.js';

// 지도 자료(스타일·타일·글꼴)는 홈랩 프록시를 거침: 캐시돼서 빠르고, 일정 주변 타일은 서버가 미리 받아둠
const OFM = 'https://tiles.openfreemap.org/';
const proxied = u => (u.indexOf(OFM) === 0 ? location.origin + '/api/map/ofm/' + u.slice(OFM.length) : u);
// 지명은 한국어 먼저, 없으면 로마자, 그것도 없으면 현지어
const NAME_KO = ['coalesce', ['get', 'name:ko'], ['get', 'name:latin'], ['get', 'name']];
const LOCALE = {
  'NavigationControl.ZoomIn': '확대', 'NavigationControl.ZoomOut': '축소', 'NavigationControl.ResetBearing': '북쪽을 위로',
  'GeolocateControl.FindMyLocation': '내 위치 보기', 'GeolocateControl.LocationNotAvailable': '위치를 쓸 수 없음',
  'AttributionControl.ToggleAttribution': '지도 출처', 'Map.Title': '지도',
};

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

/** 지도 오른쪽 위 버튼: 하루 전체가 보이게 */
class FitControl {
  constructor(fn) { this.fn = fn; }
  onAdd() {
    const box = document.createElement('div');
    box.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mapctl-fit';
    b.title = '하루 전체 보기';
    b.setAttribute('aria-label', '하루 전체 보기');
    b.innerHTML = ICONS.fit;
    b.addEventListener('click', this.fn);
    box.appendChild(b);
    this.box = box;
    return box;
  }
  onRemove() { this.box.remove(); }
}

/** 스타일이 실릴 때마다: 지명 언어를 맞추고 경로 층을 얹음 */
function decorate(map, dark) {
  (map.getStyle().layers || []).forEach(l => {
    if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) return;
    if (JSON.stringify(l.layout['text-field']).indexOf('name') === -1) return;
    try { map.setLayoutProperty(l.id, 'text-field', NAME_KO); } catch (e) { /* 그 층만 건너뜀 */ }
  });
  const fade = ['case', ['==', ['get', 'past'], 1], 0.4, 0.95];
  map.addSource('trip', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // 테두리를 먼저 깔아서 지도 위에서 선이 묻히지 않게
  map.addLayer({ id: 'trip-casing', type: 'line', source: 'trip', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark ? '#0D121A' : '#FFFFFF', 'line-width': 9, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'trip-line', type: 'line', source: 'trip', filter: ['==', ['get', 'dash'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': fade } });
  map.addLayer({ id: 'trip-dash', type: 'line', source: 'trip', filter: ['==', ['get', 'dash'], 1], layout: { 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': [1.4, 1.4], 'line-opacity': fade } });
}

/**
 * @param date 날짜  @param active 지금 화면에 보이는지 (좁은 화면에서 타임라인을 볼 땐 false: 숨겨 둔 채 유지)
 */
export function MapView({ date, active }) {
  const v = view.value;
  const now = nt.value;
  const pk = picked.value;
  const box = useRef(null);
  const card = useRef(null);
  const S = useRef({ map: null, ml: null, markers: new Map(), planes: [], coords: [], sig: '', fitFor: null, needFit: false, eased: null }).current;
  const [phase, setPhase] = useState('loading');   // loading | ready | error | nogl
  const [gen, setGen] = useState(0);               // 스타일이 (다시) 실릴 때마다 +1 → 선·핀을 다시 그림
  const [attempt, setAttempt] = useState(0);       // "다시 불러오기"

  const pts = dayPoints(v, date).filter(p => p.lat != null && p.lng != null);
  const states = stopStates(v, date, now);
  const groups = pinGroups(v, date);
  const pkKey = pk && pk.key.indexOf(date + '#') === 0 && pts.some(p => vk(p) === pk.key) ? pk.key : null;
  // 고른 곳이 없으면 지금 있는 곳 → 다음 갈 곳 → 첫 장소를 카드에 보여줌
  const def = pts.find(p => states.get(p.order) === 'now') || pts.find(p => states.get(p.order) === 'next') || pts[0] || null;
  const curKey = pkKey || (def ? vk(def) : null);
  const curIdx = pts.findIndex(p => vk(p) === curKey);
  const cur = curIdx >= 0 ? pts[curIdx] : null;

  // 카드가 지도 아래쪽을 가리는 만큼 비워서 맞춤 (넓은 화면은 카드가 없음)
  const cardH = () => (card.current && card.current.offsetParent ? card.current.offsetHeight + 12 : 0);
  const fit = animate => {
    const b = boundsOf(S.coords);
    if (!b || !S.map) return;
    S.map.fitBounds(b, { padding: { top: 72, right: 72, bottom: cardH() + 40, left: 48 }, maxZoom: 15.5, duration: animate ? 600 : 0 });
  };

  // 지도 만들기 (한 번, 또는 "다시 불러오기"를 누를 때)
  useEffect(() => {
    let dead = false, map = null, timer = 0;
    setPhase('loading');
    if (!hasWebGL()) { setPhase('nogl'); return undefined; }
    import('./maplibre.js').then(m => {
      if (dead) return;
      const ml = m.default;
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      let ready = false, swapped = false;
      map = new ml.Map({
        container: box.current,
        style: proxied(OFM + 'styles/' + (dark ? 'dark' : 'liberty')),
        center: [135.5, 34.69], zoom: 10, maxPitch: 60,
        attributionControl: { compact: true },
        locale: LOCALE,
        transformRequest: url => (url.indexOf(OFM) === 0 ? { url: proxied(url) } : undefined),
      });
      // 어두운 스타일을 못 받으면 밝은 것으로 한 번 바꿔 보고, 그래도 안 되면 못 불러옴
      const giveUp = () => { if (!ready && !dead) setPhase('error'); };
      map.on('error', () => {
        if (ready) return;
        if (dark && !swapped) { swapped = true; map.setStyle(proxied(OFM + 'styles/liberty')); return; }
        clearTimeout(timer);
        timer = setTimeout(giveUp, 4000);
      });
      timer = setTimeout(giveUp, 15000);
      map.on('style.load', () => {
        if (dead) return;
        ready = true;
        clearTimeout(timer);
        decorate(map, dark && !swapped);
        S.sig = '';
        setPhase('ready');
        setGen(g => g + 1);
      });
      map.addControl(new ml.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
      map.addControl(new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right');
      map.addControl(new FitControl(() => fit(true)), 'top-right');
      map.on('click', () => pick(null));   // 빈 곳을 누르면 고른 것 풀기
      S.map = map;
      S.ml = ml;
    }).catch(() => { if (!dead) setPhase('error'); });
    return () => {
      dead = true;
      clearTimeout(timer);
      S.markers.clear();
      S.planes = [];
      S.map = null;
      S.sig = '';
      S.fitFor = null;
      if (map) map.remove();
    };
  }, [attempt]);

  // 선과 핀 그리기: 날짜·데이터·핀 상태가 바뀔 때만
  const sig = [gen, date, v._v || '', groups.map(g => g.label + pinState(v, g, states)).join(',')].join('|');
  useEffect(() => {
    const map = S.map;
    if (phase !== 'ready' || !map || !map.getSource('trip') || S.sig === sig) return;
    S.sig = sig;
    const { features, planes } = dayLines(v, date, states);
    map.getSource('trip').setData({ type: 'FeatureCollection', features });
    new Set(Array.from(S.markers.values()).map(x => x.marker)).forEach(m => m.remove());
    S.markers.clear();
    S.planes.forEach(m => m.remove());
    S.planes = planes.map(ll => {
      const el = document.createElement('span');
      el.className = 'pin-plane';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = ICONS.plane;
      return new S.ml.Marker({ element: el }).setLngLat([ll[1], ll[0]]).addTo(map);
    });
    groups.forEach(g => {
      // 지도 라이브러리가 바깥 요소의 위치(transform)를 직접 다루므로, 모양은 안쪽 요소에
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pinbox is-' + pinState(v, g, states);
      el.setAttribute('aria-label', g.points.map(p => p.order + '번 ' + pname(v, p) + (p.arrive ? ' ' + p.arrive : '')).join(', '));
      const dot = document.createElement('span');
      dot.className = 'pin';
      dot.textContent = g.label;
      el.appendChild(dot);
      el.addEventListener('click', e => {
        e.stopPropagation();
        // 여러 번 들르는 곳은 누를 때마다 다음 방문으로
        const at = g.keys.indexOf(picked.value ? picked.value.key : '');
        pick(g.keys[(at + 1) % g.keys.length], 'map');
      });
      const marker = new S.ml.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map);
      g.keys.forEach(k => S.markers.set(k, { marker, el, g }));
    });
    S.coords = groups.map(g => [g.lat, g.lng]).concat(features.flatMap(f => f.geometry.coordinates.map(c => [c[1], c[0]])));
    if (S.fitFor !== date) S.needFit = true;
  }, [sig, phase]);

  // 날짜가 바뀌었거나 처음 보일 때: 하루 전체가 보이게. 숨겨져 있을 땐 크기가 0이라 보일 때까지 미룸
  useEffect(() => {
    if (phase !== 'ready' || !active || !S.map) return undefined;
    const id = requestAnimationFrame(() => {
      if (!S.map) return;
      S.map.resize();
      if (S.needFit) { fit(false); S.needFit = false; S.fitFor = date; }
    });
    return () => cancelAnimationFrame(id);
  }, [sig, phase, active]);

  // 고른 핀 강조. 타임라인이나 카드에서 골랐으면 그 핀이 보이게 지도를 옮김 (핀을 직접 눌렀으면 이미 보이니 그대로)
  useEffect(() => {
    if (phase !== 'ready' || !S.map) return;
    new Set(Array.from(S.markers.values())).forEach(x => x.el.classList.remove('is-picked'));
    const m = curKey && S.markers.get(curKey);
    if (m) m.el.classList.add('is-picked');
    if (!m || !pkKey || pk.from === 'map' || S.eased === pk || !active || S.needFit) return;
    S.eased = pk;
    S.map.easeTo({ center: [m.g.lng, m.g.lat], zoom: Math.max(S.map.getZoom(), 14), offset: [0, -cardH() / 2], duration: 500 });
  }, [curKey, pk, phase, sig, active]);

  const pl = cur ? placeOf(v, cur) : null;
  const sub = cur ? (cur.activity || (pl && (pl.area || pl.type)) || '') : '';
  const prev = curIdx > 0 ? pts[curIdx - 1] : null;
  const next = curIdx >= 0 && curIdx < pts.length - 1 ? pts[curIdx + 1] : null;

  return (
    <div class="map">
      <div class="mapbox" ref={box} />
      {phase !== 'ready' && (
        <div class="map-state" role={phase === 'loading' ? 'status' : 'alert'}>
          {phase === 'loading' && <p>지도 받는 중</p>}
          {phase === 'error' && (
            <>
              <h2>지도를 못 불러옴</h2>
              <p>지도 서버에 연결이 안 됨. 일정은 타임라인에서 그대로 볼 수 있음</p>
              <button type="button" class="btn btn-exit" onClick={() => setAttempt(a => a + 1)}><Icon name="reload" />지도 다시 불러오기</button>
            </>
          )}
          {phase === 'nogl' && (
            <>
              <h2>이 브라우저에서는 지도를 못 그림</h2>
              <p>그래픽 가속(WebGL)이 꺼져 있음. 일정은 타임라인에서 그대로 볼 수 있음</p>
            </>
          )}
        </div>
      )}
      {phase === 'ready' && cur && (
        <section class="mapcard" ref={card} aria-label="고른 장소">
          <button type="button" class="mapcard-main" onClick={() => { pick(vk(cur), 'map'); setPlanView('list'); }}
            aria-label={pname(v, cur) + ', 타임라인에서 보기'}>
            <span class="mapcard-n num" aria-hidden="true">{cur.order}</span>
            <span class="mapcard-t">
              <b>{pname(v, cur)}</b>
              <span><span class="num">{cur.arrive || ''}{cur.depart && cur.depart !== cur.arrive ? '~' + cur.depart : ''}</span>{sub ? ' · ' + sub : ''}</span>
            </span>
            <Icon name="right" />
          </button>
          <div class="mapcard-act">
            <button type="button" class="btn btn-plate btn-icon" disabled={!prev} onClick={() => prev && pick(vk(prev), 'card')} aria-label="앞 장소" title="앞 장소"><Icon name="left" /></button>
            <button type="button" class="btn btn-plate btn-icon" disabled={!next} onClick={() => next && pick(vk(next), 'card')} aria-label="다음 장소" title="다음 장소"><Icon name="right" /></button>
            <a class="btn btn-exit" href={navUrl(cur.lat, cur.lng)} target="_blank" rel="noopener"><Icon name="nav" />길찾기</a>
          </div>
        </section>
      )}
    </div>
  );
}
