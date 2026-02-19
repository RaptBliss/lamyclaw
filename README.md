# lamyclaw

Bun + Elysia 기반 OpenCode Docker 컨테이너 관리 API/Web MVP

## 기능
- 컨테이너 생성/목록/시작/중지/재시작/삭제
- 로그 조회 API
- 포트 자동 할당(30000-39999) + 수동 할당 + 충돌 방지
- 간단 Web 대시보드
- 선택적 API 토큰 인증(`LAMYCLAW_API_TOKEN`)

## 실행
```bash
~/.bun/bin/bun install
LAMYCLAW_API_TOKEN=your-token ~/.bun/bin/bun run src/index.ts
```

브라우저: http://localhost:4300

> `LAMYCLAW_API_TOKEN`을 설정하면 `/api/*` 요청에 인증이 필요합니다.
> - `x-api-token: your-token`
> - 또는 `Authorization: Bearer your-token`

## API
- `GET /api/health` (인증 불필요)
- `GET /api/ports`
- `GET /api/containers`
- `POST /api/containers`
- `POST /api/containers/:id/start`
- `POST /api/containers/:id/stop`
- `POST /api/containers/:id/restart`
- `DELETE /api/containers/:id`
- `GET /api/containers/:id/logs?tail=200`

## 예시
```bash
# 컨테이너 생성
curl -X POST http://localhost:4300/api/containers \
  -H 'Content-Type: application/json' \
  -H 'x-api-token: your-token' \
  -d '{"name":"opencode-a","image":"opencode:latest","containerPort":3000}'

# 목록 조회
curl http://localhost:4300/api/containers -H 'x-api-token: your-token'
```

## 스모크 테스트
```bash
# 서버 실행 후 (기본 이미지: nginx:alpine)
./scripts/smoke.sh

# 토큰 사용 시
LAMYCLAW_API_TOKEN=your-token ./scripts/smoke.sh

# 테스트 이미지 지정
IMAGE=nginx:alpine ./scripts/smoke.sh
```