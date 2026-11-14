// 도착 자동 제안: 지금 위치가 오늘 일정 장소 근처인지 (순수 로직)
//  - 정확도 60m 이내 위치만 믿음
//  - 장소 반경 80m 안
//  - 계획(지연 예측 반영) 도착 시각 기준 -2시간 ~ +1.5시간인 곳만 (아침 숙소에서 저녁 숙소 도착을 묻지 않게)
//  - 이미 도착 기록했거나 "아님"으로 넘긴 곳은 빼고, 시각·거리 둘 다 가까운 곳 하나
import { haversine } from './geo.js';
import { toMin } from './time.js';
import { dayPoints, arrivedAt, predictedMin, vk } from './trip.js';

export const NEAR_M = 80, ACC_M = 60, BEFORE_MIN = 120, AFTER_MIN = 90, DWELL_MS = 60000;

/**
 * @param pos { lat, lng, acc }
 * @param nt tokyoNow() 결과
 * @param asked { "날짜#순서": 1 } 이미 물어본 곳
 * @returns { p, dist } 또는 null
 */
export function arrivalCandidate(v, pos, nt, asked = {}) {
  if (!v || !pos || pos.acc == null || pos.acc > ACC_M) return null;
  let best = null;
  dayPoints(v, nt.date).forEach(p => {
    if (p.lat == null || p.lng == null || arrivedAt(v, p) || asked[vk(p)]) return;
    const pr = predictedMin(v, p);
    const plan = pr != null ? pr : toMin(p.arrive);
    if (plan != null && (nt.min < plan - BEFORE_MIN || nt.min > plan + AFTER_MIN)) return;
    const dist = haversine([pos.lat, pos.lng], [p.lat, p.lng]);
    if (dist > NEAR_M) return;
    const score = Math.abs((plan == null ? nt.min : plan) - nt.min) + dist / 10;
    if (!best || score < best.score) best = { p, dist, score };
  });
  return best ? { p: best.p, dist: best.dist } : null;
}

/**
 * 1분 넘게 같은 곳 근처에 있어야 물어봄. 상태(state)를 받아 다음 상태를 돌려줌
 * @param state { key, since } 또는 null
 * @returns { state, ask } ask = 물어볼 장소 키 또는 null
 */
export function dwell(state, cand, now) {
  if (!cand) return { state: null, ask: null };
  const key = vk(cand.p);
  if (!state || state.key !== key) return { state: { key, since: now }, ask: null };
  return { state, ask: now - state.since >= DWELL_MS ? key : null };
}
