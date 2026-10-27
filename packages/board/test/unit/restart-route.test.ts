// `POST /api/restart`: what it refuses before it reaches the desk. The start
// itself is `packages/fleet/test/unit/restart-command.test.ts`'s assertion; the
// route is a thin caller, so this file holds only the request edge.
import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import { Readable } from 'node:stream';
import { handleRestart } from '../../src/server/restart.js';
import type { FleetReading } from '@plot-pm/domain';

const opts = { host: '127.0.0.1', port: 4399, repoRoot: '/nonexistent', scriptsDir: '/nonexistent' } as never;

const request = (body: unknown, headers: Record<string, string> = {}): http.IncomingMessage => {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = headers;
  req.method = 'POST';
  return req;
};

const response = () => {
  const out: { status: number; body: unknown } = { status: 0, body: null };
  const res = {
    writeHead(status: number) {
      out.status = status;
      return res;
    },
    end(text?: string) {
      out.body = text ? JSON.parse(text) : null;
    },
    headersSent: false,
  } as unknown as http.ServerResponse;
  return { res, out };
};

const pulse = {
  main: 'main',
  plans: [{ file: 'p.md', slices: [{ name: 's', branches: [{ branch: 'feature/no-desk', local_worktree: '', worker: 'elsewhere', worker_pid: '' }] }] }],
} as unknown as FleetReading;

describe('handleRestart', () => {
  it('refuses a cross-origin request with 403', async () => {
    const { res, out } = response();
    await handleRestart(request({ branch: 'feature/x' }, { origin: 'http://evil.example' }), res, opts, { pulse: () => pulse });
    expect(out.status).toBe(403);
  });

  it('refuses a missing branch with 400', async () => {
    const { res, out } = response();
    await handleRestart(request({}), res, opts, { pulse: () => pulse });
    expect(out.status).toBe(400);
  });

  it('refuses unknown-branch with 404 and names the reason', async () => {
    const { res, out } = response();
    await handleRestart(request({ branch: 'feature/nope' }), res, opts, { pulse: () => pulse });
    expect(out).toMatchObject({ status: 404, body: { ok: false, reason: 'unknown-branch', branch: 'feature/nope' } });
  });

  it('refuses no-worktree with 404 where the pulse lists the branch with no desk', async () => {
    const { res, out } = response();
    await handleRestart(request({ branch: 'feature/no-desk' }), res, opts, { pulse: () => pulse });
    expect(out).toMatchObject({ status: 404, body: { ok: false, reason: 'no-worktree' } });
  });
});
