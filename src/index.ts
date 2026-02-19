import { Elysia } from 'elysia';

type CreateContainerBody = {
  name: string;
  image?: string;
  hostPort?: number;
  containerPort?: number;
  env?: Record<string, string>;
  volumes?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
};

const MIN_PORT = 30000;
const MAX_PORT = 39999;

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
    if (used.has(preferred)) throw new Error(`요청 포트 ${preferred} 는 이미 사용 중입니다.`);
    return preferred;
  }

  for (let p = MIN_PORT; p <= MAX_PORT; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error('사용 가능한 포트가 없습니다.');
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
      hostPort: hostPortMatch ? Number(hostPortMatch[1]) : null,
      containerPort: containerPortMatch ? Number(containerPortMatch[1]) : null,
      createdAt: row.CreatedAt
    };
  });
}

const app = new Elysia()
  .get('/', () => Bun.file('web/index.html'))
  .get('/api/health', () => ({ ok: true, service: 'lamyclaw', docker: dockerExists() }))
  .get('/api/ports', () => ({
    range: [MIN_PORT, MAX_PORT],
    used: [...getUsedPortsFromDocker()].sort((a, b) => a - b)
  }))
  .get('/api/containers', () => ({ items: listContainers() }))
  .post('/api/containers', ({ body, set }) => {
    const payload = body as CreateContainerBody;
    if (!payload?.name) {
      set.status = 400;
      return { error: 'name은 필수입니다.' };
    }

    if (!dockerExists()) {
      set.status = 503;
      return { error: 'docker가 설치되어 있지 않거나 실행 중이 아닙니다.' };
    }

    try {
      const hostPort = getNextPort(payload.hostPort);
      const containerPort = payload.containerPort ?? 3000;
      const image = payload.image ?? 'opencode:latest';

      const args = ['docker', 'create', '--name', payload.name, '-p', `${hostPort}:${containerPort}`];

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
      run(['docker', 'start', id]);

      return { ok: true, id, hostPort, containerPort };
    } catch (error) {
      set.status = 409;
      return { error: (error as Error).message };
    }
  })
  .post('/api/containers/:id/start', ({ params, set }) => {
    try {
      run(['docker', 'start', params.id]);
      return { ok: true };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .post('/api/containers/:id/stop', ({ params, set }) => {
    try {
      run(['docker', 'stop', params.id]);
      return { ok: true };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .post('/api/containers/:id/restart', ({ params, set }) => {
    try {
      run(['docker', 'restart', params.id]);
      return { ok: true };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .delete('/api/containers/:id', ({ params, set }) => {
    try {
      run(['docker', 'rm', '-f', params.id]);
      return { ok: true };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .get('/api/containers/:id/logs', ({ params, query, set }) => {
    try {
      const tail = String((query as Record<string, unknown>).tail ?? '200');
      const { stdout } = run(['docker', 'logs', '--tail', tail, params.id], true);
      return { id: params.id, logs: stdout };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  })
  .listen(4300);

console.log(`lamyclaw running at http://localhost:${app.server?.port}`);
