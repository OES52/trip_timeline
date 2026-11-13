// 전광판. "지금 이 순간"만 맡는 재료라 오늘 화면의 주인공으로만 씀
//  여행 전: 출발 카운트다운 + 첫날 행선지 / 여행 중: 今·次·その次 (남은 일정은 바로 아래 타임라인이 보여줌) / 여행 뒤: 인사
import { useEffect, useRef, useState } from 'preact/hooks';
import { view, go } from '../data/store.js';
import { tokyoNow, tokyoClock, toMin, hhmm, dayLabel, splitSec } from '../lib/time.js';
import { tripRange, nowNext, remainMin, predictedMin, pname, placeOf, dayPoints, isVisited, segModeName, segRides } from '../lib/trip.js';
import { weatherInfo } from './icons.js';
import { Icon } from './Icon.jsx';

const WIDE = /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;

/** 글자가 바뀐 칸만 넘어가는 표시 (칸마다 key가 글자라서, 바뀌면 새로 생기며 넘김 애니메이션이 돎) */
export function Flap({ text, stagger }) {
  const chars = Array.from(String(text));
  return (
    <span class="flap">
      <span class="sr">{text}</span>
      {chars.map((ch, i) => (
        <span key={i + ch} aria-hidden="true" class={'fc' + (ch === ' ' ? ' sp' : WIDE.test(ch) ? ' w' : '')}
          style={stagger ? { animationDelay: (stagger + i * 26) + 'ms' } : undefined}>{ch === ' ' ? '\u00a0' : ch}</span>
      ))}
    </span>
  );
}

/** 칸보다 긴 이름은 전광판처럼 흘러감 */
function Dest({ text, stagger }) {
  const box = useRef(null);
  const [run, setRun] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const inner = el.firstElementChild;
    const over = inner.scrollWidth > el.clientWidth + 2;
    setRun(over ? Math.max(6, inner.scrollWidth / 40) : 0);
  }, [text]);
  return (
    <span class="dest" ref={box}>
      <span class={'mq' + (run ? ' scroll' : '')} style={run ? { '--dur': run + 's' } : undefined}><Flap text={text} stagger={stagger} /></span>
    </span>
  );
}

// 행선지 줄이 위에서부터 차례로 뜨는 건 앱을 켜고 처음 한 번만 (탭 오갈 때마다 반복하면 거슬림)
let arrived = false;

// 종류별 LED 색
const LED_TYPE = { '교통': 'var(--led-b)', '숙소': '#C8A8FF', '식당': '#FF9D6B', '카페': '#FFD98A', '관광지': '#5DFF9A', '쇼핑': '#FF8AD1', '기타': '#C9C9C9' };

/** 전광판 아래칸: 그날 행선지 줄. fromOrder가 있으면 그 뒤 일정만 */
function BoardDay({ v, date, title, fromOrder, max }) {
  const all = dayPoints(v, date);
  const pts = fromOrder == null ? all : all.filter(p => p.order > fromOrder);
  if (!pts.length) return null;
  const show = pts.slice(0, max);
  const rest = pts.length - show.length;
  const visited = all.filter(p => isVisited(v, p)).length;
  const w = v.weather && v.weather[date];
  const [first] = useState(() => !arrived);
  useEffect(() => { arrived = true; }, []);
  return (
    <div class="b-day">
      <div class="dhead">
        <span>{title}</span>
        <span class="ds">
          {visited > 0 && <span>방문 {visited} / {all.length}</span>}
          {w && <span class="dx"><Icon name={weatherInfo(w.code)[0]} label={weatherInfo(w.code)[1]} /> {Math.round(w.min)}° / {Math.round(w.max)}°{w.pop != null ? ' · 비 ' + w.pop + '%' : ''}</span>}
        </span>
      </div>
      {show.map((p, i) => {
        const pl = placeOf(v, p);
        const done = isVisited(v, p);
        const ty = pl && pl.type ? pl.type : '';
        return (
          <div class={'drow' + (done ? ' done' : '')} key={p.order}>
            <span class="t">{p.arrive || p.depart || ''}</span>
            <Dest text={pname(v, p)} stagger={first ? 160 + i * 80 : 0} />
            <span class="ty" style={{ color: done ? 'var(--led-dim)' : LED_TYPE[ty] || '#C9C9C9' }}>{done ? '済' : ty}</span>
          </div>
        );
      })}
      <button type="button" class="dmore" onClick={() => go('plan', date)}>
        하루 일정 보기{rest > 0 ? ' (외 ' + rest + '곳)' : ''}
      </button>
    </div>
  );
}

/** あと1時間25分 */
function ato(min) {
  if (min == null) return '';
  return min >= 60 ? 'あと' + Math.floor(min / 60) + '時間' + (min % 60) + '分' : 'あと' + Math.max(0, min) + '分';
}

export function Board() {
  const v = view.value;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const range = v && tripRange(v);
  if (!range) return <section class="board"><div class="b-main"><p class="count-sub">일정이 없음</p></div></section>;

  const head = (
    <div class="bhead"><span>旅程案内 · 여행 안내</span><span class="clock">{tokyoClock(now)}</span></div>
  );

  // 여행 전: 카운트다운
  if (now < range.start) {
    const c = splitSec((range.start - now) / 1000);
    const first = range.first;
    return (
      <section class="board" aria-label="출발까지 남은 시간과 첫날 일정">
        <div class="b-main">
          {head}
          <p class="count-sub">出発まで · 출발까지</p>
          <p class="count-big glow" role="timer" aria-label={'출발까지 ' + c.d + '일 ' + c.h + '시간 ' + c.m + '분'}>
            <Flap text={String(c.d)} /><span class="count-unit">일</span>
            <Flap text={String(c.h).padStart(2, '0')} /><span class="count-unit">시간</span>
            <Flap text={String(c.m).padStart(2, '0')} /><span class="count-unit">분</span>
            <Flap text={String(c.s).padStart(2, '0')} /><span class="count-unit">초</span>
          </p>
          <p class="count-sub">{dayLabel(first.date)} {first.arrive || ''} {pname(v, first)}에서 출발</p>
        </div>
        <BoardDay v={v} date={v.dates[0]} title={'初日 · 첫날 ' + dayLabel(v.dates[0])} max={6} />
      </section>
    );
  }

  // 여행 끝
  if (now > range.end) {
    return (
      <section class="board" aria-label="여행 끝">
        <div class="b-main">
          {head}
          <p class="count-big count-end glow"><Flap text="おつかれさまでした" /></p>
          <p class="count-sub">여행 끝. 모은 도장은 기록에서 보기</p>
        </div>
      </section>
    );
  }

  // 여행 중: 지금 / 다음 / 그다음
  const nt = tokyoNow(now);
  const { cur, next, after } = nowNext(v, nt);
  const seg = next ? v.segTo.get(next.date + '#' + next.order) : null;
  const npr = next && next.date === nt.date ? predictedMin(v, next) : null;
  const left = cur ? toMin(cur.depart) - nt.min : null;
  return (
    <section class="board" aria-label="지금과 다음 일정">
      <div class="b-main">
        {head}
        {cur && (
          <div class="brow glow">
            <span class="kind now">今</span>
            <span class="t"><Flap text={'~' + cur.depart} /></span>
            <Dest text={pname(v, cur)} />
            <span class="rem"><Flap text={left > 0 ? '출발까지 ' + left + '분' : '출발'} /></span>
          </div>
        )}
        {next && (
          <div class="brow glow">
            <span class="kind next">次</span>
            <span class="t"><Flap text={next.date === nt.date ? (npr != null ? hhmm(npr) : next.arrive || '') : next.arrive || ''} /></span>
            <Dest text={pname(v, next)} />
            <span class="rem"><Flap text={next.date === nt.date ? ato(remainMin(v, next, nt)) : dayLabel(next.date)} /></span>
          </div>
        )}
        {seg && (
          <p class="bsub">
            {segModeName(seg)} {seg.minutes}분
            {segRides(seg).slice(0, 3).map((r, i) => <span class="ln" key={i}>{r.line}</span>)}
          </p>
        )}
        {after && (
          <div class="brow glow">
            <span class="kind after">その次</span>
            <span class="t"><Flap text={after.arrive || ''} /></span>
            <Dest text={pname(v, after)} />
            <span class="rem" />
          </div>
        )}
        {!cur && !next && <p class="count-sub">오늘 일정 끝. 푹 쉬기</p>}
        <p class="bfoot">일본 시간 기준</p>
      </div>
    </section>
  );
}
