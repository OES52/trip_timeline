/**
 * Config.gs
 * 여행 타임라인 도구
 *  - 일정 시트: 사람이 입력 (왼쪽) / 스크립트가 이동(분) 채움 / 도착·출발·여유·예산 정보는 시트 함수로 즉시 계산
 *  - 경로 시트: 스크립트 전용. "경로 계산" 때마다 덮어씀
 *  - 예산 시트: 번호로 일정과 연결. 금액은 양쪽 어디서 고쳐도 서로 반영
 *    일정은 엔화(¥), 예산은 원화(₩). 설정 시트의 고정 환율로 변환
 *  - 교통비: 구간 요금(경로 API 또는 수동 입력)을 일자별로 합산해 예산 시트에 "교통비 MM/DD" 한 줄로 연동
 *  - 장소 시트: 장소 도감 (종류·비용·메뉴·메모). 일정의 장소를 지도 링크·좌표·이름으로 묶어 한 줄씩
 *  - 지출 시트: 여행 중 웹앱에서 입력한 실제 지출 기록
 *  - 웹앱: 일자별 지도 + 타임라인 + 지출 합계 + 장소 도감 + 날씨 (Index.html)
 */

const CONFIG = {
  // 지도 열기 메뉴가 여는 웹앱 주소. ScriptApp.getService().getUrl()은 예전 배포 주소를 줄 때가 있어서 직접 지정
  // 새 배포(배포 ID가 바뀌는 경우)를 만들면 여기만 바꾸기. "배포 관리 → 편집 → 새 버전"은 주소 그대로라 안 바꿔도 됨
  WEBAPP_URL: 'https://script.google.com/macros/s/AKfycbzmL_k74yob5ZdtEaEeAL3vY0LlWHoHAaqSUYYmcMU114SPnEYkEuS7RMTmqTZKKA5Q/exec',
  TRIP_TZ: 'Asia/Tokyo',        // 경로 계산·시각 표시 기준 시간대
  PLAN_SHEET: '일정',
  ROUTE_SHEET: '경로',
  BUDGET_SHEET: '예산',
  SETTINGS_SHEET: '설정',
  PLACE_SHEET: '장소',
  SPEND_SHEET: '지출',
  TODO_SHEET: '할 일',          // 출발 전 할 일 (웹앱 오늘 화면·알림)
  BOOK_SHEET: '예약',           // 예약번호·티켓 그림 (웹앱 일정 줄에 붙음)
  HOME_URL: 'https://japan2026.oesgame.xyz/',   // 홈랩 웹앱 주소 (지도 열기·집 서버 감시)
  PLACE_MATCH_M: 40,            // 좌표가 이 거리(m) 안이면 같은 장소로 봄
  PLACES_DAILY_CAP: 150,        // 영업시간 채우기: 하루 최대 유료 호출 수 (장소 상세 Enterprise)
  PLACES_SKIP_TYPES: ['교통', '숙소'],  // 영업시간 채우기에서 기본으로 건너뛸 종류
  // 웹앱 첫 화면에서 고르는 사용자. 볼 수 있는 날짜 범위, 도장·도착 기록 가능 여부(canStamp),
  // 웹에서 일정 수정 가능 여부(canEdit). 도장·도착 기록은 사람마다 따로 저장
  // 설정 시트에 사용자 표가 없을 때만 쓰는 기본값. 실제 목록은 설정 시트에서 관리
  USERS: [
    { id: 'OES',   from: '2026-12-25', to: '2027-01-03', canStamp: true,  canEdit: true },
    { id: 'KanoC', from: '2026-12-25', to: '2027-01-03', canStamp: true,  canEdit: true },
    { id: 'Keiz',  from: '2026-12-28', to: '2027-01-03', canStamp: true,  canEdit: false },
    { id: 'Rinne', from: '2026-12-28', to: '2027-01-03', canStamp: true,  canEdit: false },
    { id: 'Guest', from: '2026-12-25', to: '2027-01-03', canStamp: false, canEdit: false },
  ],
  // 주유패스 적용 노선 (정규식, | 로 구분). 설정 시트 "주유패스 노선" 칸이 비었을 때 기본값
  // 구간의 탑승 단계 노선 이름·회사 이름에 하나라도 맞으면 패스 노선으로 봄
  PASS_LINES: '오사카메트로|大阪メトロ|Osaka Metro|미도스지|다니마치|요쓰바시|요츠바시|센니치마에|사카이스지|나가호리|이마자토스지|뉴트램|난코포트타운|오사카 시티 버스|大阪シティバス|Osaka City Bus',
  // 주유패스 날: 구글 경로 후보 중 패스 전철(버스 아닌 것) 경로를 우선 고름
  // 가장 빠른 후보보다 이 시간(분)까지 느려도 패스 전철 경로를 씀. 더 느리면 가장 빠른 경로
  PASS_PREFER_MAX_EXTRA: 20,
  RATE_NAME: 'JPY_KRW',         // 설정 시트 환율 칸 이름 (1엔당 원)
  DEFAULT_START: '09:00',       // 그날 첫 행에 고정 시각이 없을 때 시작 시각
  ROUND_MIN: 5,                 // 출발 시각을 이 분 단위로 올림 (여유 확보용). 1이면 올림 안 함
  // 이동 시간 올림 단위 (분). 수단별로 다르게. 1이면 올림 안 함. 목록에 없는 수단은 ROUND_MIN
  ROUND_MOVE: { '대중교통': 10, '차': 10, '도보': 5, '수동': 5 },
  TRAVELERS: 2,                 // 교통비 예산 인원수 (구간 요금은 1인 기준이라 총 비용 = 1인 합계 × 인원수)
  DEFAULT_PEOPLE: 2,            // 일정에서 금액 입력해 예산을 새로 만들 때 인원수. 나눠 낼 건 예산 시트에서 직접 수정
  CURRENCY_FORMAT: '₩#,##0',
  YEN_FORMAT: '¥#,##0',
  YEN_FORMAT: '¥#,##0',
  GEOCODE_LANG: 'ja',
  GEOCODE_REGION: 'jp',         // 장소명 검색 시 우선 지역. 다른 나라 여행이면 바꾸기 (예: 'kr')
  SLEEP_MS: 300,                // 경로 API 호출 간격
  LATE_CHECK_MIN: 10,           // 대중교통 구간: 이만큼 늦게 출발해서 한 번 더 조회
  LATE_WARN_MIN: 20,            // 늦게 출발했을 때 소요가 이만큼 이상 늘면 "배차 드묾" 경고
  WALK_CHECK_M: 1500,           // 대중교통 구간: 직선거리가 이 안(m)이면 도보 경로도 한 번 조회
  WALK_HINT_MIN: 10,            // 걸어서 이 시간(분) 이하이거나 대중교통보다 빠르면 "도보 추천" 알림
  FIXED_TIGHT_MIN: 10,          // 고정 시각 앞 여유가 이보다 적으면 "빠듯" 경고
  CLOSE_SOON_MIN: 30,           // 식당·카페: 마감까지 이 시간(분) 안 남기고 도착하면 "마감 직전" 경고
  INNER_WALK_M_PER_MIN: 80,     // 장소 안 시작점→종착점 도보 어림 속도 (m/분, 저장된 도보 경로 없을 때)
  INNER_WALK_DETOUR: 1.3,       // 장소 안 도보 어림: 직선거리 × 이 값
  LAST_TRAIN_FROM: 23 * 60,     // 이 시각(분) 이후 출발하는 대중교통은 "막차 시간대" 경고 (막차 조회 못 했을 때만)
  LAST_CHECK_FROM: 20 * 60,     // 이 시각(분) 이후 출발하는 대중교통 구간은 실제 막차(마지막으로 출발할 수 있는 시각) 조회
  LAST_WARN_MARGIN: 30,         // 계획 출발이 막차 출발 시각보다 이만큼(분) 덜 남으면 경고
  WALK_DAY_KM: 12,              // 하루 도보가 이 거리(km) 이상이면 "많음" 표시
  TAXI_CHECK_M: 6000,           // 택시 비교: 직선거리가 이 안(m)인 대중교통 구간만
  TAXI_CHECK_MIN_TRANSIT: 20,   // 택시 비교: 대중교통이 이 시간(분) 이상 걸리는 구간만
  TAXI_HINT_SAVE: 10,           // 택시가 이 시간(분) 이상 빨라야 알림
  // 택시 요금표 (보통차 상한 운임 기준, 운수국 공시값). 출발지 좌표가 box [남, 서, 북, 동] 안이면 그 요금표
  //  base: 첫 baseM(m)까지 기본요금 / stepM마다 100엔 / 시속 10km 이하로 느릴 때 timeSec초마다 100엔
  //  요금 바뀌면 여기만 고치기
  TAXI_TARIFFS: [
    { name: '교토', box: [34.85, 135.60, 35.10, 135.90], base: 500, baseM: 900, stepM: 255, timeSec: 95 },
    { name: '오사카', box: [34.40, 135.30, 34.85, 135.70], base: 600, baseM: 1200, stepM: 231, timeSec: 85 },
    { name: '도쿄', box: [35.40, 139.40, 35.90, 139.95], base: 500, baseM: 1096, stepM: 255, timeSec: 95 },
  ],
  TAXI_DEFAULT: { name: '기본', base: 600, baseM: 1200, stepM: 240, timeSec: 90 },
  TAXI_NIGHT_RATE: 1.2,         // 22시~5시 심야 할증 (20%)
  TAXI_MARGIN: 1.1,             // 범위 위쪽에 더하는 여유 (돌아가는 길·신호 등)
  ORDER_HINT_MIN_M: 500,        // 순서 바꿔서 직선거리가 이만큼(m) 이상 줄어야 알림
  ORDER_HINT_MIN_RATIO: 0.15,   // 그리고 이 비율 이상 줄어야 알림
  ORDER_HINT_MAX: 7,            // 고정점 사이 장소가 이보다 많으면 순서 비교 안 함 (경우의 수 폭발 방지)
  MODES: ['대중교통', '도보', '차', '수동'],
  COLOR_HEADER_INPUT: '#1d2633',
  COLOR_HEADER_AUTO: '#5d6b7d',
  COLOR_AUTO: '#eef1f5',
  COLOR_AUTO_COORD: '#fff3bf',
};

// 일정 시트 열 번호 (1부터)
// 앞쪽: 자주 보고 고치는 열 / 가운데: 자동 계산 결과 / 뒤쪽: 가끔 보는 참고·연결 열
const P = {
  DATE: 1, ORDER: 2, ACTIVITY: 3, PLACE: 4, STAY: 5, FIXED: 6, MODE: 7, MANUAL: 8, MANUAL_FARE: 9, AMOUNT: 10, MEMO: 11,
  ARRIVE: 12, DEPART: 13, SLACK: 14, MOVE: 15, BUFFER: 16, FARE: 17, PER: 18,
  LINK: 19, COORD: 20, END_LINK: 21, END_COORD: 22, BUDGET_ID: 23, PAID: 24, FARE_API: 25,
};
// 지도 링크·좌표 = 이 장소에 도착하는 지점 (시작점)
// 종착 링크·좌표 = 이 장소를 떠나는 지점 (시장 관통처럼 들어간 곳과 나오는 곳이 다를 때만). 비우면 시작점에서 출발
const PLAN_HEADERS = [
  '일자', '순서', '활동', '장소', '체류(분)', '고정 시각', '다음 이동수단', '수동 소요(분)', '수동 교통비(¥)', '금액(¥)', '메모',
  '도착 시각', '출발 시각', '여유(분)', '이동(분)', '버퍼(분)', '교통비(¥)', '1인당(¥)',
  '지도 링크', '좌표', '종착 지도 링크', '종착 좌표', '예산 번호', '결제', 'API 요금(¥)',
];
// 사람이 입력하는 열 / 스크립트·함수가 채우는 열
const PLAN_INPUT_KEYS = ['DATE', 'ORDER', 'ACTIVITY', 'PLACE', 'STAY', 'FIXED', 'MODE', 'MANUAL', 'MANUAL_FARE', 'AMOUNT', 'MEMO', 'LINK', 'COORD', 'END_LINK', 'END_COORD', 'BUDGET_ID'];
const PLAN_AUTO_KEYS = ['ARRIVE', 'DEPART', 'SLACK', 'MOVE', 'BUFFER', 'FARE', 'PER', 'PAID', 'FARE_API'];
// 정렬할 때 같이 옮길 값 열 (함수 열 제외)
const PLAN_VALUE_KEYS = PLAN_INPUT_KEYS.concat(['MOVE', 'FARE_API']);
// 4차 구성(열 재배치 전) 헤더. 마이그레이션용
// 이후 새로 생긴 열(종착 지도 링크·종착 좌표 등)은 "시트 구조 업데이트"가 끝에 추가한 뒤 PLAN_HEADERS 순서로 옮김
const PLAN_HEADERS_V4 = [
  '일자', '순서', '활동', '장소', '지도 링크', '좌표', '체류(분)',
  '고정 시각', '다음 이동수단', '수동 소요(분)', '메모', '예산 번호', '금액(¥)', '수동 교통비(¥)',
  '이동(분)', 'API 요금(¥)', '교통비(¥)', '1인당(¥)', '결제', '도착 시각', '출발 시각', '여유(분)',
];

// 경로 시트 열 번호 (1부터)
const R = {
  DATE: 1, SEG: 2, FROM: 3, TO: 4, MODE: 5, DEP: 6, ARR: 7, MIN: 8,
  SUMMARY: 9, TRANSFER: 10, POLY: 11, LINK: 12, CALC: 13, KEY: 14, FARE: 15, WARN: 16, STEPS: 17, PASS: 18, WALK: 19, TAXI: 20, LAST: 21,
};
// 요금(¥): 구글이 알려준 원래 요금 (패스 적용 전). 일정 시트 API 요금(¥)에는 패스 적용 후 값이 들어감
// 경고: 대중교통 구간 점검 결과. OK = 점검함, 문제 없음 / 빈 칸 = 아직 점검 안 함
// 단계: 대중교통 구간의 도보·승차·환승·하차 단계 (JSON, 숨김 열). 웹앱 지도·타임라인이 읽음
// 패스: 주유패스 적용 결과 (주유패스 = 전부 패스 노선이라 0원 / 주유패스 일부 = 일부만 패스 노선이라 요금 그대로)
// 도보(분): 대중교통 구간을 걸어가면 몇 분인지 (빈 칸 = 아직 확인 안 함, - = 멀어서 확인 안 함)
// 택시: 대중교통 구간을 차로 가면 "분|미터" (빈 칸 = 아직 확인 안 함, - = 대상 아님)
const ROUTE_HEADERS = [
  '일자', '구간', '출발', '도착', '수단', '출발 시각', '도착 시각', '소요(분)',
  '노선 요약', '환승', 'polyline', '지도 링크', '계산 일시', '캐시 키', '요금(¥)', '경고', '단계', '패스', '도보(분)', '택시', '막차',
];
// 막차: 대중교통으로 갈 수 있는 가장 늦은 출발 시각 ("23:42", 자정 넘으면 "00:15 (+1)") / 지남 = 계획 출발 때 이미 경로 없음 / - = 대상 아님(LAST_CHECK_FROM 전 출발·도보만) / 빈 칸 = 아직 확인 안 함
const TRANSPORT_MARK = '[교통비 자동]';

// 예산 시트 열 번호 (1부터)
const B = { ID: 1, DATE: 2, NAME: 3, TOTAL: 4, PAID: 5, PEOPLE: 6, PER: 7, MEMO: 8, CUR: 9 };
const BUDGET_HEADERS = ['번호', '날짜', '비용', '총 비용', '결제', '인원수', '1인당 비용', '메모', '통화'];
// 예산 통화: 일본에서 쓰는 돈은 엔화(¥), 한국에서 미리 결제한 것은 원화(₩). 통화 칸이 비어 있으면 원화(예전 시트 호환)
const CUR_YEN = '¥', CUR_WON = '₩';
const curOf_ = v => String(v || '').trim() === CUR_YEN ? CUR_YEN : CUR_WON;

// 장소 시트 열 번호 (1부터). 읽을 땐 열 이름으로 찾으므로 시트 열 순서가 달라도 됨
// 도시·구역: 웹앱 가이드 탭에서 도시 → 구역(동네)으로 묶어 보여줌. 예전 "지역" 열은 시트 구조 업데이트 때 "구역"으로 바뀜
const G = {
  KEY: 1, NAME: 2, ALIAS: 3, TYPE: 4, CITY: 5, AREA: 6, COST_MIN: 7, COST_MAX: 8, HOURS: 9, CLOSED: 10,
  MENU: 11, INTRO: 12, MEMO: 13, LINK: 14, COORD: 15, PHOTO: 16, WEB: 17, PID: 18, JA: 19, ADDR: 20,
};
const PLACE_HEADERS = [
  '장소 키', '이름', '별칭', '종류', '도시', '구역', '비용 최소(¥)', '비용 최대(¥)', '영업시간', '휴무',
  '대표 메뉴', '한 줄 소개', '메모', '지도 링크', '좌표', '사진 URL', '웹사이트', 'Place ID', '일본어 이름', '주소',
];
const PLACE_TYPES = ['숙소', '식당', '카페', '관광지', '쇼핑', '교통', '기타'];

// 지출 시트 열 번호 (1부터)
const X = { KEY: 1, DATE: 2, ORDER: 3, PLACE: 4, AMOUNT: 5, MEMO: 6, AT: 7 };
const SPEND_HEADERS = ['키', '일자', '순서', '장소', '실제 지출(¥)', '메모', '기록 시각'];

const MODE_MAP = {
  '대중교통': Maps.DirectionFinder.Mode.TRANSIT,
  '도보': Maps.DirectionFinder.Mode.WALKING,
  '차': Maps.DirectionFinder.Mode.DRIVING,
};
const MODE_URL = { '대중교통': 'transit', '도보': 'walking', '차': 'driving', '수동': 'transit' };