// 일몰 시각. NOAA 근사식이라 오차 1~2분

/** 그 지점의 일몰(여행 시간대 기준, 자정부터 분). 해가 안 지는 날이면 null */
export function sunsetMin(date, lat, lng, tzOffsetMin = 540) {
  if (lat == null || lng == null) return null;
  const rad = Math.PI / 180;
  const [y, mo, d] = date.split('-').map(Number);
  const N = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const lngHour = lng / 15;
  const t = N + (18 - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634;
  L = ((L % 360) + 360) % 360;
  let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
  RA = ((RA % 360) + 360) % 360;
  RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
  const sinDec = 0.39782 * Math.sin(L * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
  if (cosH > 1 || cosH < -1) return null;
  const H = Math.acos(cosH) / rad / 15;
  const UT = (((H + RA - 0.06571 * t - 6.622 - lngHour) % 24) + 24) % 24;
  return Math.round((UT * 60 + tzOffsetMin + 1440) % 1440);
}
