# 빌드: 저장소 루트에서  docker build -f web/Dockerfile -t trip-web .
# 1단계: 새 화면(v2, web/v2). /v2/ 에 놓이고 사이트 첫 주소(/)가 여기로 넘어감. 로직 테스트가 깨지면 빌드도 실패
#  빌드 단계는 빌드하는 기계 아키텍처로 돌려서 arm64 에뮬레이션 없이 빠르게
FROM --platform=$BUILDPLATFORM node:22-slim AS v2
WORKDIR /v2
COPY web/v2/package.json web/v2/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/v2/ ./
RUN npm test && npm run build

# 2단계: 정적 파일만 nginx로 서빙 (root 아님, 8080)
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
#  /        → /v2/ 로 넘김 (nginx.conf). 루트에는 예전 서비스 워커 걷어내는 sw.js·매니페스트, /v1/sw.js(v1 걷어내기)·아이콘만
#  /v2/     새 화면
COPY web/root/ /usr/share/nginx/html/
COPY web/public/icons /usr/share/nginx/html/icons
#  바로 전 배포의 앱 파일(CI가 web/v2/prev에 넣어 둠, 로컬 빌드면 비어 있음)을 먼저 깔고 새 빌드를 덮어씀
#  → 배포 직후에도 예전 화면이 늦게 부르는 파일이 404 안 남
COPY web/v2/prev/ /usr/share/nginx/html/v2/
COPY --from=v2 /v2/dist /usr/share/nginx/html/v2
EXPOSE 8080
