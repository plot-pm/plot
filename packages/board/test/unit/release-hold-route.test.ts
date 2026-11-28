// `POST /api/release-hold` and `/api/release-hold-lift` validate the request,
// read the caller from the environment, and answer the hold or its refusal.
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { Readable } from 'node:stream';
import { answered } from '@plot-pm/domain';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { ReleaseHoldPersonRecord } from '@plot-pm/domain/entities/release-hold-person';
import type { ReleaseHoldPorts } from '@plot-pm/domain/workflows/release-hold';
import { handleReleaseHold, handleReleaseHoldLift, releaseHoldStatus } from '../../src/server/release-hold-route.js';

const HEAD = 'e150fd7c1'.padEnd(40, '0');
const AT = Date.parse('2026-11-26T20:31:00Z');

const releaseRow: PrIndexRow = {
  number: 3719, head: 'changeset-release/main', base: 'main', state: 'OPEN', draft: false,
  checks: 'green', review: '', url: 'u', headSha: HEAD, checksSha: HEAD, ciChecks: 'green',
};

const memoryPorts = () => {
  const writes: ReleaseHoldPersonRecord[] = [];
  let held: ReleaseHoldPersonRecord | null = null;
  const ports: ReleaseHoldPorts = {
    caller: 'person',
    who: 'jwloka',
    store: {
      read: async () => answered(held),
      write: async (record) => { held = record; writes.push(record); return answered(undefined); },
    },
    rows: async () => answered([releaseRow]),
    defaultBranchName: async () => answered('main'),
    checksWaitMs: 3_600_000,
    now: () => AT,
  };
  return { ports, writes };
};

const post = async (
  handle: typeof handleReleaseHold,
  payload: unknown,
  ports: ReleaseHoldPorts,
  env: NodeJS.ProcessEnv = {},
  headers: http.IncomingHttpHeaders = {},
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const req = Readable.from([JSON.stringify(payload)]) as unknown as http.IncomingMessage;
  req.headers = headers;
  req.method = 'POST';
  let status = 0;
  let text = '';
  const res = {
    writeHead(s: number) { status = s; return this; },
    end(chunk?: string) { text = chunk ?? ''; return this; },
  } as unknown as http.ServerResponse;
  await handle(req, res, { repoRoot: '/nowhere', port: 7777, ports, env });
  return { status, body: JSON.parse(text) as Record<string, unknown> };
};

describe('POST /api/release-hold', () => {
  it('writes the hold and answers 200 with its end', async () => {
    const { ports, writes } = memoryPorts();
    const answer = await post(handleReleaseHold, { sha: HEAD.slice(0, 9) }, ports);
    expect(answer).toEqual({
      status: 200,
      body: { ok: true, act: 'hold', pr: 3719, head: HEAD, at: '2026-11-26T20:31:00.000Z', end: '2026-11-26T21:31:00.000Z' },
    });
    expect(writes).toHaveLength(1);
  });

  it('refuses an unattended board with 403 and writes nothing', async () => {
    const { ports, writes } = memoryPorts();
    const answer = await post(handleReleaseHold, { sha: HEAD }, ports, { PLOT_UNATTENDED: '1' });
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ ok: false, reason: 'unattended' });
    expect(writes).toEqual([]);
  });

  it('answers 400 for a body without a hex sha and 403 for a cross-origin request', async () => {
    const { ports, writes } = memoryPorts();
    expect((await post(handleReleaseHold, { sha: 'main' }, ports)).status).toBe(400);
    expect((await post(handleReleaseHold, { sha: HEAD }, ports, {}, { origin: 'http://evil.example' })).status).toBe(403);
    expect(writes).toEqual([]);
  });
});

describe('POST /api/release-hold-lift', () => {
  it('lifts a hold on its head, and refuses 409 where nothing holds', async () => {
    const { ports, writes } = memoryPorts();
    expect((await post(handleReleaseHoldLift, { sha: HEAD }, ports)).body).toMatchObject({ ok: false, reason: 'nothing-held' });
    await post(handleReleaseHold, { sha: HEAD }, ports);
    const lifted = await post(handleReleaseHoldLift, { sha: HEAD }, ports);
    expect(lifted.status).toBe(200);
    expect(lifted.body).toMatchObject({ ok: true, act: 'lift', head: HEAD });
    expect(writes.map((w) => w.act)).toEqual(['hold', 'lift']);
  });

  it('refuses an unattended board with 403', async () => {
    const { ports } = memoryPorts();
    expect((await post(handleReleaseHoldLift, { sha: HEAD }, ports, { PLOT_UNATTENDED: '1' })).status).toBe(403);
  });
});

describe('releaseHoldStatus', () => {
  it.each([
    ['unattended', 403],
    ['unaskable', 500],
    ['head-moved', 409],
    ['already-held', 409],
    ['head-not-held', 409],
  ])('answers %s with %i', (reason, status) => expect(releaseHoldStatus(reason)).toBe(status));
});
