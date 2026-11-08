/* ───────────────────────── 경로 계산 ───────────────────────── */
/* Routes.gs  */
function calculateRoutes() { requireSheetUi_(); runCalc_(false); }
function calculateRoutesForce() { requireSheetUi_(); runCalc_(true); }

// opts.quick = true: 웹앱 조정(체류·건너뛰기)에서 부를 때. 배차 점검 호출을 생략해서 빠르게
// (점검 안 한 구간은 경고 칸이 빈 채로 남고, 다음에 시트에서 경로 계산하면 그때 점검)
function runCalc_(force, opts) {
  opts = opts || {};
  const quick = !!opts.quick;
  const ss = SpreadsheetApp.getActive();
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  const routeSh = ss.getSheetByName(CONFIG.ROUTE_SHEET);
  if (!plan || !routeSh) { alert_('먼저 "시트 생성" 실행'); return; }
  if (!planHeaderIsCurrent_(plan)) {
    alert_('일정 시트가 예전 구성임. 여행 도구 → "시트 구조 업데이트" 먼저 실행');
    return;
  }
  ensureRouteHeader_(routeSh);

  const lastRow = lastDataRow_(plan);
  if (lastRow < 2) { alert_('일정 시트에 데이터가 없음'); return; }

  // 함수가 윗행을 참조하므로 값 열만 일자·순서대로 정렬 (함수 열은 건드리지 않음)
  const ssTz = ss.getSpreadsheetTimeZone();
  sortPlanRows_(plan, lastRow, ssTz);
  // 중간에 행을 끼워 넣으면 아래 행 함수가 새 행을 건너뛰고 참조하므로 매번 함수 다시 씀
  writePlanFormulas_(plan);
  SpreadsheetApp.flush();

  const errors = [];
  const rows = readPlanRows_(plan, ssTz);

  // 주유패스: 설정 시트의 날짜·노선
  const st = readSettings_();
  const passDays = {};
  st.passDays.forEach(d => { passDays[d] = true; });
  let passRe = null;
  try { passRe = new RegExp(st.passLines, 'i'); } catch (e) { errors.push('설정 시트 "주유패스 노선" 정규식이 잘못됨: ' + e.message); }
  let passAll = 0, passSome = 0, passPicked = 0;
  const walkHints = [], taxiHints = [];
  // 패스 날 대중교통 경로는 후보 중 패스 전철 우선 (passPref가 있으면)
  const passPref = date => (passDays[date] && passRe) ? { re: passRe } : null;

  // 1. 시작점 좌표 채우기
  rows.forEach(r => {
    if (r.lat != null) return;
    const found = resolveCoord_(r);
    const cell = plan.getRange(r.sheetRow, P.COORD);
    if (found) {
      r.lat = found.lat;
      r.lng = found.lng;
      cell.setValue(found.lat.toFixed(6) + ',' + found.lng.toFixed(6))
        .setBackground(CONFIG.COLOR_AUTO_COORD)
        .setNote('자동 (' + found.source + ')\n위치 확인 후 맞으면 배경색 지워도 됨');
    } else {
      errors.push(r.sheetRow + '행 "' + r.place + '": 위치를 못 찾음. 지도 링크나 좌표 직접 입력 필요');
    }
  });

  // 1-2. 종착점 좌표 채우기 (종착 지도 링크가 있을 때만. 장소명 검색은 안 함)
  rows.forEach(r => {
    if (r.endLat != null || !r.endLink) return;
    const found = coordFromLink_(r.endLink);
    const cell = plan.getRange(r.sheetRow, P.END_COORD);
    if (found) {
      r.endLat = found.lat;
      r.endLng = found.lng;
      cell.setValue(found.lat.toFixed(6) + ',' + found.lng.toFixed(6))
        .setBackground(CONFIG.COLOR_AUTO_COORD)
        .setNote('자동 (종착 지도 링크)\n위치 확인 후 맞으면 배경색 지워도 됨');
    } else {
      errors.push(r.sheetRow + '행 "' + r.place + '": 종착 지도 링크에서 좌표를 못 뽑음. 종착 좌표 직접 입력 필요 (지금은 시작점에서 출발로 계산)');
    }
  });

  // 1-3. 종착점이 있는 장소: 시작점→종착점 도보 경로 조회해서 저장 (한 번 받으면 재사용, 웹앱 조정 중엔 생략)
  if (!quick) rows.forEach(r => innerWalk_(r, true));

  // 2. 일자별로 구간 계산 (대중교통은 출발 시각에 따라 결과가 달라서 시각도 내부에서 같이 계산)
  //    다음 장소로는 종착점이 있으면 종착점에서, 없으면 시작점에서 출발
  const cache = force ? {} : loadRouteCache_(routeSh);
  const now = Utilities.formatDate(new Date(), CONFIG.TRIP_TZ, 'yyyy-MM-dd HH:mm');
  const moveOut = {};
  const routeRows = [];

  groupByDate_(rows).forEach(group => {
    const date = group.date;
    const list = group.rows;
    let arrive = null;
    const step = roundStep_();   // 시트 함수와 같은 방식으로 출발 시각 올림 (이동은 수단별 moveStep_)

    list.forEach((r, idx) => {
      if (idx === 0) {
        if (r.fixed != null) {
          arrive = r.fixed;
        } else {
          arrive = parseHHmm_(CONFIG.DEFAULT_START);
          errors.push(date + ' 첫 행에 고정 시각이 없어서 ' + CONFIG.DEFAULT_START + ' 시작으로 계산');
        }
      }

      let start = arrive;
      if (r.fixed != null) start = Math.max(arrive, r.fixed);
      const depart = ceilTo_(start + r.stay, step);

      const next = list[idx + 1];
      if (!next) return;

      const seg = computeSegment_(date, depart, departFrom_(r), next, cache, errors, quick, passPref(date));
      if (seg.passExtra != null) passPicked++;
      // 주유패스 날의 대중교통: 탑승 단계가 전부 패스 노선이면 0원, 일부면 요금 그대로 두고 표시만
      let pass = '';
      if (r.mode === '대중교통' && passDays[date] && passRe && seg.steps) {
        const cov = passCoverage_(seg.steps, passRe);
        if (cov === 'all') { pass = '주유패스'; passAll++; }
        else if (cov === 'some') { pass = '주유패스 일부 (요금 직접 확인)'; passSome++; }
      }
      // 수동 구간은 시트 함수가 수동 소요(분)·수동 교통비를 직접 쓰므로 비워둠
      // 택시로 가기 구간(차 + [택시] 메모): 교통비 = 택시 요금 범위 위쪽 ÷ 인원수 (교통비 예산에 그대로 들어감)
      const fromPt = departFrom_(r);
      let fareOut = pass === '주유패스' ? 0 : seg.fare;
      if (r.mode === '차' && TAXI_TAG_RE.test(r.memo)) {
        const ti = taxiInfo_(seg.taxi, st.travelers, depart, fromPt.lat, fromPt.lng);
        if (ti) fareOut = ti.perHigh;
      }
      moveOut[r.sheetRow] = r.mode === '수동' ? ['', ''] : [seg.minutes, fareOut];
      routeRows.push([
        date, r.order + '→' + next.order, r.place + (r.endLat != null ? ' (종착점)' : ''), next.place, r.mode || '(미지정)',
        fmtMin_(depart), fmtMin_(depart + seg.minutes), seg.minutes,
        seg.summary, seg.transfers, seg.polyline,
        '=HYPERLINK("' + seg.link + '","경로")',
        seg.cached ? seg.calcAt : now, seg.key, seg.fare, seg.warn || '', seg.steps || '', pass,
        seg.walk == null ? '' : seg.walk, seg.taxi == null ? '' : seg.taxi,
      ]);
      const wh = walkHint_(r.mode, seg.minutes, seg.walk, seg.summary);
      if (wh) walkHints.push(date.slice(5).replace('-', '/') + ' ' + r.place + ' → ' + next.place + ': ' + wh);
      const th = taxiHint_(r.mode, seg.minutes, seg.taxi, st.travelers, depart, fromPt.lat, fromPt.lng);
      if (th) taxiHints.push(date.slice(5).replace('-', '/') + ' ' + r.place + ' → ' + next.place + ': ' + th);
      arrive = depart + ceilTo_(seg.minutes, moveStep_(r.mode));
    });
  });

  // 3. 일정 시트에 이동(분)·API 요금 기록 (도착·출발·여유·교통비는 함수가 알아서 갱신)
  const out = [];
  for (let row = 2; row <= lastRow; row++) out.push(moveOut[row] || ['', '']);
  plan.getRange(2, P.MOVE, out.length, 1).setValues(out.map(o => [o[0]]));
  plan.getRange(2, P.FARE_API, out.length, 1).setValues(out.map(o => [o[1]]));

  // 4. 경로 시트 덮어쓰기
  const oldLast = routeSh.getLastRow();
  if (oldLast >= 2) routeSh.getRange(2, 1, oldLast - 1, ROUTE_HEADERS.length).clearContent();
  if (routeRows.length) routeSh.getRange(2, 1, routeRows.length, ROUTE_HEADERS.length).setValues(routeRows);

  // 5. 교통비 예산 행 맞추기
  const tr = syncTransportBudget_(ss);

  // 6. 일정 점검 (시트 함수가 새 이동 시간으로 도착·출발을 다시 계산한 뒤)
  SpreadsheetApp.flush();
  const placeSh = ss.getSheetByName(CONFIG.PLACE_SHEET);
  const checks = runChecks_(readPlanRows_(plan, ssTz), routeRows, placeSh ? readPlaces_(placeSh) : []);
  const walkDays = walkByDate_(routeRows, rows);

  let msg = routeRows.length + '개 구간 계산 완료';
  const noFare = routeRows.filter(row => row[R.MODE - 1] === '대중교통' && row[R.FARE - 1] === '').length;
  if (noFare) msg += '\n대중교통 ' + noFare + '구간은 요금 정보가 없음. 수동 교통비(¥)에 직접 입력';
  if (tr.created.length) msg += '\n예산에 교통비 행 추가: ' + tr.created.join(', ');
  if (passPicked) msg += '\n주유패스 전철 우선: ' + passPicked + '구간에서 가장 빠른 경로 대신 패스 전철 경로를 고름 (최대 +' + CONFIG.PASS_PREFER_MAX_EXTRA + '분까지 허용)';
  if (passAll || passSome) msg += '\n주유패스: ' + passAll + '구간 0원 처리' + (passSome ? ', ' + passSome + '구간은 일부만 패스 노선이라 요금 그대로 (경로 시트 "패스" 열 확인, 필요하면 수동 교통비 입력)' : '');
  const warns = routeRows
    .filter(row => row[R.WARN - 1] && row[R.WARN - 1] !== 'OK')
    .map(row => String(row[R.DATE - 1]).slice(5).replace('-', '/') + ' ' + row[R.FROM - 1] + ' → ' + row[R.TO - 1] + ': ' + row[R.WARN - 1]);
  if (warns.length) msg += '\n\n⚠ 이동 점검:\n- ' + warns.slice(0, 10).join('\n- ') + (warns.length > 10 ? '\n(외 ' + (warns.length - 10) + '건)' : '');
  if (checks.length) msg += '\n\n⚠ 일정 점검:\n- ' + checks.slice(0, 20).join('\n- ') + (checks.length > 20 ? '\n(외 ' + (checks.length - 20) + '건)' : '');
  const wd = Object.keys(walkDays).sort();
  if (wd.length) msg += '\n\n🚶 하루 도보: ' + wd.map(d => d.slice(5).replace('-', '/') + ' ' + (walkDays[d].m / 1000).toFixed(1) + 'km' + (walkDays[d].m / 1000 >= CONFIG.WALK_DAY_KM ? ' ⚠많음' : '')).join(' · ');
  if (taxiHints.length) msg += '\n\n🚕 택시가 빠른 구간 (요금은 대략):\n- ' + taxiHints.slice(0, 10).join('\n- ') + (taxiHints.length > 10 ? '\n(외 ' + (taxiHints.length - 10) + '건)' : '');
  if (walkHints.length) msg += '\n\n🚶 도보 추천 (다음 이동수단을 도보로 바꿔도 됨):\n- ' + walkHints.slice(0, 15).join('\n- ') + (walkHints.length > 15 ? '\n(외 ' + (walkHints.length - 15) + '건)' : '');
  const hints = orderHints_(rows);
  if (hints.length) msg += '\n\n순서 제안 (직선거리 기준, 적용은 순서 칸 직접 수정):\n- ' + hints.join('\n- ');
  if (errors.length) msg += '\n\n확인 필요:\n- ' + errors.slice(0, 15).join('\n- ') + (errors.length > 15 ? '\n(외 ' + (errors.length - 15) + '건)' : '');
  invalidateCache_();
  alert_(msg);
}

// 일자·순서대로 값 열만 다시 씀. 좌표 칸(시작·종착)의 자동 표시(배경색·노트)도 같이 옮김
function sortPlanRows_(plan, lastRow, ssTz) {
  const n = lastRow - 1;
  if (n < 2) return;
  const range = plan.getRange(2, 1, n, PLAN_HEADERS.length);
  const vals = range.getValues();
  const disp = range.getDisplayValues();
  const keyed = vals.map((v, i) => ({
    i: i,
    date: parseDateStr_(v[P.DATE - 1], disp[i][P.DATE - 1], ssTz) || '9999-99-99',
    order: Number(v[P.ORDER - 1]) || 0,
  }));
  const sorted = keyed.slice().sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order - b.order) || (a.i - b.i));
  if (sorted.every((x, k) => x.i === k)) return;

  PLAN_VALUE_KEYS.forEach(k => {
    const c = P[k];
    plan.getRange(2, c, n, 1).setValues(sorted.map(x => [vals[x.i][c - 1]]));
  });
  [P.COORD, P.END_COORD].forEach(c => {
    const cell = plan.getRange(2, c, n, 1);
    const bgs = cell.getBackgrounds();
    const notes = cell.getNotes();
    cell.setBackgrounds(sorted.map(x => bgs[x.i]));
    cell.setNotes(sorted.map(x => notes[x.i]));
  });
}

// pref: 주유패스 날이면 { re } — 대중교통 후보 중 패스 전철 경로 우선
function computeSegment_(date, departMin, from, to, cache, errors, quick, pref) {
  const mode = from.mode;
  const base = { minutes: 0, summary: '', transfers: '', polyline: '', fare: '', link: mapsLink_(from, to, mode), key: '', cached: false, calcAt: '' };

  if (!mode) {
    errors.push(date + ' ' + from.place + ' → ' + to.place + ': 다음 이동수단이 비어 있음');
    return Object.assign(base, { summary: '이동수단 미지정' });
  }
  if (mode === '수동') {
    // 시간·요금은 수동 값 그대로. 지도에 그릴 선 모양만 구글 경로에서 빌려옴 (300km 넘는 비행 구간 등은 웹앱에서 곡선으로)
    // 메모에 [노선:난카이] 처럼 적으면 그 노선을 지나는 경로 모양을 우선 고름
    const res = Object.assign(base, { minutes: from.manual, summary: '수동 입력 ' + from.manual + '분' });
    if (from.lat != null && to.lat != null && distanceM_(from.lat, from.lng, to.lat, to.lng) < 300000) {
      const pm = String(from.memo || '').match(/\[노선\s*:\s*([^\]]+)\]/);
      const prefer = pm ? pm[1].trim() : '';
      const key = ['shape', from.lat, from.lng, to.lat, to.lng, prefer].join('|');
      const hit = cache[key];
      let shape;
      if (hit && hit.polyline) {
        shape = { poly: hit.polyline, line: String(hit.summary || '').split(' · 모양: ')[1] || '' };
      } else {
        shape = fetchShape_(date, departMin, from, to, prefer);   // 전에 못 받았으면(빈 값) 다시 시도
        Utilities.sleep(CONFIG.SLEEP_MS);
        if (prefer && shape.poly && !shape.matched) errors.push(date + ' ' + from.place + ' → ' + to.place + ': [노선:' + prefer + ']을 지나는 경로를 못 찾아서 다른 경로 모양을 씀');
      }
      res.polyline = shape.poly || '';
      if (shape.line) res.summary += ' · 모양: ' + shape.line;
      res.key = key;
    }
    return res;
  }

  if (from.lat == null || to.lat == null) {
    return Object.assign(base, { summary: '좌표 없음, 계산 불가' });
  }

  // 패스 우선으로 고른 결과는 캐시 키를 따로 (패스 설정 전 버스 경로 캐시를 안 쓰게)
  const key = [from.lat, from.lng, to.lat, to.lng, mode, date, departMin].join('|') + (pref && mode === '대중교통' ? '|pass' : '');
  let res;
  const hit = cache[key];
  // 대중교통인데 단계 정보가 없거나, 탑승 단계에 회사 이름(ag)이 없는 예전 캐시는 다시 조회 (점검 결과는 그대로 씀)
  const stale = mode === '대중교통' && hit &&
    (!hit.steps || (hit.steps.indexOf('"t":"transit"') !== -1 && hit.steps.indexOf('"ag"') === -1));
  if (hit && !stale) {
    res = Object.assign(base, hit, { key: key, cached: true });
  } else {
    const got = fetchDirections_(date, departMin, from, to, mode, pref);
    Utilities.sleep(CONFIG.SLEEP_MS);
    if (!got) {
      errors.push(date + ' ' + from.place + ' → ' + to.place + ': 경로를 못 찾음 (' + mode + ')');
      return Object.assign(base, { summary: '경로 못 찾음' });
    }
    res = Object.assign(base, got, { key: key });
    if (hit && hit.warn) res.warn = hit.warn;
  }
  // 대중교통은 늦게 출발해도 버티는지 점검 (예전 캐시처럼 점검 결과가 비어 있을 때만 조회, 웹앱 조정 중엔 생략)
  if (mode === '대중교통' && !res.warn && !quick) res.warn = lateCheck_(date, departMin, from, to, res, pref);
  // 가까운 대중교통 구간은 걸어가면 몇 분인지도 확인 (한 번 확인하면 캐시)
  if (mode === '대중교통' && (res.walk === '' || res.walk == null) && hit && hit.walk !== '' && hit.walk != null) res.walk = hit.walk;
  if (mode === '대중교통' && (res.walk === '' || res.walk == null) && !quick) res.walk = walkCheck_(date, departMin, from, to, res);
  // 오래 걸리는 가까운 대중교통 구간은 차로 가면 몇 분인지도 확인 (택시 비교, 한 번 확인하면 캐시)
  if (mode === '대중교통' && (res.taxi === '' || res.taxi == null) && hit && hit.taxi) res.taxi = hit.taxi;
  if (mode === '대중교통' && (res.taxi === '' || res.taxi == null) && !quick) res.taxi = taxiCheck_(date, departMin, from, to, res);
  // 탑승 단계에 일본어 이름(노선·역·방면) 붙이기. 한 번 붙이면 캐시 (웹앱 조정 중엔 생략)
  if (mode === '대중교통' && !quick && res.steps && res.steps.indexOf('"t":"transit"') !== -1 && res.steps.indexOf('"jfrom"') === -1) {
    res.steps = enrichJa_(res.steps, date, departMin, from, to);
  }
  // 차 구간은 자기 결과가 곧 택시 정보 (택시로 가기 구간 요금 계산용)
  if (mode === '차' && !res.taxi && res.meters) res.taxi = res.minutes + '|' + res.meters + (res.traffic ? '|' + res.traffic : '');
  return res;
}

// 차로 가면 "분|미터|정체 반영 분" (대상 아니면 '-')
function taxiCheck_(date, departMin, from, to, res) {
  if (res.minutes < CONFIG.TAXI_CHECK_MIN_TRANSIT) return '-';
  if (distanceM_(from.lat, from.lng, to.lat, to.lng) > CONFIG.TAXI_CHECK_M) return '-';
  const c = fetchDirections_(date, departMin, from, to, '차');
  Utilities.sleep(CONFIG.SLEEP_MS);
  return c && c.meters ? c.minutes + '|' + c.meters + (c.traffic ? '|' + c.traffic : '') : '-';
}

// 걸어가면 몇 분 (직선 WALK_CHECK_M 넘으면 '-')
function walkCheck_(date, departMin, from, to, res) {
  if (String(res.summary || '').indexOf('도보만') !== -1) return '-';
  if (distanceM_(from.lat, from.lng, to.lat, to.lng) > CONFIG.WALK_CHECK_M) return '-';
  const w = fetchDirections_(date, departMin, from, to, '도보');
  Utilities.sleep(CONFIG.SLEEP_MS);
  return w ? w.minutes : '-';
}

// 도보 추천 문구. 대중교통 구간인데 걸어서 WALK_HINT_MIN분 이하이거나 대중교통보다 빠르면
function walkHint_(mode, transitMin, walk, summary) {
  if (mode !== '대중교통') return '';
  const w = Number(walk);
  if (walk === '' || walk == null || walk === '-' || isNaN(w)) return '';
  if (String(summary || '').indexOf('도보만') !== -1) return '';
  if (w <= CONFIG.WALK_HINT_MIN || w <= transitMin) return '걸어서 ' + w + '분 (대중교통 ' + transitMin + '분)';
  return '';
}

// 몇 분 늦게 출발했을 때 소요가 크게 늘면 배차가 드문 노선(하루 몇 번 버스 등)에 기댄 경로
function lateCheck_(date, departMin, from, to, res, pref) {
  if (String(res.summary || '').indexOf('도보만') !== -1) return 'OK';
  const late = fetchDirections_(date, departMin + CONFIG.LATE_CHECK_MIN, from, to, '대중교통', pref);
  Utilities.sleep(CONFIG.SLEEP_MS);
  if (!late) return departMin + CONFIG.LATE_CHECK_MIN >= CONFIG.LAST_TRAIN_FROM - 60
    ? '막차 가능성: ' + CONFIG.LATE_CHECK_MIN + '분 늦게 출발하면 경로 없음' : 'OK';
  const more = late.minutes - res.minutes;
  if (more < CONFIG.LATE_WARN_MIN) return 'OK';
  return '배차 드묾: ' + CONFIG.LATE_CHECK_MIN + '분 늦게 출발하면 도착 +' + (more + CONFIG.LATE_CHECK_MIN) + '분 (소요 ' + late.minutes + '분)';
}

/* ── 주유패스: 구간의 탑승 단계가 패스 노선인지 ── */

// 'all' = 탑승 단계 전부 패스 노선 / 'some' = 일부만 / '' = 해당 없음(탑승 없음 포함)
function passCoverage_(stepsJson, re) {
  let list;
  try { list = JSON.parse(stepsJson); } catch (e) { return ''; }
  const rides = (list || []).filter(s => s.t === 'transit');
  if (!rides.length) return '';
  const ok = rides.filter(s => re.test([s.line, s.full, s.ag].filter(Boolean).join(' ')));
  if (ok.length === rides.length) return 'all';
  return ok.length ? 'some' : '';
}

/* ── 이동 시간 올림 단위 (수단별) ── */

// 수단별 이동 올림 단위 (분). CONFIG.ROUND_MOVE에 없으면 ROUND_MIN
function moveStep_(mode) {
  const t = CONFIG.ROUND_MOVE || {};
  const v = Object.prototype.hasOwnProperty.call(t, mode) ? t[mode] : CONFIG.ROUND_MIN;
  return Math.max(1, Math.round(Number(v) || 1));
}

// 시트 함수용: 윗행 이동수단 칸(modeRef)에 따라 올림 단위를 고르는 식
//  예) SWITCH($G5,"대중교통",10,"차",10,"도보",5,"수동",5,5)
function moveStepFormula_(modeRef) {
  const t = CONFIG.ROUND_MOVE || {};
  const parts = Object.keys(t).map(k => '"' + k + '",' + moveStep_(k));
  if (!parts.length) return String(roundStep_());
  return 'SWITCH(' + modeRef + ',' + parts.join(',') + ',' + roundStep_() + ')';
}

/* ── 장소 안 시작점→종착점 도보 (시장·상점가 관통 등) ── */

// 저장 위치: 스크립트 속성 "iw|시작lat,lng|종착lat,lng" = "분|미터"
let INNER_WALK_MEMO_ = null;
function innerWalkStore_() {
  if (!INNER_WALK_MEMO_) {
    try { INNER_WALK_MEMO_ = PropertiesService.getScriptProperties().getProperties(); } catch (e) { INNER_WALK_MEMO_ = {}; }
  }
  return INNER_WALK_MEMO_;
}

// 시작점→종착점 걷는 시간·거리 { min, m, est } (종착점 없거나 시작점과 같으면 null)
//  저장된 도보 경로가 있으면 그 값 (est: false)
//  fetch = true면 없을 때 구글 도보 경로를 받아 저장 (경로 계산 때만)
//  그래도 없으면 직선거리 × INNER_WALK_DETOUR, INNER_WALK_M_PER_MIN 속도로 어림 (est: true)
function innerWalk_(r, fetch) {
  if (!r || r.lat == null || r.lng == null || r.endLat == null || r.endLng == null) return null;
  if (r.lat === r.endLat && r.lng === r.endLng) return null;
  const f = v => Number(v).toFixed(5);
  const key = 'iw|' + f(r.lat) + ',' + f(r.lng) + '|' + f(r.endLat) + ',' + f(r.endLng);
  const store = innerWalkStore_();
  const parse = s => {
    const mm = String(s || '').match(/^(\d+)\|(\d+)$/);
    return mm ? { min: Number(mm[1]), m: Number(mm[2]), est: false } : null;
  };
  const hit = parse(store[key]);
  if (hit) return hit;
  if (fetch) {
    try {
      const out = Maps.newDirectionFinder()
        .setOrigin(r.lat, r.lng).setDestination(r.endLat, r.endLng)
        .setMode(Maps.DirectionFinder.Mode.WALKING).setLanguage('ko').getDirections();
      Utilities.sleep(CONFIG.SLEEP_MS);
      const leg = out && out.status === 'OK' && out.routes && out.routes[0] ? out.routes[0].legs[0] : null;
      if (leg && leg.duration && leg.distance) {
        const val = Math.ceil(leg.duration.value / 60) + '|' + Math.round(leg.distance.value);
        PropertiesService.getScriptProperties().setProperty(key, val);
        store[key] = val;
        return parse(val);
      }
    } catch (e) {
      // 조회 실패하면 어림값
    }
  }
  const m = distanceM_(r.lat, r.lng, r.endLat, r.endLng) * CONFIG.INNER_WALK_DETOUR;
  return { min: Math.max(1, Math.ceil(m / CONFIG.INNER_WALK_M_PER_MIN)), m: Math.round(m), est: true };
}

/* ── 순서 제안: 고정점 사이 장소들 순서를 직선거리로 비교 (API 호출 없음) ── */

// 고정점: 그날 첫·마지막 행, 고정 시각 있는 행, 메모·활동에 [고정]
function orderHints_(rows) {
  const out = [];
  groupByDate_(rows).forEach(g => {
    const list = g.rows;
    const anchor = (r, i) => i === 0 || i === list.length - 1 || r.fixed != null || /\[고정\]/.test(r.memo + ' ' + r.activity);
    let i = 0;
    while (i < list.length - 1) {
      let j = i + 1;
      while (!anchor(list[j], j)) j++;
      const free = list.slice(i + 1, j);
      const hint = bestOrder_(list[i], free, list[j]);
      if (hint) {
        out.push(g.date.slice(5).replace('-', '/') + ' ' + free[0].order + '~' + free[free.length - 1].order + '번: ' +
          hint.order.map(r => r.order).join('→') + ' 순서로 바꾸면 약 ' + fmtKm_(hint.saved) + ' 줄어듦 (' +
          fmtKm_(hint.cur) + ' → ' + fmtKm_(hint.cur - hint.saved) + ')');
      }
      i = j;
    }
  });
  return out;
}

// left → free(순서 바꿈) → right 직선거리 합이 가장 짧은 순서. 기준 못 넘으면 null
// 각 장소에서 다음으로 떠나는 건 종착점(있으면), 도착은 시작점
function bestOrder_(left, free, right) {
  if (free.length < 2 || free.length > CONFIG.ORDER_HINT_MAX) return null;
  if ([left, right].concat(free).some(r => r.lat == null)) return null;
  if ([left].concat(free).some(r => r.mode === '수동')) return null;   // 비행기 등 수동 구간 낀 곳은 제외
  const d = (a, b) => { const o = departFrom_(a); return distanceM_(o.lat, o.lng, b.lat, b.lng); };
  const total = seq => {
    let s = d(left, seq[0]);
    for (let k = 1; k < seq.length; k++) s += d(seq[k - 1], seq[k]);
    return s + d(seq[seq.length - 1], right);
  };
  const cur = total(free);
  let best = null, bestT = cur;
  permute_(free, p => {
    const t = total(p);
    if (t < bestT - 1) { bestT = t; best = p.slice(); }
  });
  if (!best) return null;
  const saved = cur - bestT;
  if (saved < CONFIG.ORDER_HINT_MIN_M || saved / cur < CONFIG.ORDER_HINT_MIN_RATIO) return null;
  return { order: best, saved: saved, cur: cur };
}

// 모든 순열을 fn에 넘김 (Heap 알고리즘)
function permute_(arr, fn) {
  const a = arr.slice();
  const n = a.length;
  const c = new Array(n).fill(0);
  fn(a);
  let i = 1;
  while (i < n) {
    if (c[i] < i) {
      const k = i % 2 ? c[i] : 0;
      const t = a[k]; a[k] = a[i]; a[i] = t;
      fn(a);
      c[i]++;
      i = 1;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

function fmtKm_(m) { return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m) + 'm'; }

// 선 모양만 필요할 때: 그 시각(먼 미래면 같은 요일 근사) 대중교통 경로 여러 개 중 고름 → 없으면 자동차
// prefer: 노선 이름 일부 (예: 난카이, 南海, 라피트, JR). 해당 노선이 들어간 경로를 우선
function fetchShape_(date, departMin, from, to, prefer) {
  const re = prefer ? new RegExp(prefer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const lineNames = route => {
    const names = [];
    route.legs[0].steps.forEach(st => {
      if (st.travel_mode === 'TRANSIT' && st.transit_details) {
        const l = st.transit_details.line || {};
        names.push([l.short_name, l.name, l.agencies && l.agencies[0] && l.agencies[0].name].filter(Boolean).join(' '));
      }
    });
    return names;
  };
  const when = [proxyDate_(toDate_(date, departMin)), toDate_(date, departMin)];
  for (let i = 0; i < when.length; i++) {
    try {
      const out = Maps.newDirectionFinder().setOrigin(from.lat, from.lng).setDestination(to.lat, to.lng)
        .setMode(Maps.DirectionFinder.Mode.TRANSIT).setDepart(when[i]).setAlternatives(true).setLanguage('ko').getDirections();
      if (!out || out.status !== 'OK' || !out.routes || !out.routes.length) continue;
      let pick = out.routes[0], matched = false;
      if (re) {
        const m = out.routes.find(r => lineNames(r).some(n => re.test(n)));
        if (m) { pick = m; matched = true; }
      }
      if (pick.overview_polyline) return { poly: pick.overview_polyline.points, line: lineNames(pick).join(' → '), matched: matched || !re };
    } catch (e) {
      // 다음 시각으로
    }
  }
  try {
    const out = Maps.newDirectionFinder().setOrigin(from.lat, from.lng).setDestination(to.lat, to.lng)
      .setMode(Maps.DirectionFinder.Mode.DRIVING).getDirections();
    if (out && out.status === 'OK' && out.routes && out.routes.length && out.routes[0].overview_polyline) {
      return { poly: out.routes[0].overview_polyline.points, line: '도로', matched: !re };
    }
  } catch (e) { /* 모양 없음 */ }
  return { poly: '', line: '', matched: false };
}

function fetchDirections_(date, departMin, from, to, mode, pref) {
  const target = toDate_(date, departMin);
  const candidates = [{ when: target, approx: false }];
  // 먼 미래 날짜는 시간표가 없어서 실패할 수 있음 → 같은 요일·같은 시각으로 재시도
  if (mode === '대중교통') candidates.push({ when: proxyDate_(target), approx: true });

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const finder = Maps.newDirectionFinder()
        .setOrigin(from.lat, from.lng)
        .setDestination(to.lat, to.lng)
        .setMode(MODE_MAP[mode])
        .setLanguage('ko');
      if (mode !== '도보') finder.setDepart(c.when);
      const usePref = !!pref && mode === '대중교통';
      if (usePref) finder.setAlternatives(true);   // 후보 여러 개 받아서 패스 전철 경로 고름
      const out = finder.getDirections();
      if (out && out.status === 'OK' && out.routes && out.routes.length) {
        return usePref ? pickPassRoute_(out.routes, c.when, mode, c.approx, pref)
                       : parseRoute_(out.routes[0], c.when, mode, c.approx);
      }
    } catch (e) {
      // 다음 후보로
    }
  }
  return null;
}

// 주유패스 날 후보 고르기
//  등급: 0 = 탑승이 전부 패스 노선 + 버스 없음 / 1 = 전부 패스 노선(버스 포함) / 2 = 일부 패스 / 3 = 해당 없음
//  가장 빠른 후보 + PASS_PREFER_MAX_EXTRA분 안에서 등급 낮은 것 → 같은 등급이면 빠른 것
//  가장 빠른 후보가 아닌 걸 골랐으면 passExtra(늦어진 분)를 붙여서 돌려줌
function pickPassRoute_(routes, when, mode, approx, pref) {
  const isBus = st => /버스|bus|バス/i.test(String(st.vehicle || ''));
  const cands = routes.map(r => {
    const p = parseRoute_(r, when, mode, approx);
    let list = [];
    try { list = JSON.parse(p.steps || '[]'); } catch (e) { list = []; }
    const rides = list.filter(st => st.t === 'transit');
    const cov = passCoverage_(p.steps || '', pref.re);
    p.tier = cov === 'all' ? (rides.some(isBus) ? 1 : 0) : cov === 'some' ? 2 : (rides.length ? 3 : 0);   // 도보만이면 0원이라 0등급
    return p;
  });
  const fastest = cands.reduce((a, b) => b.minutes < a.minutes ? b : a);
  const ok = cands.filter(c => c.minutes <= fastest.minutes + CONFIG.PASS_PREFER_MAX_EXTRA);
  ok.sort((a, b) => (a.tier - b.tier) || (a.minutes - b.minutes));
  const pick = ok[0];
  if (pick !== fastest) pick.passExtra = pick.minutes - fastest.minutes;
  delete pick.tier;
  return pick;
}

function parseRoute_(route, when, mode, approx) {
  const leg = route.legs[0];
  let seconds = leg.duration.value;
  // 차는 출발 시각 기준 정체 반영 시간이 있으면 그걸로 (택시로 가기 구간 도착 시각이 현실적이게)
  if (mode === '차' && leg.duration_in_traffic && leg.duration_in_traffic.value) seconds = leg.duration_in_traffic.value;

  // 대중교통은 요청 시각부터 실제 도착까지 (첫 차 기다리는 시간 포함)
  if (leg.arrival_time && leg.arrival_time.value) {
    const arrMs = Number(leg.arrival_time.value) * 1000;
    const diff = Math.round((arrMs - when.getTime()) / 1000);
    if (diff > 0 && diff < 24 * 3600) seconds = diff;
  }
  const minutes = Math.ceil(seconds / 60);

  let summary;
  let transfers = '';
  if (mode === '대중교통') {
    const parts = [];
    let transitCount = 0;
    leg.steps.forEach(s => {
      if (s.travel_mode === 'TRANSIT' && s.transit_details) {
        transitCount++;
        const t = s.transit_details;
        const line = t.line || {};
        const name = line.short_name || line.name || '대중교통';
        parts.push(name + ' ' + t.departure_stop.name + '→' + t.arrival_stop.name + ' (' + t.num_stops + '정거장)');
      } else {
        const m = Math.round(s.duration.value / 60);
        if (m > 0) parts.push((s.travel_mode === 'WALKING' ? '도보 ' : '') + m + '분');
      }
    });
    summary = parts.join(' → ');
    transfers = Math.max(transitCount - 1, 0);
    if (transitCount === 0) summary = '도보만 (' + leg.distance.text + ')';
  } else {
    summary = mode + ' ' + leg.distance.text;
  }
  if (approx) summary = '[같은 요일 시간표 기준] ' + summary;

  // 요금: 구글이 알려주는 경우만 (1인, 엔화). 도보는 0
  let fare = '';
  if (route.fare && route.fare.value != null && (!route.fare.currency || route.fare.currency === 'JPY')) {
    fare = Math.round(Number(route.fare.value));
  } else if (mode === '도보' || (mode === '대중교통' && summary.indexOf('도보만') === 0)) {
    fare = 0;
  }

  return {
    minutes: minutes,
    summary: summary,
    transfers: transfers,
    polyline: route.overview_polyline ? route.overview_polyline.points : '',
    fare: fare,
    meters: leg.distance ? leg.distance.value : '',   // 택시 요금 어림용
    traffic: leg.duration_in_traffic ? Math.ceil(leg.duration_in_traffic.value / 60) : '',   // 차: 정체 반영 소요(분)
    steps: mode === '대중교통' ? stepsJson_(leg) : '',
  };
}

// 대중교통 단계: 도보 / 승차역·시각·노선·방면·정거장 수·하차역·시각 + 단계별 선 모양
// 셀 한 칸 5만 자 제한이라 너무 길면 선 모양은 빼고 저장 (웹앱은 전체 선으로 대신 그림)
// 같은 경로를 일본어로 한 번 더 받아서 탑승 단계마다 jline(노선)·jfrom(승차역)·jto(하차역)·jhead(방면)
//  한국어 결과와 탑승 시각 순서가 같은 후보를 고름 (없으면 탑승 수·정거장 수가 같은 후보)
//  못 찾으면 빈 값으로 채워서 다시 조회하지 않게 함
function enrichJa_(stepsJson, date, departMin, from, to) {
  let list;
  try { list = JSON.parse(stepsJson || '[]'); } catch (e) { return stepsJson; }
  const rides = list.filter(s => s.t === 'transit');
  if (!rides.length) return stepsJson;
  const hm = v => v ? Utilities.formatDate(new Date(Number(v) * 1000), CONFIG.TRIP_TZ, 'HH:mm') : '';
  const deps = rides.map(s => s.dep || '').join(',');
  const target = toDate_(date, departMin);
  let match = null;
  [target, proxyDate_(target)].some(when => {
    try {
      const out = Maps.newDirectionFinder().setOrigin(from.lat, from.lng).setDestination(to.lat, to.lng)
        .setMode(Maps.DirectionFinder.Mode.TRANSIT).setDepart(when).setAlternatives(true).setLanguage('ja').getDirections();
      Utilities.sleep(CONFIG.SLEEP_MS);
      if (!out || out.status !== 'OK' || !out.routes) return false;
      const cands = out.routes.map(r => r.legs[0].steps.filter(st => st.travel_mode === 'TRANSIT' && st.transit_details));
      match = cands.find(ts => ts.length === rides.length &&
          ts.map(st => hm(st.transit_details.departure_time && st.transit_details.departure_time.value)).join(',') === deps) ||
        cands.find(ts => ts.length === rides.length &&
          ts.every((st, i) => (st.transit_details.num_stops || 0) === (rides[i].stops || 0))) || null;
      return !!match;
    } catch (e) {
      return false;
    }
  });
  rides.forEach((s, i) => {
    const t = match ? match[i].transit_details : null;
    const line = (t && t.line) || {};
    s.jline = t ? (line.short_name || line.name || '') : '';
    s.jfrom = t && t.departure_stop ? t.departure_stop.name : '';
    s.jto = t && t.arrival_stop ? t.arrival_stop.name : '';
    s.jhead = t ? (t.headsign || '') : '';
  });
  let json = JSON.stringify(list);
  if (json.length > 45000) json = JSON.stringify(list.map(x => Object.assign({}, x, { poly: '' })));
  return json;
}

function stepsJson_(leg) {
  const hm = v => v ? Utilities.formatDate(new Date(Number(v) * 1000), CONFIG.TRIP_TZ, 'HH:mm') : '';
  const ll = loc => loc && loc.lat != null ? [Math.round(loc.lat * 1e6) / 1e6, Math.round(loc.lng * 1e6) / 1e6] : null;
  const list = (leg.steps || []).map(s => {
    const min = Math.round(((s.duration && s.duration.value) || 0) / 60);
    const poly = s.polyline ? s.polyline.points : '';
    if (s.travel_mode === 'TRANSIT' && s.transit_details) {
      const t = s.transit_details;
      const line = t.line || {};
      return {
        t: 'transit',
        line: line.short_name || line.name || '대중교통',
        full: line.name || '',
        ag: (line.agencies && line.agencies[0] && line.agencies[0].name) || '',   // 운영 회사 (패스 판단용)
        color: line.color || '',
        vehicle: (line.vehicle && line.vehicle.name) || '',
        head: t.headsign || '',
        from: t.departure_stop ? t.departure_stop.name : '',
        fromLL: t.departure_stop ? ll(t.departure_stop.location) : null,
        dep: hm(t.departure_time && t.departure_time.value),
        to: t.arrival_stop ? t.arrival_stop.name : '',
        toLL: t.arrival_stop ? ll(t.arrival_stop.location) : null,
        arr: hm(t.arrival_time && t.arrival_time.value),
        stops: t.num_stops || 0,
        min: min,
        poly: poly,
      };
    }
    return { t: s.travel_mode === 'WALKING' ? 'walk' : 'other', min: min, m: (s.distance && s.distance.value) || 0, poly: poly };
  });
  let json = JSON.stringify(list);
  if (json.length > 45000) json = JSON.stringify(list.map(x => Object.assign({}, x, { poly: '' })));
  return json;
}

function loadRouteCache_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return {};
  const vals = sh.getRange(2, 1, last - 1, ROUTE_HEADERS.length).getValues();
  const disp = sh.getRange(2, 1, last - 1, ROUTE_HEADERS.length).getDisplayValues();
  const cache = {};
  vals.forEach((v, i) => {
    const key = v[R.KEY - 1];
    if (!key) return;
    cache[key] = {
      minutes: Number(v[R.MIN - 1]) || 0,
      summary: v[R.SUMMARY - 1],
      transfers: v[R.TRANSFER - 1],
      polyline: v[R.POLY - 1],
      fare: v[R.FARE - 1],
      calcAt: disp[i][R.CALC - 1],
      warn: String(v[R.WARN - 1] || ''),
      steps: String(v[R.STEPS - 1] || ''),
      walk: v[R.WALK - 1] === '' || v[R.WALK - 1] == null ? '' : v[R.WALK - 1],
      taxi: String(v[R.TAXI - 1] || ''),
    };
  });
  return cache;
}