// 여권 도장 그림 (SVG). 종류마다 모양, 장소마다 기울기·번짐이 고정, 금박은 금색 그라데이션
import { useId } from 'preact/hooks';
import { INK, hashNum } from '../lib/passport.js';

/** 띄어쓰기 기준 최대 2줄, 한 줄 7자 안쪽 */
function wrap(name) {
  const MAX = 7, lines = [];
  let cur = '';
  String(name).split(/\s+/).filter(Boolean).forEach(w => {
    let word = Array.from(w);
    while (word.length) {
      const room = MAX - Array.from(cur).length - (cur ? 1 : 0);
      if (word.length <= room) { cur += (cur ? ' ' : '') + word.join(''); word = []; }
      else if (!cur) { lines.push(word.slice(0, MAX).join('')); word = word.slice(MAX); }
      else { lines.push(cur); cur = ''; }
    }
  });
  if (cur) lines.push(cur);
  if (lines.length > 2) { lines.length = 2; lines[1] = Array.from(lines[1]).slice(0, MAX - 1).join('') + '…'; }
  return lines;
}

function Shape({ type, c }) {
  if (type === '식당') return <><rect x="14" y="14" width="172" height="172" rx="26" fill="none" stroke={c} stroke-width="8" /><rect x="26" y="26" width="148" height="148" rx="18" fill="none" stroke={c} stroke-width="2.5" /></>;
  if (type === '카페') return <polygon points="100,10 178,55 178,145 100,190 22,145 22,55" fill="none" stroke={c} stroke-width="8" />;
  if (type === '교통') return <><rect x="10" y="44" width="180" height="112" rx="14" fill="none" stroke={c} stroke-width="8" /><line x1="10" y1="72" x2="190" y2="72" stroke={c} stroke-width="3" /></>;
  if (type === '숙소') return <path d="M100 12 L188 80 L188 188 L12 188 L12 80 Z" fill="none" stroke={c} stroke-width="8" stroke-linejoin="round" />;
  if (type === '쇼핑') return <polygon points="60,12 140,12 188,60 188,140 140,188 60,188 12,140 12,60" fill="none" stroke={c} stroke-width="8" />;
  return <><circle cx="100" cy="100" r="88" fill="none" stroke={c} stroke-width="8" /><circle cx="100" cy="100" r="74" fill="none" stroke={c} stroke-width="2.5" /></>;
}

/**
 * @param name 장소 이름  @param type 종류  @param sub 아래 작은 글(날짜)  @param seed 고정 모양용 키  @param rare 금박 이유
 */
export function Stamp({ name, type, sub, seed, rare }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const n = hashNum(seed || name);
  const fid = 'sf' + uid, gid = 'sg' + uid;
  const c = rare ? 'url(#' + gid + ')' : INK[type] || INK['기타'];
  const lines = wrap(name);
  const longest = Math.max.apply(null, lines.map(l => Array.from(l).length).concat(1));
  const fs = lines.length > 1 ? 19 : longest <= 4 ? 30 : longest <= 6 ? 25 : 21;
  return (
    <svg class="stamp" viewBox="0 0 200 200" role="img" aria-label={name + ' 도장' + (rare ? ', 금박: ' + rare : '')}>
      <defs>
        <filter id={fid}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={n % 50} />
          <feDisplacementMap in="SourceGraphic" scale="3.5" />
          <feComponentTransfer><feFuncA type="discrete" tableValues="0 .85 .95 1 1" /></feComponentTransfer>
        </filter>
        {rare && (
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#7A560F" /><stop offset=".42" stop-color="#C9961F" /><stop offset=".5" stop-color="#F3DC8C" />
            <stop offset=".58" stop-color="#C9961F" /><stop offset="1" stop-color="#7A560F" />
          </linearGradient>
        )}
      </defs>
      <g transform={'rotate(' + ((n % 25) - 12) + ' 100 100)'} filter={'url(#' + fid + ')'} opacity={rare ? 1 : 0.9}>
        <Shape type={type} c={c} />
        <text x="100" y="58" text-anchor="middle" font-size={rare ? 13 : 15} letter-spacing={rare ? 1 : 2} fill={c} font-family="Galmuri11, DotGothic16, monospace">{rare ? '★ ' + rare : type}</text>
        {lines.map((l, i) => (
          <text key={i} x="100" y={(lines.length > 1 ? 98 + i * 24 : 110) - (type === '교통' ? 4 : 0)} text-anchor="middle" font-size={fs} font-weight="700" fill={c} font-family="LINE Seed KR, Pretendard JP Variable, sans-serif">{l}</text>
        ))}
        <text x="100" y={type === '교통' ? 143 : 160} text-anchor="middle" font-size="14" fill={c} font-family="Galmuri11, DotGothic16, monospace">{sub}</text>
      </g>
    </svg>
  );
}
