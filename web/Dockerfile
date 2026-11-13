# 빌드: 저장소 루트에서  docker build -f web/Dockerfile -t trip-web .
# 1단계: 화면 코드(App_*.html, Style_*.html, Index.html)를 index.html 한 장으로 합침
#  빌드 단계는 빌드하는 기계 아키텍처로 돌려서 arm64 에뮬레이션 없이 빠르게
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY Index.html App_*.html Style_*.html ./
COPY web ./web
RUN node web/build.mjs

# 1-2단계: 새 화면(v2, web/v2). 같은 사이트의 /v2/ 로 같이 나감. 로직 테스트가 깨지면 빌드도 실패
FROM --platform=$BUILDPLATFORM node:22-slim AS v2
WORKDIR /v2
COPY web/v2/package.json web/v2/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/v2/ ./
RUN npm test && npm run build

# 2단계: 정적 파일만 nginx로 서빙 (root 아님, 8080)
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/web/dist /usr/share/nginx/html
COPY --from=v2 /v2/dist /usr/share/nginx/html/v2
EXPOSE 8080
