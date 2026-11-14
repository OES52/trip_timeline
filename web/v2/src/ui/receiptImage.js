// 하루 영수증을 그림(PNG)으로: 캔버스에 직접 그림 → 폰은 공유 창(사진에 저장), 안 되면 내려받기
import { YEN } from '../lib/money.js';
import { dayLabel } from '../lib/time.js';

export const SHOP = '오잇트립', SHOP_EN = 'TRAVEL RECEIPT';

/** @param r passport.receipt() 결과  @returns 'shared' | 'saved' | 'cancel' */
export async function saveReceiptImage(r) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* 무시 */ }
  const W = 420, S = 3, P = 26;
  const sans = '"LINE Seed KR", "Pretendard JP Variable", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const mono = '"Galmuri11", "DotGothic16", ui-monospace, monospace';
  const ink = '#2A2620', ink2 = '#6B6253';
  const lines = [];
  const add = (h, fn) => lines.push({ h, fn });
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const text = (t, x, y, font, color, align) => { g.font = font; g.fillStyle = color || ink; g.textAlign = align || 'left'; g.fillText(t, x, y); };
  const fit = (t, max, font) => { g.font = font; if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; };
  const sep = dbl => add(18, y => {
    g.strokeStyle = '#8A7F6E'; g.lineWidth = 1; g.setLineDash(dbl ? [] : [4, 4]);
    g.beginPath(); g.moveTo(P, y + 9); g.lineTo(W - P, y + 9); g.stroke();
    if (dbl) { g.beginPath(); g.moveTo(P, y + 12); g.lineTo(W - P, y + 12); g.stroke(); }
    g.setLineDash([]);
  });
  const row = (a, b, o = {}) => add(o.total ? 30 : 22, y => {
    text(a, P, y + 16, (o.total ? '700 18px ' : '14px ') + sans, o.muted ? ink2 : null);
    text(b, W - P, y + 16, (o.total ? '700 20px ' : '700 14px ') + sans, o.muted ? ink2 : null, 'right');
  });
  add(40, y => text(SHOP, W / 2, y + 32, '700 30px ' + sans, null, 'center'));
  add(22, y => text(SHOP_EN + (r.planned ? ' (예정)' : ''), W / 2, y + 16, '12px ' + sans, ink2, 'center'));
  sep();
  row(dayLabel(r.date) + ' · ' + r.no + '일차', 'No.' + String(r.no).padStart(4, '0'));
  row('여행자', r.user);
  if (r.route) row('구간', fit(r.route, W - P * 2 - 80, '700 14px ' + sans));
  sep();
  r.items.forEach(x => add(22, y => {
    text(x.time, P, y + 16, '15px ' + mono, '#4A4033');
    text(fit(x.name + (x.memo ? ' (' + x.memo + ')' : ''), W - P * 2 - 130, '14px ' + sans), P + 56, y + 16, '14px ' + sans, x.done || x.amount != null ? null : ink2);
    text(x.amount != null ? YEN(x.amount) : x.done ? '✓' : '', W - P, y + 16, '700 14px ' + sans, null, 'right');
  }));
  sep();
  row('방문 도장', r.stamps + ' / ' + r.total);
  if (r.walkKm != null) row('걸은 거리', r.walkKm.toFixed(1) + ' km' + (r.walkMin ? ' · ' + r.walkMin + '분' : ''));
  row('교통비 (1인)', YEN(r.fare));
  row('쓴 돈 (기록)', YEN(r.spent));
  sep(true);
  row('합계', YEN(r.sum), { total: true });
  let hankoY = null;
  if (!r.planned) add(0, y => { hankoY = y - 30; });
  add(58, y => {   // 바코드 (날짜·사용자로 고정된 무늬)
    let seed = 0;
    String(r.date + r.user).split('').forEach(ch => { seed = (seed * 31 + ch.charCodeAt(0)) >>> 0; });
    let x = P + 30;
    g.fillStyle = ink;
    while (x < W - P - 30) { seed = (seed * 1103515245 + 12345) >>> 0; const w = 1 + ((seed >>> 28) % 3); g.fillRect(x, y + 12, w, 38); x += w + 1 + ((seed >>> 24) % 3); }
  });
  add(24, y => text('またお越しくださいませ · 또 와요', W / 2, y + 16, '12px ' + sans, ink2, 'center'));
  const H = P + lines.reduce((a, l) => a + l.h, 0) + P;
  c.width = W * S; c.height = H * S;
  g.scale(S, S);
  g.fillStyle = '#FBF8F1';   // 종이 + 위아래 톱니
  g.beginPath(); g.moveTo(0, 8);
  for (let x = 0; x <= W; x += 12) { g.lineTo(x + 6, 0); g.lineTo(Math.min(W, x + 12), 8); }
  g.lineTo(W, H - 8);
  for (let x = W; x >= 0; x -= 12) { g.lineTo(x - 6, H); g.lineTo(Math.max(0, x - 12), H - 8); }
  g.closePath(); g.fill();
  let y = P;
  lines.forEach(l => { l.fn(y); y += l.h; });
  if (hankoY != null) {   // 領収 도장
    g.save();
    g.translate(W / 2 + 10, hankoY + 15);
    g.rotate(-12 * Math.PI / 180);
    g.globalAlpha = 0.75;
    g.strokeStyle = '#C4302B'; g.fillStyle = '#C4302B';
    g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, 25, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.beginPath(); g.arc(0, 0, 20.5, 0, Math.PI * 2); g.stroke();
    g.font = '700 15px ' + sans; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('領収', 0, 1);
    g.restore();
  }
  const name = SHOP + '_영수증_' + r.date + '.png';
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('영수증 그림을 못 만듦');
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: SHOP + ' 영수증' }); return 'shared'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'saved';
}
