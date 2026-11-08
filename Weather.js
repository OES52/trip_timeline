/* ───────────────────────── 날씨 ───────────────────────── */
/* Weather.gs  */
// 날짜별 그날 장소들 중심 좌표로 Open-Meteo 예보 (키 필요 없음, 최대 16일 앞까지)
function getWeather_(points) {
  const cache = CacheService.getScriptCache();
  const byDate = {};
  points.forEach(p => {
    if (p.lat == null) return;
    (byDate[p.date] = byDate[p.date] || []).push(p);
  });
  const out = {};
  const today = Utilities.formatDate(new Date(), CONFIG.TRIP_TZ, 'yyyy-MM-dd');
  const limit = Utilities.formatDate(new Date(Date.now() + 15 * 86400000), CONFIG.TRIP_TZ, 'yyyy-MM-dd');

  Object.keys(byDate).forEach(date => {
    if (date < today || date > limit) return;
    const pts = byDate[date];
    const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    const lng = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
    const key = 'wx|' + date + '|' + lat.toFixed(2) + '|' + lng.toFixed(2);
    const hit = cache.get(key);
    if (hit) { out[date] = JSON.parse(hit); return; }
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lng.toFixed(4) +
        '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&timezone=Asia%2FTokyo&start_date=' + date + '&end_date=' + date;
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return;
      const d = JSON.parse(res.getContentText()).daily;
      if (!d || !d.time || !d.time.length) return;
      const w = { code: d.weathercode[0], max: d.temperature_2m_max[0], min: d.temperature_2m_min[0], pop: d.precipitation_probability_max[0] };
      out[date] = w;
      cache.put(key, JSON.stringify(w), 3 * 3600);
    } catch (e) {
      // 날씨는 실패해도 무시
    }
  });
  return out;
}