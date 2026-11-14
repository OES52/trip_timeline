// 오늘: 여행 단계에 따라 바뀌는 첫 화면
//  전: 전광판 카운트다운 + 날짜별 여정 / 중: 지금·다음 + 길찾기 + 오늘 남은 일정 / 후: 여정 돌아보기
import { view, nt, nowMs, go, user } from '../data/store.js';
import { recordArrivalNow } from '../data/records.js';
import { dayLabel, md, fmtDur, hhmm, toMin } from '../lib/time.js';
import { phase, tripRange, nowNext, remainMin, predictedMin, pname, vk, arrivedAt, dayCity, dayRoute, dayPoints, daySpend, segModeName, segRides, MODE_KEY } from '../lib/trip.js';
import { money } from '../lib/money.js';
import { navUrl, haversine, fmtDist, walkMin } from '../lib/geo.js';
import { pos } from '../data/location.js';
import { onColor } from '../lib/colors.js';
import { TopBar, SyncLine } from '../ui/Shell.jsx';
import { Board } from '../ui/Board.jsx';
import { Timeline } from '../ui/Timeline.jsx';
import { Icon } from '../ui/Icon.jsx';
import { MODE_ICON } from '../ui/icons.js';

const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/** 머리줄 왼쪽: 지금 여행의 어디쯤인지 */
function Title({ v, ph, now }) {
  const r = tripRange(v);
  if (ph === 'before') {
    const c = dayCity(v, v.dates[0]);
    return (
      <div class="ctx" style={{ '--c': c.color || 'var(--ink)' }}>
        <b class="num">D-{Math.max(0, dayDiff(now.date, r.first.date))}</b>
        <span>{dayLabel(r.first.date)} 출발</span>
      </div>
    );
  }
  if (ph === 'during') {
    const i = v.dates.indexOf(now.date);
    const c = dayCity(v, now.date);
    return (
      <div class="ctx" style={{ '--c': c.color || 'var(--ink)' }}>
        <b>{i >= 0 ? (i + 1) + '일차' : '여행 중'}</b>
        <span>{dayLabel(now.date)}{c.name ? ' ' + c.name : ''}</span>
      </div>
    );
  }
  return (
    <div class="ctx">
      <b>{ph === 'after' ? '여행 끝' : '여행'}</b>
      {r && <span class="num">{md(r.first.date)} – {md(r.last.date)}</span>}
    </div>
  );
}

/** 다음 장소로 가는 행동 한 줄 (전광판 바로 아래) */
function NextUp({ v, now }) {
  const { next } = nowNext(v, now);
  if (!next || next.lat == null) return null;
  const seg = v.segTo.get(vk(next));
  const k = seg ? (seg.taxi && seg.taxi.on ? 'taxi' : MODE_KEY[seg.mode] || 'manual') : null;
  const rm = remainMin(v, next, now);
  const pr = next.date === now.date ? predictedMin(v, next) : null;
  const arr = arrivedAt(v, next);
  // 계획보다 일찍 닿았을 때도 여기서 바로 도착을 적을 수 있게 (보기 전용 사용자는 버튼 없음)
  const showRec = !!(user.value && user.value.canStamp) && next.date === now.date && !arr;
  return (
    <section class={'nextup' + (showRec ? ' has-rec' : '')} aria-label="다음 장소로 가기">
      <div class="nextup-t">
        <p class="nextup-n">{pname(v, next)}</p>
        <p class="nextup-s">
          {next.date === now.date
            ? <><span class="num">{pr != null ? hhmm(pr) : next.arrive}</span> 도착{rm != null && rm > 0 ? ', ' + fmtDur(rm) + ' 남음' : ''}</>
            : <>{dayLabel(next.date)} <span class="num">{next.arrive}</span></>}
        </p>
        {seg && (
          <p class="nextup-s">
            <Icon name={MODE_ICON[k]} />{segModeName(seg)} {fmtDur(seg.minutes)}
            {segRides(seg).slice(0, 2).map((r, i) => <span class="line" key={i} style={r.color ? { '--lc': r.color, '--lt': onColor(r.color) } : undefined}>{r.line}</span>)}
          </p>
        )}
        <WalkEta v={v} p={next} now={now} pr={pr} />
        {arr && <p class="nextup-s note-ok">실제 <span class="num">{arr}</span> 도착 기록함</p>}
      </div>
      <div class="nextup-act">
        {showRec && <button type="button" class="btn btn-plate" onClick={() => recordArrivalNow(next)}><Icon name="clock" />도착 기록</button>}
        <a class="btn btn-exit" href={navUrl(next.lat, next.lng)} target="_blank" rel="noopener"><Icon name="nav" />길찾기</a>
      </div>
    </section>
  );
}

/** 위치를 켰을 때: 지금 걸어가면 몇 시 도착인지, 계획보다 여유/늦음 (2.5km 안), 멀면 거리만 */
function WalkEta({ v, p, now, pr }) {
  const me = pos.value;
  if (!me || p.date !== now.date || p.lat == null || arrivedAt(v, p)) return null;
  const d = haversine([me.lat, me.lng], [p.lat, p.lng]);
  if (d > 2500) return <p class="nextup-s"><Icon name="nav" />여기서 직선 <span class="num">{fmtDist(d)}</span></p>;
  const eta = now.min + walkMin(d);
  const plan = pr != null ? pr : toMin(p.arrive);
  const diff = plan == null ? null : plan - eta;
  return (
    <p class="nextup-s">
      <Icon name="walk" />지금 걸어가면 <span class="num">{hhmm(eta)}</span> 도착 · <span class="num">{fmtDist(d)}</span>
      {diff != null && (diff >= 0 ? <em class="note-ok"> · {diff}분 여유</em> : <em class="note-late"> · {-diff}분 늦음</em>)}
    </p>
  );
}

/** 날짜별 여정: 도시색 띠 + 날짜 + 지나는 도시 + 장소 수·1인당 금액. 누르면 그날 일정 */
function TripDays({ v, now }) {
  return (
    <section class="block" aria-labelledby="days-h">
      <h2 class="block-h" id="days-h">여정</h2>
      <ol class="days">
        {v.dates.map((d, i) => {
          const c = dayCity(v, d);
          const route = dayRoute(v, d);
          const sp = daySpend(v, d);
          const past = d < now.date, today = d === now.date;
          return (
            <li key={d}>
              <button type="button" class={'dayrow' + (past ? ' is-past' : '') + (today ? ' is-today' : '')} style={{ '--c': c.color || 'var(--ink-3)' }} onClick={() => go('plan', d)}>
                <span class="dayrow-n">{i + 1}일차</span>
                <span class="dayrow-d">
                  <b>{dayLabel(d)}{today && <em class="tag tag-now">오늘</em>}</b>
                  <span class="dayrow-r">{route.map(x => x.name).join(' › ')}</span>
                </span>
                <span class="dayrow-x">
                  <span><b class="num">{dayPoints(v, d).length}</b>곳</span>
                  {sp.total > 0 && <span class="num">{money(sp.total, v.rate)}</span>}
                </span>
                <Icon name="right" />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Today() {
  const v = view.value;
  const now = nt.value;
  const ph = phase(v, new Date(nowMs.value));
  const nn = ph === 'during' ? nowNext(v, now) : null;
  // 여행 중엔 지금 있는 곳(없으면 다음 갈 곳)부터 보여줌
  const from = nn ? (nn.cur || (nn.next && nn.next.date === now.date ? nn.next : null)) : null;
  return (
    <main class="screen today">
      <TopBar><Title v={v} ph={ph} now={now} /></TopBar>
      <SyncLine />
      <div class="scroll">
        <Board />
        <div class="today-in">
          {ph === 'during' && <NextUp v={v} now={now} />}
          {ph === 'during' && from && (
            <section class="block" aria-labelledby="left-h">
              <div class="block-row">
                <h2 class="block-h" id="left-h">오늘 남은 일정</h2>
                <button type="button" class="btn btn-quiet btn-sm" onClick={() => go('plan', now.date)}>하루 전체 보기</button>
              </div>
              <Timeline date={now.date} fromOrder={from.order - 1} compact />
            </section>
          )}
          <TripDays v={v} now={now} />
        </div>
      </div>
    </main>
  );
}
