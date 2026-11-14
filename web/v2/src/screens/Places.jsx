// 장소: 일정에 있는 곳 + 추천 장소를 한 목록으로 (v1의 추천 가이드와 도감을 합침)
//  머리줄 = 도시 띠 / 본문 = 찾기·거르기 + 도시 → 구역별 목록. 누르면 장소 시트
import { view, nt, go, pick, placeFilter, setPlaceFilter, placeOpen } from '../data/store.js';
import { dayLabel, fmtDur } from '../lib/time.js';
import { vk, isVisited } from '../lib/trip.js';
import { hoursFor, closedOn } from '../lib/hours.js';
import { costText } from '../lib/money.js';
import { navUrl, photoUrl } from '../lib/geo.js';
import { filterPlaces, groupPlaces, cityList, visitsOf, placeStatus, placeName, TYPE_ORDER } from '../lib/places.js';
import { TopBar, SyncLine } from '../ui/Shell.jsx';
import { Sheet } from '../ui/Sheet.jsx';
import { Icon } from '../ui/Icon.jsx';
import { placeIcon } from '../ui/icons.js';

/** 머리줄 도시 띠: 전체 + 첫 방문 순 도시 */
function CityStrip({ v, cur }) {
  const cities = cityList(v);
  return (
    <div class="strip strip-city" role="group" aria-label="도시">
      <button type="button" class="strip-c" aria-pressed={!cur} style={{ '--c': 'var(--ink-3)' }} onClick={() => setPlaceFilter({ city: '' })}>
        <b>전체</b><span class="num">{v.allPlaces.length}</span>
      </button>
      {cities.map(c => (
        <button type="button" key={c.city} class="strip-c" aria-pressed={cur === c.city} style={{ '--c': c.color || 'var(--ink-3)' }}
          onClick={() => setPlaceFilter({ city: c.city })}>
          <b>{c.city}</b><span class="num">{c.n}</span>
        </button>
      ))}
    </div>
  );
}

/** 오늘(여행 중) 또는 그 장소를 처음 들르는 날 기준 영업 정보 한 줄 */
function hoursLine(pl, date) {
  if (!date) return pl.hours ? String(pl.hours).split(/\s+\/\s+/)[0] : '';
  if (closedOn(pl.closed, date)) return dayLabel(date) + ' 휴무';
  const h = hoursFor(pl.hours, date);
  if (!h) return '';
  return h.closed ? dayLabel(date) + ' 휴무' : h.text;
}

function Row({ v, pl, onOpen, today }) {
  const vs = visitsOf(v, pl.key);
  const st = placeStatus(v, pl);
  const date = vs.find(p => p.date >= today) ? vs.find(p => p.date >= today).date : vs[0] ? vs[0].date : null;
  const hl = hoursLine(pl, date);
  return (
    <li>
      <button type="button" class={'prow is-' + st} onClick={() => onOpen(pl.key)}>
        <span class="prow-ph">
          {/* 사진을 못 받으면 사진만 숨겨서 밑에 깔린 종류 아이콘이 보이게 */}
          <Icon name={placeIcon(pl.type, pl.name)} />
          {pl.photos && pl.photos[0] && <img src={photoUrl(pl.photos[0])} alt="" loading="lazy" onError={e => { e.currentTarget.hidden = true; }} />}
          {st === 'done' && <i class="prow-seal" aria-label="다녀옴"><Icon name="check" /></i>}
        </span>
        <span class="prow-t">
          <b>{placeName(pl)}</b>
          <span class="prow-m"><Icon name={placeIcon(pl.type, pl.name)} label={pl.type || '기타'} />{pl.type || '기타'}{hl ? ' · ' + hl : ''}</span>
          <span class="prow-v">
            {vs.length
              ? vs.slice(0, 3).map(p => <em key={vk(p)} class={isVisited(v, p) ? 'is-done' : ''}>{dayLabel(p.date)} <span class="num">{p.arrive}</span></em>)
              : <em class="is-extra">추천 · 일정에 없음</em>}
            {vs.length > 3 && <em>외 {vs.length - 3}번</em>}
          </span>
        </span>
        <Icon name="right" />
      </button>
    </li>
  );
}

/** 장소 시트: 사진, 들르는 때, 영업·비용·메뉴·소개·메모, 길찾기 */
function PlaceSheet({ v, pl, onClose }) {
  const vs = visitsOf(v, pl.key);
  const today = nt.value.date;
  const date = (vs.find(p => p.date >= today) || vs[0] || {}).date || null;
  const h = date ? hoursFor(pl.hours, date) : null;
  const cost = costText(pl);
  const facts = [];
  if (pl.hours) facts.push(['영업', h ? (h.closed ? '휴무' : h.text) + (h.label ? ' (' + h.label + ')' : '') + (date ? ' · ' + dayLabel(date) + ' 기준' : '') : pl.hours]);
  if (pl.closed) facts.push(['휴무', pl.closed]);
  if (cost) facts.push(['비용', cost]);
  if (pl.city || pl.area) facts.push(['위치', [pl.city, pl.area].filter(Boolean).join(' · ')]);
  return (
    <Sheet title={placeName(pl)} onClose={onClose}>
      <div class="psheet">
        {pl.photos && pl.photos.length > 0 && (
          <div class="psheet-ph" role="group" aria-label={'사진 ' + pl.photos.length + '장'}>
            {pl.photos.map((u, i) => <img key={i} src={photoUrl(u)} alt="" loading="lazy" onError={e => { e.currentTarget.hidden = true; }} />)}
          </div>
        )}
        <p class="psheet-m"><Icon name={placeIcon(pl.type, pl.name)} />{pl.type || '기타'}{pl.alias && pl.alias !== pl.name ? ' · ' + pl.name : ''}</p>
        <section>
          <h3 class="psheet-h">들르는 때</h3>
          {vs.length ? (
            <ul class="psheet-v">
              {vs.map(p => (
                <li key={vk(p)}>
                  <button type="button" onClick={() => { onClose(); pick(vk(p), 'map'); go('plan', p.date); }}>
                    <span><b>{dayLabel(p.date)}</b> <span class="num">{p.arrive}{p.depart && p.depart !== p.arrive ? '~' + p.depart : ''}</span>{p.stay ? ' · ' + fmtDur(p.stay) : ''}</span>
                    {isVisited(v, p) && <em class="tag tag-seal">다녀옴</em>}
                    <span class="psheet-go">일정에서 보기<Icon name="right" /></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p class="psheet-none">일정에 없는 추천 장소. 넣으려면 시트의 일정에 추가</p>}
        </section>
        {facts.length > 0 && (
          <dl class="facts">
            {facts.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}
          </dl>
        )}
        {pl.menu && pl.menu.length > 0 && (
          <section><h3 class="psheet-h">추천 메뉴</h3><ul class="menu">{pl.menu.map((m, i) => <li key={i}>{m}</li>)}</ul></section>
        )}
        {pl.intro && <p class="stop-intro">{pl.intro}</p>}
        {pl.memo && <p class="stop-memo">{pl.memo}</p>}
        <div class="stop-btns">
          {pl.lat != null && <a class="btn btn-exit btn-sm" href={navUrl(pl.lat, pl.lng)} target="_blank" rel="noopener"><Icon name="nav" />길찾기</a>}
          {pl.link && <a class="btn btn-plate btn-sm" href={pl.link} target="_blank" rel="noopener"><Icon name="map" />지도에서 보기</a>}
          {pl.web && <a class="btn btn-plate btn-sm" href={pl.web} target="_blank" rel="noopener"><Icon name="out" />웹사이트</a>}
        </div>
      </div>
    </Sheet>
  );
}

export function Places() {
  const v = view.value;
  const f = placeFilter.value;
  const openKey = placeOpen.value;
  const setOpenKey = k => { placeOpen.value = k; };
  const list = filterPlaces(v, f);
  const groups = groupPlaces(v, list);
  const types = TYPE_ORDER.filter(t => v.allPlaces.some(p => (p.type || '기타') === t && (!f.city || p.city === f.city)));
  const done = v.allPlaces.filter(p => placeStatus(v, p) === 'done').length;
  const inPlan = v.allPlaces.filter(p => placeStatus(v, p) !== 'extra').length;
  const open = openKey ? v.allPlaces.find(p => p.key === openKey) : null;
  const filtered = !!(f.type || f.q || f.scope !== 'all');
  return (
    <main class="screen places">
      <TopBar><CityStrip v={v} cur={f.city} /></TopBar>
      <SyncLine />
      <div class="scroll">
        <div class="places-in">
          <div class="pfind">
            <label class="pfind-q">
              <span class="sr">장소 찾기</span>
              <input type="search" placeholder="이름·메뉴·구역으로 찾기" value={f.q} onInput={e => setPlaceFilter({ q: e.currentTarget.value })} />
            </label>
            <div class="chips" role="group" aria-label="일정에 있는지">
              {[['all', '전체'], ['plan', '일정에 있는 곳 ' + inPlan], ['extra', '추천만 ' + (v.allPlaces.length - inPlan)]].map(([k, t]) => (
                <button type="button" key={k} class="chip" aria-pressed={f.scope === k} onClick={() => setPlaceFilter({ scope: k })}>{t}</button>
              ))}
            </div>
            <div class="chips" role="group" aria-label="종류">
              <button type="button" class="chip" aria-pressed={!f.type} onClick={() => setPlaceFilter({ type: '' })}>모든 종류</button>
              {types.map(t => (
                <button type="button" key={t} class="chip" aria-pressed={f.type === t} onClick={() => setPlaceFilter({ type: f.type === t ? '' : t })}>
                  <Icon name={placeIcon(t, '')} />{t}
                </button>
              ))}
            </div>
            <p class="pfind-n" role="status">{list.length}곳{done ? ' · 다녀온 곳 ' + done : ''}</p>
          </div>
          {!list.length && (
            <div class="state">
              <h2>맞는 장소가 없음</h2>
              <p>{f.q ? '"' + f.q + '"' + '에 맞는 곳이 없음. 다른 말로 찾아보기' : '고른 조건에 맞는 곳이 없음'}</p>
              {(filtered || f.city) && <button type="button" class="btn btn-plate" onClick={() => setPlaceFilter({ city: '', type: '', scope: 'all', q: '' })}>거르기 모두 풀기</button>}
            </div>
          )}
          {groups.map(g => (
            <section key={g.city} class="pcity" style={{ '--c': g.color || 'var(--ink-3)' }} aria-label={g.city}>
              {!f.city && <h2 class="pcity-h">{g.city}</h2>}
              {g.areas.map(a => (
                <div key={a.area} class="parea">
                  <h3 class="parea-h">{a.area}</h3>
                  <ul class="plist">{a.places.map(pl => <Row key={pl.key} v={v} pl={pl} onOpen={setOpenKey} today={nt.value.date} />)}</ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
      {open && <PlaceSheet v={v} pl={open} onClose={() => setOpenKey(null)} />}
    </main>
  );
}
