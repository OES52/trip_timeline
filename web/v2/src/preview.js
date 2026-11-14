// 시간 미리보기: 주소 뒤에 ?now=2026-12-25T12:30 (일본 시각)을 붙이면 그 시각부터 시계가 흘러감
//  여행 전에 당일 화면(지금·다음, 전광판, 단계 안내, 막차·영업 경고)을 미리 보려는 용도
//  main.jsx가 이 파일을 제일 먼저 불러서, 다른 코드가 시계를 읽기 전에 Date를 바꿔 끼움
//  미리보기 동안 기록·일정 조정은 막음 (가짜 시각이 시트에 들어가지 않게)

/** "2026-12-25T12:30", "2026-12-25 12:30", "2026-12-25T12:30:00" → 일본 시각 ms (아니면 NaN) */
export function parseNow(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  if (!m) return NaN;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}+09:00`);
}

const target = typeof location === 'undefined' ? NaN : parseNow(new URLSearchParams(location.search).get('now'));

/** { on, start(ms), exitUrl } */
export const preview = { on: Number.isFinite(target), start: target, exitUrl: '' };

if (preview.on) {
  const Real = Date;
  const off = target - Real.now();
  // 인자 없이 만든 Date와 Date.now()만 옮김. 날짜를 넣어 만드는 건 그대로
  class PreviewDate extends Real {
    constructor(...a) { if (a.length === 0) super(Real.now() + off); else super(...a); }
    static now() { return Real.now() + off; }
  }
  globalThis.Date = PreviewDate;
  const u = new URL(location.href);
  u.searchParams.delete('now');
  preview.exitUrl = u.pathname + u.search + u.hash;
}
