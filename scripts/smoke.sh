#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4300}"
TOKEN="${LAMYCLAW_API_TOKEN:-}"
NAME="smoke-opencode-$(date +%s)"
IMAGE="${IMAGE:-nginx:alpine}"

hdr=(-H "content-type: application/json")
if [[ -n "$TOKEN" ]]; then
  hdr+=( -H "x-api-token: $TOKEN" )
fi

echo "[1/5] health"
curl -fsS "$BASE_URL/api/health" >/dev/null

echo "[2/5] create: $NAME"
CREATE_RES=$(curl -fsS -X POST "$BASE_URL/api/containers" "${hdr[@]}" \
  -d "{\"name\":\"$NAME\",\"image\":\"$IMAGE\",\"containerPort\":80}")
ID=$(echo "$CREATE_RES" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
if [[ -z "$ID" ]]; then
  echo "create 응답에서 id 파싱 실패"
  echo "$CREATE_RES"
  exit 1
fi

echo "[3/5] list + logs"
curl -fsS "$BASE_URL/api/containers" "${hdr[@]}" >/dev/null
curl -fsS "$BASE_URL/api/containers/$ID/logs?tail=20" "${hdr[@]}" >/dev/null

echo "[4/5] restart + stop + start"
curl -fsS -X POST "$BASE_URL/api/containers/$ID/restart" "${hdr[@]}" >/dev/null
curl -fsS -X POST "$BASE_URL/api/containers/$ID/stop" "${hdr[@]}" >/dev/null
curl -fsS -X POST "$BASE_URL/api/containers/$ID/start" "${hdr[@]}" >/dev/null

echo "[5/5] cleanup"
curl -fsS -X DELETE "$BASE_URL/api/containers/$ID" "${hdr[@]}" >/dev/null

echo "SMOKE_OK: $ID"
