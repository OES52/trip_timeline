// 지도 라이브러리(MapLibre). 1MB쯤 돼서 지도를 처음 열 때만 따로 받음 (이 파일을 동적 import)
//  6.4.1 미만은 CVE-2026-85061(출처 표시 XSS)에 걸리므로 그 위 버전만 씀
import * as ml from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

ml.setWorkerUrl(workerUrl);   // 묶어서(번들) 쓸 때는 워커 파일 위치를 직접 알려줘야 함
export default ml;
