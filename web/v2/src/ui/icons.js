// 아이콘 한 벌 (Phosphor, 속 채운 모양 = 역 픽토그램 느낌). 쓰는 것만 가져와서 묶음
import clock from '@phosphor-icons/core/assets/fill/clock-fill.svg?raw';
import path from '@phosphor-icons/core/assets/fill/path-fill.svg?raw';
import pin from '@phosphor-icons/core/assets/fill/map-pin-fill.svg?raw';
import stamp from '@phosphor-icons/core/assets/fill/stamp-fill.svg?raw';
import nav from '@phosphor-icons/core/assets/fill/navigation-arrow-fill.svg?raw';
import walk from '@phosphor-icons/core/assets/fill/person-simple-walk-fill.svg?raw';
import train from '@phosphor-icons/core/assets/fill/train-fill.svg?raw';
import subway from '@phosphor-icons/core/assets/fill/subway-fill.svg?raw';
import tram from '@phosphor-icons/core/assets/fill/tram-fill.svg?raw';
import bus from '@phosphor-icons/core/assets/fill/bus-fill.svg?raw';
import taxi from '@phosphor-icons/core/assets/fill/taxi-fill.svg?raw';
import plane from '@phosphor-icons/core/assets/fill/airplane-tilt-fill.svg?raw';
import boat from '@phosphor-icons/core/assets/fill/boat-fill.svg?raw';
import car from '@phosphor-icons/core/assets/fill/car-fill.svg?raw';
import cable from '@phosphor-icons/core/assets/fill/cable-car-fill.svg?raw';
import bed from '@phosphor-icons/core/assets/fill/bed-fill.svg?raw';
import food from '@phosphor-icons/core/assets/fill/fork-knife-fill.svg?raw';
import coffee from '@phosphor-icons/core/assets/fill/coffee-fill.svg?raw';
import camera from '@phosphor-icons/core/assets/fill/camera-fill.svg?raw';
import bag from '@phosphor-icons/core/assets/fill/shopping-bag-fill.svg?raw';
import warn from '@phosphor-icons/core/assets/fill/warning-fill.svg?raw';
import moon from '@phosphor-icons/core/assets/fill/moon-fill.svg?raw';
import sunset from '@phosphor-icons/core/assets/fill/sun-horizon-fill.svg?raw';
import wallet from '@phosphor-icons/core/assets/fill/wallet-fill.svg?raw';
import map from '@phosphor-icons/core/assets/fill/map-trifold-fill.svg?raw';
import user from '@phosphor-icons/core/assets/fill/user-fill.svg?raw';
import lock from '@phosphor-icons/core/assets/fill/lock-fill.svg?raw';
import ticket from '@phosphor-icons/core/assets/fill/ticket-fill.svg?raw';
import offline from '@phosphor-icons/core/assets/fill/wifi-slash-fill.svg?raw';
import hourglass from '@phosphor-icons/core/assets/fill/hourglass-medium-fill.svg?raw';
import sun from '@phosphor-icons/core/assets/fill/sun-fill.svg?raw';
import cloudSun from '@phosphor-icons/core/assets/fill/cloud-sun-fill.svg?raw';
import cloud from '@phosphor-icons/core/assets/fill/cloud-fill.svg?raw';
import fog from '@phosphor-icons/core/assets/fill/cloud-fog-fill.svg?raw';
import rain from '@phosphor-icons/core/assets/fill/cloud-rain-fill.svg?raw';
import snow from '@phosphor-icons/core/assets/fill/cloud-snow-fill.svg?raw';
import storm from '@phosphor-icons/core/assets/fill/cloud-lightning-fill.svg?raw';
import down from '@phosphor-icons/core/assets/bold/caret-down-bold.svg?raw';
import left from '@phosphor-icons/core/assets/bold/caret-left-bold.svg?raw';
import right from '@phosphor-icons/core/assets/bold/caret-right-bold.svg?raw';
import check from '@phosphor-icons/core/assets/bold/check-bold.svg?raw';
import close from '@phosphor-icons/core/assets/bold/x-bold.svg?raw';
import reload from '@phosphor-icons/core/assets/bold/arrows-clockwise-bold.svg?raw';
import out from '@phosphor-icons/core/assets/bold/arrow-up-right-bold.svg?raw';

export const ICONS = {
  clock, path, pin, stamp, nav, walk, train, subway, tram, bus, taxi, plane, boat, car, cable,
  bed, food, coffee, camera, bag, warn, moon, sunset, wallet, map, user, lock, ticket, offline, hourglass,
  sun, cloudSun, cloud, fog, rain, snow, storm,
  down, left, right, check, close, reload, out,
};

/** 장소 종류 → 아이콘 이름 */
export const TYPE_ICON = { '숙소': 'bed', '식당': 'food', '카페': 'coffee', '관광지': 'camera', '쇼핑': 'bag', '교통': 'train', '기타': 'pin' };

/** 장소 아이콘: 종류로 고르되 공항은 비행기 */
export function placeIcon(type, name) {
  if (/공항|空港|Airport/i.test(name || '')) return 'plane';
  return TYPE_ICON[type] || 'pin';
}

/** 직접 적은 이동 구간(수동)의 아이콘: 공항 사이는 비행기, 버스터미널이 끼면 버스 */
export function manualIcon(from, to, summary) {
  if (/공항|空港|Airport/i.test(from || '') && /공항|空港|Airport/i.test(to || '')) return 'plane';
  if (/버스|バス|Bus/i.test((from || '') + ' ' + (to || '') + ' ' + (summary || ''))) return 'bus';
  return 'path';
}

/** 이동 방식 → 아이콘 이름 */
export const MODE_ICON = { transit: 'train', walk: 'walk', car: 'car', manual: 'path', taxi: 'taxi' };

/** 탑승 단계의 탈것 → 아이콘 이름 */
export function vehicleIcon(vehicle, line) {
  const t = String(vehicle || '') + ' ' + String(line || '');
  if (/버스|バス|Bus/i.test(t)) return 'bus';
  if (/지하철|地下鉄|Subway|Metro/i.test(t)) return 'subway';
  if (/트램|노면|路面|Tram/i.test(t)) return 'tram';
  if (/페리|배|フェリー|Ferry/i.test(t)) return 'boat';
  if (/케이블|ケーブル|로프웨이|ロープウェイ|Cable|Gondola/i.test(t)) return 'cable';
  return 'train';
}

/** 날씨 코드(WMO) → [아이콘 이름, 글] */
export function weatherInfo(code) {
  if (code === 0) return ['sun', '맑음'];
  if (code <= 2) return ['cloudSun', '대체로 맑음'];
  if (code === 3) return ['cloud', '흐림'];
  if (code === 45 || code === 48) return ['fog', '안개'];
  if (code >= 51 && code <= 57) return ['rain', '이슬비'];
  if (code >= 61 && code <= 67) return ['rain', '비'];
  if (code >= 71 && code <= 77) return ['snow', '눈'];
  if (code >= 80 && code <= 82) return ['rain', '소나기'];
  if (code >= 85 && code <= 86) return ['snow', '눈'];
  if (code >= 95) return ['storm', '뇌우'];
  return ['cloud', ''];
}
