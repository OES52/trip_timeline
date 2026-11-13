// 데이터 색: 도시·노선·사람. 화면 뼈대 색(styles/tokens.css)과 따로 관리

// 도시별 색: 오사카 주황(미도스지·도톤보리 간판), 교토 주홍(도리이), 나라 녹색(나라공원), 도쿄 JR 연두, 한국 파랑
const CITY_COLORS = [
  [/오사카|大阪|Osaka/i, '#f76b15'],
  [/교토|京都|Kyoto/i, '#d6402b'],
  [/나라|奈良|Nara/i, '#2f9e44'],
  [/도쿄|東京|Tokyo|요코하마|横浜/i, '#4c9a2a'],
  [/고베|神戸|Kobe/i, '#0b7285'],
  [/인천|서울|김포|부산|한국/i, '#2b62d9'],
];
export function cityColor(name) {
  for (const [re, c] of CITY_COLORS) if (re.test(name || '')) return c;
  return '';
}

// 노선 색 (단계 데이터에 색이 없을 때 이름으로 찾음)
const LINE_COLORS = [
  // 도쿄: JR
  [/야마노테|山手|Yamanote/i, '#80c241'], [/게이힌.?도호쿠|京浜東北|Keihin/i, '#00b2e5'],
  [/주오.?소부|中央・総武|中央総武|Chuo-Sobu/i, '#ffd400'], [/소부|総武|Sobu/i, '#ffd400'],
  [/주오.*쾌속|中央線快速|中央本線|Chuo Rapid|JR.*주오|JR.*中央/i, '#f15a22'],
  [/사이쿄|埼京|Saikyo/i, '#00ac9a'], [/쇼난.?신주쿠|湘南新宿|Shonan/i, '#e21f26'],
  [/도카이도|東海道|Tokaido/i, '#f68b1e'], [/요코스카|横須賀|Yokosuka/i, '#1069b4'],
  [/게이요|京葉|Keiyo/i, '#c9252f'], [/신칸센|新幹線|Shinkansen/i, '#1d6fb8'],
  // 도쿄 메트로
  [/긴자|銀座|Ginza/i, '#ff9500'], [/마루노우치|丸ノ内|Marunouchi/i, '#f62e36'], [/히비야|日比谷|Hibiya/i, '#a3a39c'],
  [/도자이|東西|Tozai/i, '#009bbf'], [/지요다|치요다|千代田|Chiyoda/i, '#00bb85'], [/유라쿠초|有楽町|Yurakucho/i, '#c1a470'],
  [/한조몬|半蔵門|Hanzomon/i, '#8f76d6'], [/난보쿠|南北|Namboku/i, '#00ac9b'], [/후쿠토신|副都心|Fukutoshin/i, '#9c5e31'],
  // 도에이·사철·기타
  [/아사쿠사|浅草|Asakusa/i, '#e85298'], [/미타|三田|Mita/i, '#0079c2'], [/오에도|大江戸|Oedo/i, '#b6007a'],
  [/도에이.*신주쿠|都営新宿|Shinjuku Line/i, '#6cbb5a'], [/유리카모메|ゆりかもめ|Yurikamome/i, '#1eb5b0'],
  [/린카이|りんかい|Rinkai/i, '#00418e'], [/미나토미라이|みなとみらい|Minatomirai/i, '#09357f'],
  [/도큐|東急|Tokyu/i, '#da0442'], [/게이큐|京急|Keikyu/i, '#e5171f'], [/오다큐|小田急|Odakyu/i, '#2288cc'],
  [/게이오|京王|Keio/i, '#dd0077'], [/세이부|西武|Seibu/i, '#0079c2'], [/도부|東武|Tobu/i, '#0f6cc3'], [/게이세이|京成|Keisei/i, '#0a2c7a'],
  // 오사카·간사이
  [/미도스지|御堂筋|Midosuji/i, '#e5171f'], [/다니마치|谷町|Tanimachi/i, '#522886'],
  [/요쓰바시|요츠바시|四つ橋|Yotsubashi/i, '#0078ba'], [/주오선|中央線|Chuo/i, '#019a66'],
  [/센니치마에|千日前|Sennichimae/i, '#e44d93'], [/사카이스지|堺筋|Sakaisuji/i, '#814721'],
  [/나가호리|長堀|Nagahori/i, '#a9cc51'], [/이마자토스지|今里筋|Imazatosuji/i, '#ee7b1a'],
  [/한큐|阪急|Hankyu/i, '#6b1b23'], [/게이한|京阪|Keihan/i, '#0d5b9a'],
  [/긴테쓰|긴테츠|近鉄|Kintetsu/i, '#d7003a'], [/난카이|南海|Nankai/i, '#ff6a13'],
  [/한신|阪神|Hanshin/i, '#00559f'], [/JR|사가노|나라선|순환선|교토선/i, '#1d2633'],
];
export function lineColor(text) {
  for (const [re, c] of LINE_COLORS) if (re.test(text || '')) return c;
  return '';
}

const USER_COLORS = { OES: '#2b62d9', KanoC: '#d9480f', Keiz: '#13945f', Rinne: '#8a3ffc', Guest: '#5d6b7d' };
export function userColor(id) { return USER_COLORS[id] || '#5d6b7d'; }

/** 색 위에 올릴 글자색: 흰색과 남색 중 명암비가 더 큰 쪽 */
export function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const onWhite = 1.05 / (L + 0.05), onNavy = (L + 0.05) / (0.0185 + 0.05);   // 0.0185 = 남색(#1B2536)의 밝기
  return onNavy > onWhite ? '#1B2536' : '#fff';
}
