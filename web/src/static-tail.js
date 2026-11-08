/* 홈랩 정적 페이지 전용 뒷부분. build.mjs가 화면 코드(App_*) 다 끼운 뒤, load() 직전에 넣음
 *  화면 코드의 전역 함수(renderWho, applyData, distanceCard …)를 감싸서 기능을 덧붙임. Apps Script 웹앱은 영향 없음
 *  1. 서비스 워커 등록 + 새 버전 알림줄
 *  2. 저장 공간 유지 요청 (navigator.storage.persist)
 *  3. 장소 사진을 홈랩 프록시(/api/photo) 경유로 → 오프라인에서도 보임
 *  4. 사용자 선택 화면 아래 "이 기기" 패널: 설치·저장 공간·사진 미리 받기·출발 알림·도착 제안
 *  5. 위치: 권한 있으면 자동으로 켬, 다음 장소 거리·도착 예상, 지도·타임라인 아래 다음 장소 칩
 *  6. 도착 자동 제안 (앱 열려 있을 때만. 웹은 백그라운드 위치 불가)
 *  7. 출발 N분 전 푸시 (Web Push, iOS는 홈 화면에 추가한 뒤만) */
(function () {
  'use strict';
  const CFG = window.TRIP_CFG || {};
  const API = window.TRIP_API_URL || '/api';
  const PHOTO_CACHE = 'trip-photos-v1';   // sw.js와 같은 이름
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 무시 */ } },
  };
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  /* ── 스타일 ── */
  const css = document.createElement('style');
  css.textContent = `
  .dev { margin-top: 28px; }
  .dev h3 { font-size: 15px; margin: 0 0 2px; }
  .dev .hcard p { margin: 4px 0; font-size: 13px; color: var(--muted); line-height: 1.55; }
  .dev .hcard p b { color: var(--ink); }
  .dev .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
  .dev select { font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 10px; padding: 7px 10px; background: var(--panel); color: var(--ink); }
  .dev .bar { height: 6px; border-radius: 3px; background: var(--rule); overflow: hidden; margin-top: 8px; }
  .dev .bar i { display: block; height: 100%; width: 0; background: var(--ink); transition: width .2s; }
  .dev .ok { color: #13945f !important; }
  .dev .warn-t { color: #c2410c !important; }
  .dev label.sw { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; }
  .dev label.sw input { width: 18px; height: 18px; accent-color: var(--ink); }
  .float-bar { position: fixed; left: 50%; transform: translateX(-50%); z-index: 2500; display: flex; gap: 8px; align-items: center;
    max-width: calc(100vw - 24px); padding: 10px 12px 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.4;
    background: var(--ink); color: var(--panel); box-shadow: 0 8px 26px rgba(0,0,0,.28); }
  .float-bar button { font: inherit; font-size: 13px; font-weight: 700; border: 0; border-radius: 9px; padding: 6px 11px; cursor: pointer;
    background: var(--panel); color: var(--ink); white-space: nowrap; }
  .float-bar button.ghost { background: transparent; color: var(--panel); border: 1px solid color-mix(in srgb, var(--panel) 40%, transparent); }
  #swUpdate { top: calc(10px + env(safe-area-inset-top, 0px)); }
  #geoAsk { bottom: calc(76px + env(safe-area-inset-bottom, 0px)); }
  #nextChip { bottom: calc(14px + env(safe-area-inset-bottom, 0px)); left: 12px; transform: none; max-width: calc(100vw - 90px);
    padding: 7px 12px; font-size: 13px; cursor: pointer; background: var(--panel); color: var(--ink); border: 1px solid var(--rule); }
  #nextChip b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40vw; display: inline-block; vertical-align: bottom; }
  #nextChip .k { font-weight: 700; color: var(--muted); }
  .eta-line { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
  .eta-line b { color: var(--ink); }
  .eta-line .late { color: #c2410c; font-weight: 700; }
  .eta-line .early { color: #13945f; font-weight: 700; }
  `;
  document.head.appendChild(css);

  function bar(id) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'float-bar'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    return el;
  }
  function hideBar(id) { const el = document.getElementById(id); if (el) el.remove(); }
  const MB = n => (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + 'MB';

  /* ── 1. 서비스 워커 ── */
  let swReg = null;
  if ('serviceWorker' in navigator) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        swReg = reg;
        const offer = w => {
          const el = bar('swUpdate');
          el.innerHTML = '<span>새 버전 있음</span><button type="button">적용</button><button type="button" class="ghost">나중에</button>';
          el.querySelector('button').onclick = () => { el.remove(); w.postMessage('SKIP_WAITING'); };
          el.querySelector('.ghost').onclick = () => el.remove();
        };
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
        });
        // 오래 켜 둔 폰: 화면 다시 볼 때 새 버전 확인
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => null); });
      }).catch(e => console.warn('서비스 워커 등록 실패', e));
    });
  }

  /* ── 2. 저장 공간 유지 (첫 터치 때 한 번 요청) ── */
  function askPersist() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => false);
  }
  addEventListener('pointerdown', function once() { removeEventListener('pointerdown', once, true); askPersist(); }, true);

  /* ── 3. 사진은 프록시 경유 ── */
  function proxyPhotos(data) {
    (data && data.places || []).forEach(p => {
      if (Array.isArray(p.photos)) p.photos = p.photos.map(u => /^https?:\/\//i.test(u) ? API + '/photo?u=' + encodeURIComponent(u) : u);
    });
  }
  if (CFG.photoProxy !== false) {
    const applyData0 = applyData;
    applyData = function (data, keepView) { proxyPhotos(data); return applyData0(data, keepView); };
  }

  /* ── 4. "이 기기" 패널 (사용자 선택 화면 아래) ── */
  const renderWho0 = renderWho;
  renderWho = function () {
    renderWho0();
    const box = document.getElementById('whoInner');
    if (!box) return;
    const sec = document.createElement('div');
    sec.className = 'dev';
    sec.innerHTML = '<h2 style="font-size:20px;margin:0 0 4px">이 기기</h2><p class="lead">이 폰에만 적용되는 설정</p>' +
      '<div class="hcard" id="devInstall"></div>' +
      '<div class="hcard" id="devOffline"></div>' +
      '<div class="hcard" id="devPush"></div>' +
      '<div class="hcard" id="devGeo"></div>';
    box.appendChild(sec);
    paintInstall(); paintOffline(); paintPush(); paintGeo();
  };

  function paintInstall() {
    const el = document.getElementById('devInstall');
    if (!el) return;
    const st = standalone();
    el.innerHTML = '<h3>설치 · 저장 공간</h3>' +
      '<p>' + (st ? '<b class="ok">홈 화면 앱으로 실행 중</b>' :
        (isIOS ? '사파리 공유 버튼 → <b>홈 화면에 추가</b> 후 그 아이콘으로 열기. 알림·저장 공간 유지에 필요'
               : '브라우저 메뉴 → <b>앱 설치</b>(홈 화면에 추가) 추천')) + '</p>' +
      '<p id="devStore">저장 공간 확인 중…</p>' +
      '<div class="row"><button class="btn" type="button" id="devPersist">저장 공간 유지 요청</button></div>';
    document.getElementById('devPersist').onclick = () => askPersist().then(paintStore);
    paintStore();
  }
  function paintStore() {
    const el = document.getElementById('devStore');
    if (!el || !navigator.storage || !navigator.storage.estimate) { if (el) el.textContent = '이 브라우저는 저장 공간 정보를 안 알려줌'; return; }
    Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]).then(([e, p]) => {
      el.innerHTML = '사용 <b>' + MB(e.usage || 0) + '</b> / 한도 ' + MB(e.quota || 0) + ' · ' +
        (p ? '<b class="ok">유지됨</b> (브라우저가 마음대로 안 지움)' : '<b class="warn-t">유지 안 됨</b>' + (isIOS && !standalone() ? ' (홈 화면에 추가하면 7일 미사용 삭제 대상에서 빠짐)' : ''));
    });
  }

  /* ── 오프라인 준비: 장소 사진 미리 받기 (지도는 OSM이라 대량 저장 안 함, 본 화면만 브라우저가 캐시) ── */
  function photoList() {
    if (!DATA) return [];
    const out = new Set();
    (DATA.places || []).forEach(p => (p.photos || []).forEach(u => { if (u.indexOf(API + '/photo') === 0) out.add(location.origin + u); }));
    return Array.from(out);
  }

  let prep = null;   // 진행 중 { stop, done, total, fail }
  function paintOffline() {
    const el = document.getElementById('devOffline');
    if (!el) return;
    if (!DATA) { el.innerHTML = '<h3>오프라인 준비</h3><p>일정 불러온 뒤 가능</p>'; return; }
    const photos = photoList();
    el.innerHTML = '<h3>오프라인 준비</h3>' +
      '<p>장소 사진 <b>' + photos.length + '장</b> 미리 받기. 일정 데이터는 열 때마다 자동 저장</p>' +
      '<p>지도 배경은 인터넷 필요 (한 번 본 곳은 잠깐 남아 있을 수 있음)</p>' +
      '<div class="bar"><i id="prepBar"></i></div><p id="prepMsg"></p>' +
      '<div class="row"><button class="btn primary" type="button" id="prepGo">' + (prep ? '멈추기' : '받기') + '</button></div>';
    document.getElementById('prepGo').onclick = () => { if (prep) prep.stop = true; else runPrep(photos); };
    if (prep) paintPrep();
  }
  function paintPrep() {
    const b = document.getElementById('prepBar'), m = document.getElementById('prepMsg');
    if (!b || !prep) return;
    b.style.width = (prep.total ? Math.round(prep.done / prep.total * 100) : 0) + '%';
    m.textContent = prep.done + ' / ' + prep.total + (prep.fail ? ' · 실패 ' + prep.fail : '');
  }
  async function runPrep(photos) {
    askPersist();
    prep = { stop: false, done: 0, total: photos.length, fail: 0 };
    paintOffline();
    const c = await caches.open(PHOTO_CACHE);
    let i = 0;
    async function worker() {
      while (i < photos.length && !prep.stop) {
        const u = photos[i++];
        try {
          if (!(await c.match(u))) {
            const r = await fetch(u);
            if (r.ok) await c.put(u, r); else prep.fail++;
          }
        } catch (e) { prep.fail++; }
        prep.done++;
        paintPrep();
      }
    }
    await Promise.all([1, 2, 3, 4].map(worker));
    const stopped = prep.stop, fail = prep.fail;
    prep = null;
    paintOffline();
    paintStore();
    showToast(stopped ? '오프라인 준비 멈춤' : '사진 받기 끝' + (fail ? ' (실패 ' + fail + '건, 다시 누르면 실패한 것만 받음)' : ''));
  }

  /* ── 7. 출발 알림 (Web Push) ── */
  const PUSH_KEY = 'trip-push-v1';
  function pushState() { try { return JSON.parse(LS.get(PUSH_KEY, 'null')); } catch (e) { return null; } }
  function b64ToU8(b64) {
    const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  async function postJSON(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!j || !j.ok) throw new Error((j && j.error) || '서버 오류 ' + r.status);
    return j.result;
  }
  function paintPush() {
    const el = document.getElementById('devPush');
    if (!el) return;
    const st = pushState();
    const can = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    let why = '';
    if (!can) why = isIOS && !standalone() ? '아이폰은 홈 화면에 추가한 아이콘으로 열어야 알림 가능 (iOS 16.4 이상)' : '이 브라우저는 푸시 알림 미지원';
    else if (!USER) why = '먼저 위에서 사용자 고르기';
    else if (Notification.permission === 'denied') why = '알림 권한이 막혀 있음. 설정에서 이 사이트 알림 허용 필요';
    const lead = st ? st.lead : 15;
    el.innerHTML = '<h3>출발 알림</h3>' +
      '<p>다음 장소로 출발할 시각 몇 분 전에 알림. 도착 기록으로 늦어진 만큼 알림도 밀림</p>' +
      (why ? '<p class="warn-t">' + esc(why) + '</p>' :
        '<p>' + (st ? '<b class="ok">켜짐</b> · ' + esc(st.user) + ' 일정 기준 · ' + st.lead + '분 전' : '꺼짐') + '</p>' +
        '<div class="row"><select id="pushLead" aria-label="몇 분 전">' + [5, 10, 15, 20, 30].map(n =>
          '<option value="' + n + '"' + (n === lead ? ' selected' : '') + '>' + n + '분 전</option>').join('') + '</select>' +
        '<button class="btn primary" type="button" id="pushOn">' + (st ? '설정 저장' : '켜기') + '</button>' +
        (st ? '<button class="btn" type="button" id="pushTest">시험 알림</button><button class="btn" type="button" id="pushOff">끄기</button>' : '') + '</div>');
    const on = document.getElementById('pushOn');
    if (on) on.onclick = () => pushOn(Number(document.getElementById('pushLead').value)).then(paintPush, e => { showToast('알림 켜기 실패: ' + e.message); paintPush(); });
    const off = document.getElementById('pushOff');
    if (off) off.onclick = () => pushOff().then(paintPush, e => showToast('끄기 실패: ' + e.message));
    const test = document.getElementById('pushTest');
    if (test) test.onclick = () => pushTest().then(() => showToast('시험 알림 보냄'), e => showToast('시험 알림 실패: ' + e.message));
  }
  async function pushReg() {
    const reg = swReg || await navigator.serviceWorker.ready;
    return reg;
  }
  async function pushOn(lead) {
    // 권한 요청은 버튼 누른 직후에 바로 해야 iOS가 받아줌
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('알림 권한 거부됨');
    const r = await fetch(API + '/push/key');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '서버에 알림 키가 없음');
    const reg = await pushReg();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(j.result.key) });
    await postJSON('/push/subscribe', { sub: sub.toJSON(), user: USER.id, pin: getPin(USER.id), lead: lead });
    LS.set(PUSH_KEY, JSON.stringify({ user: USER.id, lead: lead, endpoint: sub.endpoint }));
    showToast('출발 ' + lead + '분 전 알림 켬');
  }
  async function pushOff() {
    const reg = await pushReg();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await postJSON('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => null);
      await sub.unsubscribe().catch(() => null);
    }
    LS.set(PUSH_KEY, null);
    showToast('출발 알림 끔');
  }
  async function pushTest() {
    const reg = await pushReg();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) throw new Error('구독 없음. 다시 켜기');
    await postJSON('/push/test', { endpoint: sub.endpoint });
  }

  /* ── 5. 위치 ── */
  const GEO_KEY = 'trip-geo-ask';    // 도착 제안 켬/끔 ('0'이면 끔)
  let lastPos = null, lastHomeRender = 0, lastHomePos = null, geoWatch = null;

  function startWatch() {
    if (!navigator.geolocation || geoWatch != null) return;
    geoWatch = navigator.geolocation.watchPosition(onPos, err => {
      geoWatch = null;
      homeWatch = null;
      if (err.code === 1) setStatus('위치 권한이 막혀 있음. 브라우저 설정에서 이 사이트 위치 허용', true);
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    homeWatch = geoWatch;   // 홈 화면 "내 위치로 거리 보기"가 또 켜지 않게
  }
  // 홈 화면 버튼도 이 감시를 쓰게
  startHomeLocation = startWatch;

  // 이미 허용된 기기면 열자마자 켬 (권한 창은 안 뜸)
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') startWatch(); }).catch(() => null);
  }

  function onPos(pos) {
    const c = pos.coords;
    lastPos = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: Date.now() };
    myPos = [c.latitude, c.longitude];
    const now = Date.now();
    const moved = lastHomePos ? haversine(lastHomePos, myPos) : Infinity;
    if (currentView === 'home' && DATA && (moved > 20 || now - lastHomeRender > 30000)) {
      lastHomeRender = now; lastHomePos = myPos;
      try { renderHomeBody(); } catch (e) { /* 다음 갱신 때 */ }
    }
    paintChip();
    geofence();
  }

  // 다음 장소 카드에 도착 예상 한 줄
  function etaLine(target) {
    if (!target || target.lat == null) return '';
    const nt = tokyoNow();
    if (target.date !== nt.date) return '';
    const plan = predictedMin(target) != null ? predictedMin(target) : toMin(target.arrive);
    if (myPos) {
      const d = haversine(myPos, [target.lat, target.lng]);
      if (d <= 2500) {
        const walk = Math.max(1, Math.round(d * 1.3 / 80));
        const eta = nt.min + walk;
        if (plan == null) return '<p class="eta-line">지금 걸어가면 <b>' + hhmm(eta) + '</b> 도착</p>';
        const diff = plan - eta;
        return '<p class="eta-line">지금 걸어가면 <b>' + hhmm(eta) + '</b> 도착 · 계획 ' + hhmm(plan) + ' ' +
          (diff >= 0 ? '<span class="early">' + diff + '분 여유</span>' : '<span class="late">' + (-diff) + '분 늦음</span>') + '</p>';
      }
    }
    // 멀면: 이전 장소 출발 시각 기준
    const prev = DATA.points.filter(p => p.date === target.date && p.order < target.order).sort((a, b) => b.order - a.order)[0];
    const dep = prev ? toMin(prev.depart) : null;
    if (dep == null) return '';
    const r = dayDelay(target.date);
    const depAdj = dep + (r && prev.order >= r.order ? r.delay : 0);
    const left = depAdj - nt.min;
    return '<p class="eta-line">' + esc(pname(prev)) + ' 출발 <b>' + hhmm(depAdj) + '</b>' + (left > 0 ? ' (' + left + '분 뒤)' : left > -60 ? ' <span class="late">출발 시각 지남</span>' : '') + '</p>';
  }
  const distanceCard0 = distanceCard;
  distanceCard = function () {
    const h = distanceCard0();
    if (!h || !DATA) return h;
    const extra = etaLine(nextStopNow());
    return extra ? h.replace('<div style="margin-top:10px">', extra + '<div style="margin-top:10px">') : h;
  };

  // 지도·타임라인 화면 아래 "다음 장소" 칩
  function paintChip() {
    const show = DATA && USER && (currentView === 'plan' || currentView === 'tl');
    const t = show ? nextStopNow() : null;
    if (!t || t.lat == null || t.date !== tokyoNow().date) { hideBar('nextChip'); return; }
    const el = bar('nextChip');
    let txt = '<span class="k">次</span> <b>' + esc(pname(t)) + '</b>';
    if (myPos) {
      const d = haversine(myPos, [t.lat, t.lng]);
      txt += ' · ' + fmtDist(d) + (d <= 2500 ? ' · 도보 ' + Math.max(1, Math.round(d * 1.3 / 80)) + '분' : '');
    }
    const plan = predictedMin(t) != null ? predictedMin(t) : toMin(t.arrive);
    if (plan != null) txt += ' · ' + hhmm(plan) + ' 도착 계획';
    el.innerHTML = '<span>' + txt + '</span>';
    el.onclick = () => window.open(navUrl(t.lat, t.lng), '_blank', 'noopener');
  }
  const setView0 = setView;
  setView = function (v) { setView0(v); paintChip(); hideBar('geoAsk'); };
  setInterval(paintChip, 30000);

  /* ── 6. 도착 자동 제안 ── */
  //  반경 80m 안(정확도 60m 이내)에 1분 넘게 있으면 물어봄. 같은 장소는 한 번만
  //  계획 도착 시각 기준 -2시간 ~ +1.5시간인 곳만 (아침 숙소에서 저녁 숙소 도착을 묻지 않게)
  let geoCand = null;
  function askedKey() { return 'trip-geo-asked-' + (USER ? USER.id : ''); }
  function asked() { try { return JSON.parse(LS.get(askedKey(), '{}')); } catch (e) { return {}; } }
  function geofence() {
    if (LS.get(GEO_KEY, '1') === '0' || !DATA || !USER || !canStamp() || !lastPos || lastPos.acc > 60) return;
    const nt = tokyoNow();
    const done = asked();
    let best = null;
    DATA.points.filter(p => p.date === nt.date && p.lat != null).forEach(p => {
      const vk = p.date + '#' + p.order;
      if (arrivedAt(p) || done[vk]) return;
      const plan = predictedMin(p) != null ? predictedMin(p) : toMin(p.arrive);
      if (plan != null && (nt.min < plan - 120 || nt.min > plan + 90)) return;
      const d = haversine([lastPos.lat, lastPos.lng], [p.lat, p.lng]);
      if (d > 80) return;
      const score = Math.abs((plan == null ? nt.min : plan) - nt.min) + d / 10;
      if (!best || score < best.score) best = { vk: vk, p: p, score: score };
    });
    if (!best) { geoCand = null; return; }
    if (!geoCand || geoCand.vk !== best.vk) { geoCand = { vk: best.vk, since: Date.now() }; return; }
    if (Date.now() - geoCand.since < 60000 || document.getElementById('geoAsk')) return;
    const p = best.p, vk = best.vk;
    const mark = () => { const a = asked(); a[vk] = 1; LS.set(askedKey(), JSON.stringify(a)); };
    const el = bar('geoAsk');
    el.innerHTML = '<span><b>' + esc(pname(p)) + '</b> 근처. 도착 찍을까?</span>' +
      '<button type="button">도착</button><button type="button" class="ghost">아님</button>';
    el.querySelector('button').onclick = () => { mark(); el.remove(); recordArrivalNow(vk); };
    el.querySelector('.ghost').onclick = () => { mark(); el.remove(); };
    if (navigator.vibrate) navigator.vibrate(60);
  }

  function paintGeo() {
    const el = document.getElementById('devGeo');
    if (!el) return;
    const on = LS.get(GEO_KEY, '1') !== '0';
    el.innerHTML = '<h3>위치</h3>' +
      '<p>' + (geoWatch != null ? '<b class="ok">위치 켜짐</b>' : '위치 꺼짐') + ' · 다음 장소 거리, 걸어서 도착 예상, 근처 도착 제안에 사용. 앱이 열려 있을 때만 동작</p>' +
      '<div class="row"><label class="sw"><input type="checkbox" id="geoOn"' + (on ? ' checked' : '') + '> 근처 오면 도착 찍을지 묻기</label>' +
      (geoWatch == null ? '<button class="btn" type="button" id="geoStart">위치 켜기</button>' : '') + '</div>';
    document.getElementById('geoOn').onchange = e => LS.set(GEO_KEY, e.target.checked ? '1' : '0');
    const b = document.getElementById('geoStart');
    if (b) b.onclick = () => { startWatch(); setTimeout(paintGeo, 1500); };
  }
})();
