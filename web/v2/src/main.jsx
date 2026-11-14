import './preview.js';   // ?now= 시간 미리보기. 다른 코드가 시계를 읽기 전에 먼저
import { render } from 'preact';
import './styles/tokens.css';
import './styles/fonts.css';
import 'pretendard-jp/dist/web/variable/pretendardvariable-jp-dynamic-subset.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/board.css';
import './styles/timeline.css';
import './styles/screens.css';
import './styles/map.css';
import './styles/places.css';
import './styles/records.css';
import './styles/extras.css';
import { App } from './app.jsx';
import { load } from './data/store.js';
import { loadOutbox } from './data/records.js';
import { registerSW } from './data/offline.js';
import { resumeGeo } from './data/location.js';

render(<App />, document.getElementById('app'));
// 앱 파일이 다 떴으면 index.html의 "다시 불러오기" 횟수를 지움
if (!window.__tripAssetErr) { try { sessionStorage.removeItem('trip-asset-retry'); } catch (e) { /* 저장소 없음 */ } }
load();
loadOutbox();
registerSW();
resumeGeo();
