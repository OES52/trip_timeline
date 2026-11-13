// 금액 표시. 시트의 예산은 원화(per)로 오고, 환율(rate)이 있으면 엔화로 바꿔 보여줌

const WON_FMT = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
export const WON = n => WON_FMT.format(n);
export const YEN = n => '¥' + Math.round(n).toLocaleString('en-US');

/** 원화 금액을 화면용으로 (환율 있으면 엔화) */
export function money(won, rate) {
  if (won == null || isNaN(won)) return '';
  return rate ? YEN(won / rate) : WON(won);
}

/** 1인당 예산: 한국에서 미리 낸 원화 항목은 ₩ 그대로, 나머지는 엔화 */
export function perText(p, rate) {
  if (p.perCur === '₩' && p.perOrig != null && !isNaN(p.perOrig)) return WON(p.perOrig);
  if (p.perCur === '¥' && p.perOrig != null && !isNaN(p.perOrig)) return YEN(p.perOrig);
  return money(p.per, rate);
}

/** 장소의 예상 비용 범위 */
export function costText(pl) {
  const a = pl.costMin, b = pl.costMax;
  if (a == null && b == null) return '';
  if ((a || 0) === 0 && (b || 0) === 0) return '무료';
  if (a != null && b != null && a !== b) return YEN(a) + ' ~ ' + YEN(b);
  return YEN(b != null ? b : a);
}
