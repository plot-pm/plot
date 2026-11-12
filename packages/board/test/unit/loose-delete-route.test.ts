// `POST /api/loose-delete`: what it refuses at the request edge, and that a
// refusal reaches the wire by name. The delete itself is
// `packages/fleet/test/unit/loose-delete-command.test.ts`'s assertion.
import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import { Readable } from 'node:stream';
import { handleLooseDelete } from '../../src/server/loose-delete.js';
import type { LooseDeletePorts } from '@plot-pm/fleet/shared/loose-delete-command';

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

const TIP = 'c'.repeat(40);
const ports = (prOpen: boolean, calls: string[]): LooseDeletePorts =>
  ({
    host: {
      prState: async () => ({ ok: true, value: prOpen ? { number: 9, state: 'OPEN' } : null }),
      prMerged: async () => ({ ok: true, value: 'not-merged' }),
    },
    refs: { resolve: async () => ({ ok: true, value: TIP }), remoteSha: async () => ({ ok: true, value: { sha: TIP } }) },
    trees: {
      forBranch: async () => ({ ok: true, value: null }),
      unpushedCommits: async () => ({ ok: true, value: [] }),
      deleteRemoteBranch: async () => {
        calls.push('delete');
        return { ok: true, value: undefined };
      },
    },
    pinnedTips: {
      pin: async (b: string, s: string) => {
        calls.push('pin');
        return { ok: true, value: `refs/plot/reaped/${b}/${s}` };
      },
      prune: async () => ({ ok: true, value: [] }),
    },
  }) as unknown as LooseDeletePorts;

describe('handleLooseDelete', () => {
  it('refuses an unattended caller with 403 and deletes nothing', async () => {
    const calls: string[] = [];
    const { res, out } = response();
    await handleLooseDelete(request({ branch: 'feature/x' }), res, opts, { ports: ports(false, calls), caller: 'unattended' });
    expect(out).toMatchObject({ status: 403, body: { ok: false, reason: 'unattended' } });
    expect(calls).toEqual([]);
  });

  it('refuses a cross-origin request with 403', async () => {
    const { res, out } = response();
    await handleLooseDelete(request({ branch: 'feature/x' }, { origin: 'http://evil.example' }), res, opts);
    expect(out.status).toBe(403);
  });

  it('refuses a missing branch with 400', async () => {
    const { res, out } = response();
    await handleLooseDelete(request({}), res, opts);
    expect(out.status).toBe(400);
  });

  it('answers an open PR as a named 409 and deletes nothing', async () => {
    const calls: string[] = [];
    const { res, out } = response();
    await handleLooseDelete(request({ branch: 'feature/x' }), res, opts, { ports: ports(true, calls), caller: 'person' });
    expect(out).toMatchObject({ status: 409, body: { ok: false, branch: 'feature/x', reason: 'open-pr' } });
    expect(calls).toEqual([]);
  });

  it('answers a delete with the tip and the pin', async () => {
    const calls: string[] = [];
    const { res, out } = response();
    await handleLooseDelete(request({ branch: 'feature/x' }), res, opts, { ports: ports(false, calls), caller: 'person' });
    expect(out).toMatchObject({ status: 200, body: { ok: true, tip: TIP, pin: `refs/plot/reaped/feature/x/${TIP}` } });
    expect(calls).toEqual(['pin', 'delete']);
  });
});
