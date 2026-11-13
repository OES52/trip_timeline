// 일정: 날짜를 고르고 그날 타임라인을 봄
//  머리줄 = 날짜 띠(도시색 밑줄) / 본문 = 날짜 표지판(역명판) + 하루 승차권(돈·걷기) + 타임라인
import { view, nt, day, go } from '../data/store.js';
import { WEEK, dow, md, dayLabel } from '../lib/time.js';
import { dayCity, dayRoute, dayPoints, daySpend, dayFare, dayActual, dayWalk, isVisited } from '../lib/trip.js';
import { money, YEN, WON } from '../lib/money.js';
import { TopBar, SyncLine } from '../ui/Shell.jsx';
import { Timeline } from '../ui/Timeline.jsx';
import { Icon } from '../ui/Icon.jsx';
import { weatherInfo } from '../ui/icons.js';

/** 머리줄 날짜 띠 */
function DayStrip({ v, cur, today }) {
  return (
    <div class="strip" role="group" aria-label="날짜">
      {v.dates.map(d => {
        const c = dayCity(v, d);
        const w = dow(d);
        return (
          <button type="button" key={d} class={'strip-d' + (d === today ? ' is-today' : '')} aria-pressed={d === cur}
            aria-label={dayLabel(d) + (c.name ? ' ' + c.name : '') + (d === today ? ', 오늘' : '')}
            style={{ '--c': c.color || 'var(--ink-3)' }} onClick={() => go('plan', d)}>
            <span class={'strip-w' + (w === 0 ? ' sun' : w === 6 ? ' sat' : '')}>{WEEK[w]}</span>
            <b class="num">{Number(d.slice(8))}</b>
          </button>
        );
      })}
    </div>
  );
}

/** 날짜 표지판: 역명판처럼 가운데 큰 날짜, 아래 도시색 띠, 양옆에 앞뒤 날짜 */
function DaySign({ v, date }) {
  const i = v.dates.indexOf(date);
  const route = dayRoute(v, date);
  const prev = v.dates[i - 1], next = v.dates[i + 1];
  const w = v.weather && v.weather[date];
  const band = route.length ? route : [{ name: '', color: '' }];
  return (
    <section class="sign" aria-label={dayLabel(date) + ' ' + (i + 1) + '일차'}>
      <p class="sign-n">{i + 1}일차</p>
      <h1 class="sign-d">{dayLabel(date)}</h1>
      <p class="sign-r">
        {route.map((c, k) => <span key={k}>{k > 0 && <i aria-hidden="true">›</i>}{c.name}</span>)}
        {w && <span class="sign-w"><Icon name={weatherInfo(w.code)[0]} label={weatherInfo(w.code)[1]} /><span class="num">{Math.round(w.min)}° / {Math.round(w.max)}°</span></span>}
      </p>
      <div class="sign-band" aria-hidden="true">
        {band.map((c, k) => <i key={k} style={{ background: c.color || 'var(--ink-3)' }} />)}
      </div>
      <div class="sign-nav">
        {prev
          ? <button type="button" onClick={() => go('plan', prev)} aria-label={'앞 날짜 ' + dayLabel(prev)}><Icon name="left" /><span>{dayLabel(prev)} {dayCity(v, prev).name}</span></button>
          : <span />}
        {next
          ? <button type="button" onClick={() => go('plan', next)} aria-label={'다음 날짜 ' + dayLabel(next)}><span>{dayLabel(next)} {dayCity(v, next).name}</span><Icon name="right" /></button>
          : <span />}
      </div>
    </section>
  );
}

/** 하루 승차권: 그날의 돈과 걷기 (종이 = 돈·기록) */
function DayTicket({ v, date }) {
  const i = v.dates.indexOf(date);
  const sp = daySpend(v, date);
  const fare = dayFare(v, date);
  const act = dayActual(v, date);
  const walk = dayWalk(v, date);
  const pts = dayPoints(v, date);
  const visited = pts.filter(p => isVisited(v, p)).length;
  const figs = [];
  if (sp.total > 0) {
    figs.push(['1인당', money(sp.total, v.rate)]);
    figs.push(['결제함', money(sp.paid, v.rate)]);
    figs.push(['남은 결제', money(sp.left, v.rate), sp.left > 0 ? 'due' : '']);
  }
  if (fare.sum > 0) figs.push(['교통비 1인', YEN(fare.sum)]);
  if (walk) figs.push(['걷기', walk.km.toFixed(1) + 'km', walk.many ? 'due' : '']);
  if (act.has) figs.push(['실제 지출', YEN(act.actual), act.plan && act.actual > act.plan ? 'due' : '']);
  if (!figs.length) return null;
  const notes = [];
  if (v.rate && sp.total > 0) notes.push('원화로는 ' + WON(sp.total) + ' (환율 ' + v.rate + ')');
  if (fare.missing) notes.push('요금 미입력 ' + fare.missing + '구간');
  if (walk && walk.min) notes.push('걷는 시간 ' + walk.min + '분' + (walk.many ? ', 많이 걷는 날' : ''));
  if (act.has && act.plan) notes.push('계획 ' + YEN(act.plan) + ' 대비 ' + (act.actual > act.plan ? YEN(act.actual - act.plan) + ' 초과' : YEN(act.plan - act.actual) + ' 남음'));
  if (visited) notes.push('방문 ' + visited + ' / ' + pts.length);
  return (
    <section class="ticket" aria-label="이날 비용과 걷기">
      <p class="ticket-top"><span>乗車券 · {i + 1}일차</span><span class="num">No.{String(i + 1).padStart(4, '0')}</span></p>
      <dl class="ticket-figs">
        {figs.map(([k, val, tone]) => <div key={k}><dt>{k}</dt><dd class={'num' + (tone ? ' is-' + tone : '')}>{val}</dd></div>)}
      </dl>
      {notes.length > 0 && <ul class="ticket-notes">{notes.map((n, k) => <li key={k}>{n}</li>)}</ul>}
    </section>
  );
}

export function Plan() {
  const v = view.value;
  const d = day.value;
  const now = nt.value;
  if (!d) return (
    <main class="screen plan">
      <TopBar><div class="ctx"><b>일정</b></div></TopBar>
      <div class="state"><h2>표시할 일정이 없음</h2><p>시트의 "일정"에 장소를 넣고 경로 계산을 실행하면 여기에 나옴</p></div>
    </main>
  );
  return (
    <main class="screen plan">
      <TopBar><DayStrip v={v} cur={d} today={now.date} /></TopBar>
      <SyncLine />
      <div class="scroll" key={d}>
        <div class="plan-in">
          <DaySign v={v} date={d} />
          <DayTicket v={v} date={d} />
          <Timeline date={d} focus={d === now.date} />
        </div>
      </div>
    </main>
  );
}
