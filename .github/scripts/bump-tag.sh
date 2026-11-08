#!/usr/bin/env bash
# k8s/kustomization.yaml 에서 이미지 하나의 newTag만 바꿔서 커밋·푸시 → Fleet이 1분 안에 배포
#  사용: bump-tag.sh ghcr.io/oes52/trip-api <태그>
#  GITHUB_TOKEN으로 한 push는 워크플로를 다시 실행하지 않아서 무한 반복 없음 (k8s/는 어느 워크플로 paths에도 없음)
set -euo pipefail
img="$1"; tag="$2"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
for i in 1 2 3 4 5; do
  git pull --rebase --quiet origin main
  IMG="$img" TAG="$tag" yq -i '(.images[] | select(.name == strenv(IMG)) | .newTag) = strenv(TAG)' k8s/kustomization.yaml
  grep -n -A1 "$img" k8s/kustomization.yaml
  git add k8s/kustomization.yaml
  if git diff --cached --quiet; then echo "태그 변경 없음"; exit 0; fi
  git commit -q -m "deploy: ${img##*/} ${tag::7} [skip ci]"
  git push origin HEAD:main && exit 0
  git reset --hard -q HEAD~1   # 다른 워크플로가 먼저 올림 → 다시 받아서 재시도
  sleep $((i * 3))
done
echo "push 실패"; exit 1
