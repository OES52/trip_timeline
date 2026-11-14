# 배포 메모 (Fleet 대상 아님)

구성: `trip-web`(nginx, 정적 페이지) → `/api/` `trip-api`(프록시). 게이트웨이(HTTPRoute)는 지금처럼 trip-web만 가리키면 됨.

## 1. 시크릿 (저장소에 안 올림)

```bash
# VAPID 키 (출발 알림용, 한 번만 만들고 바꾸지 말 것: 바꾸면 기존 구독 전부 무효)
docker run --rm node:22-alpine npx -y web-push@3.6.7 generate-vapid-keys --json
# 또는 api/ 에서 npm ci && npm run vapid

kubectl -n trip create secret generic trip-api \
  --from-literal=APPS_SCRIPT_URL='https://script.google.com/macros/s/…/exec' \
  --from-literal=PROXY_KEY="$(openssl rand -hex 24)" \
  --from-literal=VAPID_PUBLIC_KEY='…' \
  --from-literal=VAPID_PRIVATE_KEY='…' \
  --from-literal=VAPID_SUBJECT='mailto:본인메일'
kubectl -n trip get secret trip-api -o jsonpath='{.data.PROXY_KEY}' | base64 -d; echo   # Apps Script에 넣을 값
```

### 접속 코드 (일정 보기 잠금)

`ACCESS_CODE`를 넣으면 일정 데이터·사진·쓰기·알림 API가 코드 입력 후 받은 쿠키(기본 90일) 없이는 401. 지도 타일은 공개 그대로.
코드를 바꾸면 기존 세션 전부 끊김 (다시 입력). 화면은 저장본을 그대로 보여주고 머리줄 아래에 "코드 입력" 줄이 뜸 (안 보낸 기록은 폰에 그대로 있다가 코드를 넣으면 보냄).
Apps Script 비상 주소도 같은 코드로 잠그려면 시트 메뉴 **여행 도구 → 비상 주소 접속 코드 설정**.

```bash
kubectl -n trip patch secret trip-api --type merge -p '{"stringData":{"ACCESS_CODE":"원하는코드"}}'
kubectl -n trip rollout restart deploy/trip-api
curl -s -o /dev/null -w '%{http_code}\n' https://japan2026.oesgame.xyz/api/data   # 401이면 잠김
```

## 2. Apps Script

1. `clasp push` → 편집기 **배포 → 배포 관리 → 기존 배포 연필 → 버전: 새 버전** (주소 그대로, 새 버전 안 만들면 /exec 는 예전 코드)
2. 프로젝트 설정 → 스크립트 속성
   - `PROXY_KEY` = 위 시크릿 값 (넣는 순간부터 Apps Script 주소 직접 호출은 거부됨)
   - `PROXY_HOOK_URL` = `https://japan2026.oesgame.xyz/api/hook/invalidate`
3. 시트 메뉴 **여행 도구 → 홈랩 프록시 알림 트리거 설치** (권한 승인 한 번)
4. 시트 메뉴 **여행 도구 → 할 일·예약 시트 만들기** (할 일·예약 시트, 장소 시트 "일본어 이름"·"주소" 열, 설정 시트 "비상 연락처" 칸)
   → **장소 일본어 이름·주소 채우기** (Places API, 빈 칸만. 숙소 주소는 예약 메일과 대조)
5. 집 서버 감시: **집 서버 감시 켜기** (10분마다 확인, 30분 넘게 안 되면 메일 + 비상 주소 열림, 돌아오면 메일 + 닫힘)
   - 비상 주소 = 이 Apps Script 웹앱이 보여주는 예전 화면(v1). 평소엔 닫혀 있음 (스크립트 속성 `FALLBACK`)
   - 접속 코드를 켰으면 **비상 주소 접속 코드 설정**에 같은 코드 (감시 메일의 주소에 `?code=`가 붙어서 감)
   - 직접 열고 닫기: **비상 주소 직접 열기·닫기**

## 3. 확인

```bash
kubectl -n trip get pods
kubectl -n trip logs deploy/trip-api          # "데이터 갱신 시작 …ms" 보이면 Apps Script 연결 OK
curl -s https://japan2026.oesgame.xyz/api/data -o /dev/null -w '%{http_code} %{size_download}\n'
```

## 메모

- trip-api는 1개 고정: 알림 스케줄러가 둘이면 같은 알림 두 번, PVC가 RWO. 죽어 있는 동안 화면은 IndexedDB 저장본으로 보이고 쓰기만 실패
- GHCR 패키지 trip-api가 비공개로 만들어지면 패키지 설정에서 공개로 바꾸거나 imagePullSecrets 추가
- 레이트 리밋 IP: 게이트웨이가 클라이언트 IP를 SNAT하면(externalTrafficPolicy: Cluster) 모두 노드 IP로 보여서 IP별 제한이 사실상 전체 제한이 됨. PIN 잠금은 사용자별이기도 해서 그대로 동작
