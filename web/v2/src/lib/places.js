// 장소 화면 로직: 일정의 장소 + 추천 장소를 한 목록으로. 거르기·묶기·방문 정보
import { vk, isVisited } from './trip.js';
import { cityColor } from './colors.js';

/** 종류 보여주는 순서 */
export const TYPE_ORDER = ['관광지', '식당', '카페', '쇼핑', '숙소', '교통', '기타'];

/** 이 장소를 일정에서 들르는 곳들 (날짜·순서 순) */
export function visitsOf(v, key) {
  return v.points.filter(p => p.placeKey === key);
}

/** 화면에 쓰는 이름: 별칭 있으면 별칭 */
export const placeName = pl => pl.alias || pl.name;

/**
 * 목록에 보일 장소
 * @param o { city:''|도시, type:''|종류, scope:'all'|'plan'|'extra', q:검색어 }
 *   scope: plan = 일정에 있는 곳만, extra = 일정에 없는 추천만
 */
export function filterPlaces(v, o) {
  const q = String(o.q || '').trim().toLowerCase();
  return v.allPlaces.filter(pl => {
    if (o.city && pl.city !== o.city) return false;
    if (o.type && (pl.type || '기타') !== o.type) return false;
    const n = visitsOf(v, pl.key).length;
    if (o.scope === 'plan' && !n) return false;
    if (o.scope === 'extra' && n) return false;
    if (q) {
      const hay = [pl.name, pl.alias, pl.area, pl.city, pl.type, pl.intro, pl.memo].concat(pl.menu || []).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

/**
 * 도시 → 구역으로 묶음. 구역은 그 구역 장소를 처음 들르는 날짜 순, 일정에 없으면 뒤로
 * @returns {{ city, color, areas: { area, places }[] }[]}
 */
export function groupPlaces(v, list) {
  const firstVisit = pl => { const x = visitsOf(v, pl.key)[0]; return x ? vk(x).replace('#', '#' + String(x.order).padStart(3, '0')) : '~'; };
  const byCity = new Map();
  list.forEach(pl => {
    const c = pl.city || '기타 지역';
    if (!byCity.has(c)) byCity.set(c, new Map());
    const a = pl.area || '구역 미정';
    const m = byCity.get(c);
    if (!m.has(a)) m.set(a, []);
    m.get(a).push(pl);
  });
  const out = Array.from(byCity, ([city, m]) => {
    const areas = Array.from(m, ([area, places]) => {
      places.sort((x, y) => (firstVisit(x) < firstVisit(y) ? -1 : firstVisit(x) > firstVisit(y) ? 1 : placeName(x).localeCompare(placeName(y), 'ko')));
      return { area, places, at: firstVisit(places[0]) };
    }).sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.area.localeCompare(y.area, 'ko')));
    return { city, color: cityColor(city) || '', areas, at: areas[0].at };
  });
  return out.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
}

/** 도시 목록 (첫 방문 순) + 장소 수 */
export function cityList(v) {
  return groupPlaces(v, v.allPlaces).map(g => ({ city: g.city, color: g.color, n: g.areas.reduce((a, x) => a + x.places.length, 0) }));
}

/** 이 장소 방문 상태: 'done'(한 번이라도 도장) | 'plan'(일정에 있음) | 'extra'(추천만) */
export function placeStatus(v, pl) {
  const vs = visitsOf(v, pl.key);
  if (!vs.length) return 'extra';
  return vs.some(p => isVisited(v, p)) ? 'done' : 'plan';
}
