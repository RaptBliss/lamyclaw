# lamyclaw

Bun + Elysia 기반 OpenCode Docker 컨테이너 관리 API/Web MVP

## 기능
- 컨테이너 생성/목록/시작/중지/재시작/삭제
- 로그 조회 API
- 포트 자동 할당(30000-39999) + 수동 할당 + 충돌 방지
- 간단 Web 대시보드

## 실행
```bash
~/.bun/bin/bun install
~/.bun/bin/bun run src/index.ts
```

브라우저: http://localhost:4300

## API
- `GET /api/health`
- `GET /api/ports`
- `GET /api/containers`
- `POST /api/containers`
- `POST /api/containers/:id/start`
- `POST /api/containers/:id/stop`
- `POST /api/containers/:id/restart`
- `DELETE /api/containers/:id`
- `GET /api/containers/:id/logs?tail=200`
