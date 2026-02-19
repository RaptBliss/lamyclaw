# lamyclaw

Bun + Elysia 기반 OpenCode Docker 컨테이너 관리 API/Web MVP

## 기능
- 컨테이너 생성/목록/시작/중지/재시작/삭제
- 로그 조회 API
- 포트 자동 할당(30000-39999) + 수동 할당 + 충돌 방지
- 프로젝트/오너 기반 자동 네이밍 규칙
- lamyclaw 관리 라벨 자동 부착 (`com.lamyclaw.*`)
- OpenCode 읽기용 워크스페이스 자동 마운트 (`/workspace`) + workingDir 고정
- 필수 문서 존재 검사 (`AGENTS.md`, `RULE.md`, `PERSONA.md` 기본)
- SKILL/WORKFLOWS 다중 파일 검증 지원 (`skillFiles`, `workflowFiles`)
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
  - 주요 필드: `project`, `owner`, `workspaceHostPath`, `requiredDocs`, `skillFiles[]`, `workflowFiles[]`
- `POST /api/containers/:id/start`
- `POST /api/containers/:id/stop`
- `POST /api/containers/:id/restart`
- `DELETE /api/containers/:id`
- `GET /api/containers/:id/logs?tail=200`

## 예시
```bash
# 컨테이너 생성 (name 생략 시 project-owner-timestamp 자동 생성)
# workspaceHostPath 에 AGENTS/RULE/PERSONA 파일이 미리 있어야 생성 성공
curl -X POST http://localhost:4300/api/containers \
  -H 'Content-Type: application/json' \
  -H 'x-api-token: your-token' \
  -d '{
    "project":"lamyclaw",
    "owner":"sbpark",
    "workspaceHostPath":"/data/lamyclaw/workspaces/sbpark/proj-a",
    "image":"ghcr.io/anomalyco/opencode:latest",
    "containerPort":3000,
    "labels":{"team":"platform"},
    "skillFiles":["skills/backend.md","skills/frontend.md"],
    "workflowFiles":["workflows/review.md","workflows/release.md"]
  }'

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