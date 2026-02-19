import { Elysia } from 'elysia';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type CreateContainerBody = {
  name?: string;
  project?: string;
  owner?: string;
  image?: string;
  hostPort?: number;
  containerPort?: number;
  workspaceHostPath?: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  requiredDocs?: string[];
  skillFiles?: string[];
  workflowFiles?: string[];
  volumes?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
};

const MIN_PORT = 30000;
const MAX_PORT = 39999;

function getApiToken() {
  return process.env.LAMYCLAW_API_TOKEN?.trim() || '';
}

function ensureAuthorized(request: Request) {
  const configured = getApiToken();
  if (!configured) return;

  const headerToken = request.headers.get('x-api-token')?.trim() || '';
  const auth = request.headers.get('authorization')?.trim() || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  if (headerToken !== configured && bearer !== configured) {
    throw new Error('UNAUTHORIZED');
  }
}

function run(command: string[], allowFail = false) {
  const proc = Bun.spawnSync(command, {
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const stdout = new TextDecoder().decode(proc.stdout).trim();
  const stderr = new TextDecoder().decode(proc.stderr).trim();

  if (proc.exitCode !== 0 && !allowFail) {
    throw new Error(stderr || stdout || `command failed: ${command.join(' ')}`);
  }

  return { stdout, stderr, exitCode: proc.exitCode };
}

function dockerExists() {
  const r = run(['docker', '--version'], true);
  return r.exitCode === 0;
}

function getUsedPortsFromDocker(): Set<number> {
  const used = new Set<number>();
  if (!dockerExists()) return used;

  const { stdout } = run(['docker', 'ps', '--format', '{{.Ports}}'], true);
  if (!stdout) return used;

  for (const line of stdout.split('\n')) {
    const matches = line.matchAll(/:(\d+)->/g);
    for (const m of matches) used.add(Number(m[1]));
  }
  return used;
}

function getNextPort(preferred?: number): number {
  const used = getUsedPortsFromDocker();

  if (preferred) {
    if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) {
      throw new Error(`요청 포트 ${preferred} 가 유효하지 않습니다.`);
    }
    if (used.has(preferred)) throw new Error(`요청 포트 ${preferred} 는 이미 사용 중입니다.`);
    return preferred;
  }

  for (let p = MIN_PORT; p <= MAX_PORT; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error('사용 가능한 포트가 없습니다.');
}

function normalizeNamePart(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

function buildContainerMeta(payload: CreateContainerBody) {
  const project = normalizeNamePart(payload.project || 'default');
  const owner = normalizeNamePart(payload.owner || 'system');
  const name = payload.name?.trim() || `${project}-${owner}-${Date.now()}`;

  const labels: Record<string, string> = {
    'com.lamyclaw.managed': 'true',
    'com.lamyclaw.project': project,
    'com.lamyclaw.owner': owner,
    ...payload.labels
  };

  return { project, owner, name, labels };
}

function resolveWorkspaceHostPath(payload: CreateContainerBody, owner: string, project: string) {
  const raw = payload.workspaceHostPath?.trim() || join('/tmp/lamyclaw-workspaces', owner, project);
  mkdirSync(raw, { recursive: true });
  return raw;
}

function verifyDocsInWorkspace(payload: CreateContainerBody, workspaceHostPath: string) {
  const requiredDocs = payload.requiredDocs?.length
    ? payload.requiredDocs
    : ['AGENTS.md', 'RULE.md', 'PERSONA.md'];

  const missing: string[] = [];
  for (const file of requiredDocs) {
    const p = join(workspaceHostPath, file);
    if (!existsSync(p)) missing.push(file);
  }

  for (const file of payload.skillFiles || []) {
    const p = join(workspaceHostPath, file);
    if (!existsSync(p)) missing.push(file);
  }

  for (const file of payload.workflowFiles || []) {
    const p = join(workspaceHostPath, file);
    if (!existsSync(p)) missing.push(file);
  }

  if (missing.length) {
    throw new Error(`워크스페이스 필수 문서 누락: ${missing.join(', ')}`);
  }
}

function listContainers() {
  if (!dockerExists()) return [];

  const { stdout } = run([
    'docker',
    'ps',
    '-a',
    '--format',
    '{{json .}}'
  ]);

  if (!stdout) return [];

  return stdout.split('\n').map((line) => {
    const row = JSON.parse(line) as {
      ID: string;
      Names: string;
      Image: string;
      State: string;
      Status: string;
      Ports: string;
      CreatedAt: string;
      Labels?: string;
    };

    const hostPortMatch = row.Ports?.match(/:(\d+)->/);
    const containerPortMatch = row.Ports?.match(/->(\d+)\//);

    return {
      id: row.ID,
      name: row.Names,
      image: row.Image,
      state: row.State,
      status: row.Status,
      ports: row.Ports,
      labels: row.Labels || '',
      hostPort: hostPortMatch ? Number(hostPortMatch[1]) : null,
      containerPort: containerPortMatch ? Number(containerPortMatch[1]) : null,
      createdAt: row.CreatedAt
    };
  });
}

const app = new Elysia()
  .get('/', () => Bun.file('web/index.html'))
  .get('/api/health', () => ({ ok: true, service: 'lamyclaw', docker: dockerExists() }))
  .get('/api/ports', ({ request, set }) => {
    try {
      ensureAuthorized(request);
      return {
        range: [MIN_PORT, MAX_PORT],
        used: [...getUsedPortsFromDocker()].sort((a, b) => a - b)
      };
    } catch (error) {
      if ((error as Error).message === 'UNAUTHORIZED') {
        set.status = 401;
        return { error: '인증 실패: x-api-token 또는 Authorization: Bearer 토큰이 필요합니다.' };
      }
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .get('/api/containers', ({ request, set }) => {
    try {
      ensureAuthorized(request);
      return { items: listContainers() };
    } catch (error) {
      if ((error as Error).message === 'UNAUTHORIZED') {
        set.status = 401;
        return { error: '인증 실패: x-api-token 또는 Authorization: Bearer 토큰이 필요합니다.' };
      }
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .post('/api/containers', ({ body, request, set }) => {
    try {
      ensureAuthorized(request);
    } catch (error) {
      set.status = 401;
      return { error: '인증 실패: x-api-token 또는 Authorization: Bearer 토큰이 필요합니다.' };
    }

    const payload = body as CreateContainerBody;

    if (!dockerExists()) {
      set.status = 503;
      return { error: 'docker가 설치되어 있지 않거나 실행 중이 아닙니다.' };
    }

    try {
      const { project, owner, name, labels } = buildContainerMeta(payload);
      const workspaceHostPath = resolveWorkspaceHostPath(payload, owner, project);
      verifyDocsInWorkspace(payload, workspaceHostPath);

      const hostPort = getNextPort(payload.hostPort);
      const containerPort = payload.containerPort ?? 3000;
      const image = payload.image ?? 'ghcr.io/anomalyco/opencode:latest';

      const args = [
        'docker',
        'create',
        '--name',
        name,
        '-p',
        `${hostPort}:${containerPort}`,
        '-v',
        `${workspaceHostPath}:/workspace`,
        '--workdir',
        '/workspace'
      ];

      for (const [k, v] of Object.entries(labels)) {
        args.push('--label', `${k}=${v}`);
      }

      if (payload.env) {
        for (const [k, v] of Object.entries(payload.env)) {
          args.push('-e', `${k}=${v}`);
        }
      }

      if (payload.volumes) {
        for (const vol of payload.volumes) {
          args.push('-v', `${vol.hostPath}:${vol.containerPath}${vol.readOnly ? ':ro' : ''}`);
        }
      }

      args.push(image);

      const { stdout: id } = run(args);
      try {
        run(['docker', 'start', id]);
        const requiredDocs = payload.requiredDocs?.length
          ? payload.requiredDocs
          : ['AGENTS.md', 'RULE.md', 'PERSONA.md'];
        run([
          'docker',
          'exec',
          id,
          'sh',
          '-lc',
          requiredDocs.map((f) => `test -f /workspace/${f}`).join(' && ')
        ]);
      } catch (runtimeError) {
        run(['docker', 'rm', '-f', id], true);
        throw runtimeError;
      }

      return {
        ok: true,
        id,
        name,
        project,
        owner,
        labels,
        workspaceHostPath,
        workspaceContainerPath: '/workspace',
        hostPort,
        containerPort
      };
    } catch (error) {
      set.status = 409;
      return { error: (error as Error).message };
    }
  })
  .post('/api/containers/:id/start', ({ params, request, set }) => {
    try {
      ensureAuthorized(request);
      run(['docker', 'start', params.id]);
      return { ok: true };
    } catch (error) {
      if ((error as Error).message === 'UNAUTHORIZED') {
        set.status = 401;
        return { error: '인증 실패: x-api-token 또는 Authorization: Bearer 토큰이 필요합니다.' };
      }
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .post('/api/containers/:id/stop', ({ params, request, set }) => {
    try {
      ensureAuthorized(request);
      run(['docker', 'stop', params.id]);
      return { ok: true };
    } catch (error) {
      if ((error as Error).message === 'UNAUTHORIZED') {
        set.status = 401;
        return { error: '인증 실패: x-api-token 또는 Authorization: Bearer 토큰이 필요합니다.' };
      }
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .post('/api/containers/:id/restart', ({ params, request, set }) => {
    try {
      ensureAuthorized(request);
      run(['docker', 'restart', params.id]);
      return { ok: true };
    } catch (error) {
      if ((error as Error).message === 'UNAUTHORIZED') {
        set.status = 401;
        return { error: '인증 실패: x-api-token 또는 Authorization: Bearer 토큰이 필요합니다.' };
      }
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .delete('/api/containers/:id', ({ params, request, set }) => {
    try {
      ensureAuthorized(request);
      run(['docker', 'rm', '-f', params.id]);
      return { ok: true };
    } catch (error) {
      if ((error as Error).message === 'UNAUTHORIZED') {
        set.status = 401;
        return { error: '인증 실패: x-api-token 또는 Authorization: Bearer 토큰이 필요합니다.' };
      }
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .get('/api/containers/:id/logs', ({ params, query, request, set }) => {
    try {
      ensureAuthorized(request);
      const tailRaw = Number((query as Record<string, unknown>).tail ?? 200);
      const tail = Number.isFinite(tailRaw) && tailRaw > 0 ? String(Math.floor(tailRaw)) : '200';
      const { stdout } = run(['docker', 'logs', '--tail', tail, params.id], true);
      return { id: params.id, logs: stdout };
    } catch (error) {
      if ((error as Error).message === 'UNAUTHORIZED') {
        set.status = 401;
        return { error: '인증 실패: x-api-token 또는 Authorization: Bearer 토큰이 필요합니다.' };
      }
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .listen(4300);

console.log(`lamyclaw running at http://localhost:${app.server?.port}`);
