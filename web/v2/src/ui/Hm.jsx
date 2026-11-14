import { hmParts, hhmm } from '../lib/time.js';

/**
 * 일정 시각. 24시를 넘긴 시각("25:10")은 "익일" 딱지 + 1:10 으로
 * @param s 일정 시각 글자  @param min 대신 분으로 줄 때 (예상 도착 등)
 */
export function Hm({ s, min }) {
  const p = min != null ? { t: hhmm(min), nd: min >= 1440 } : hmParts(s);
  return <>{p.nd && <span class="nd">익일</span>}{p.t}</>;
}
