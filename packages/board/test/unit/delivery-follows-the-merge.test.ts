// `POST /api/deliver` re-asks the PR index and the host before it refuses a plan
// whose pulse reads a slice unmerged (#3472): PR #3467 merged at 18:51:16Z and
// the route refused for about 4 minutes while `plot-ask.mjs deliverable`
// answered `deliverable: true`.
//
// The pulse is injected through a mock of `fleet.js`; the plan file is parsed by
// the real `plot-plan-meta.sh`; the PR index and the host are fixtures, so no
// test spawns `plot-host.sh`. Every host double COUNTS its calls, because the
// two cheapest wrong implementations — always ask the host, never ask the
// store — both still answer `deliverable` and differ only in the count.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { hostFixture, planRecord, planStoreFixture } from '@plot-pm/domain/adapters';
import { PR_INDEX_VERSION, type Host, type MergedAnswer } from '@plot-pm/domain';
import type { PrIndex } from '@plot-pm/domain/entities/pr-index';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import type { DeliverabilityPorts } from '../../src/server/controllers/deliverability.js';
import { deliverability, handleDeliver } from '../../src/server/deliver.js';
import { rmTree } from '../helpers.mjs';

const pulse = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../src/server/fleet.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/server/fleet.js')>()),
  pulseFor: () => pulse.current,
  pulseCompleteFor: () => true,
  lastCompletePulseFor: () => pulse.current,
}));

const REAL_SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const SLUG = 'a-followed-plan';
const FILE = `2026-11-16-${SLUG}.md`;
const BRANCH = 'bug/a-followed-plan';

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmTree(d);
});

/** A pulse that reads `BRANCH` open, as the board's did while the PR index held a stale OPEN row. */
const stalePulse = () => ({
  main: 'main', head: 'abc1234', read_ref: 'abc1234', local_head: 'abc1234',
  plans: [{
    file: FILE, phase: 'approved',
    slices: [{ name: 'One', verdict: 'blocked', branches: [{
      branch: BRANCH, state: 'open', deferred: false, claimed: '', local_dirty: false, local_worktree: '',
    }] }],
  }],
  summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 0, blocked: 1, deferred: 0 },
});

const landedPulse = () => {
  const p = stalePulse();
  p.plans[0]!.slices[0]!.verdict = 'complete';
  p.plans[0]!.slices[0]!.branches[0]!.state = 'merged';
  return p;
};

const world = () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-follows-'));
  temps.push(parent);
  const repoRoot = path.join(parent, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  const file = path.join(repoRoot, 'docs/plans', FILE);
  fs.writeFileSync(file, [
    '# A followed plan', '', '## Status', '', '- **State:** Approved', '- **Type:** bug', '',
    '## Slices', '', '### One', '', `- \`${BRANCH}\` — a branch`, '', '## Changelog', '', '- a plan', '',
  ].join('\n'), 'utf8');
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });
  return { repoRoot, scriptsDir: REAL_SCRIPTS, file };
};

const store = (state: 'OPEN' | 'MERGED'): PrIndex => ({
  v: PR_INDEX_VERSION, connector: 'github', watermark: null, complete: true, at: '2026-11-16T18:46:04Z',
  rows: [{ number: 3467, head: BRANCH, state, draft: false, checks: 'none', review: '', url: '' }],
});

const prIndexOf = (held: PrIndex | null): PrIndexStore => ({
  location: async () => ({ ok: true, value: '/dev/null' }),
  read: async () => ({ ok: true, value: held }),
  write: async () => ({ ok: true, value: undefined }),
});

/** A host that answers `prMerged` as told, and records every `prMerged` it is asked. */
const countingHost = (answer: MergedAnswer, asked: string[]): Host => ({
  ...hostFixture({ merged: answer === 'merged' ? [BRANCH] : [] }),
  prMerged: async (branch: string) => {
    asked.push(branch);
    return { ok: true, value: answer };
  },
}) as Host;

const portsOf = (file: string, held: PrIndex | null, host: Host): DeliverabilityPorts => ({
  planStore: planStoreFixture({
    plans: [planRecord({
      file,
      slices: [{ name: 'One', branches: [{ branch: BRANCH, deferred: false, deferredReason: '', claimed: '', waitsOn: [] }] }],
    })],
  }),
  host,
  refs: { commitFiles: async () => ({ ok: true, value: [] }) } as never,
  prIndex: prIndexOf(held),
});

const post = async (w: ReturnType<typeof world>, ports: DeliverabilityPorts) => {
  const got = { status: 0, body: {} as Record<string, unknown> };
  const res = {
    headersSent: false,
    writeHead(status: number) { got.status = status; return this; },
    end(payload?: string) { got.body = payload ? JSON.parse(payload) : {}; return this; },
  } as unknown as http.ServerResponse;
  const req = Object.assign(Readable.from([JSON.stringify({ slug: SLUG })]), {
    headers: { host: 'localhost:7777', 'content-type': 'application/json' }, method: 'POST',
  }) as unknown as http.IncomingMessage;
  await handleDeliver(
    req, res,
    { repoRoot: w.repoRoot, scriptsDir: w.scriptsDir, host: 'localhost', port: 7777 },
    { config: (_o, key, fallback) => (key === 'Idea command' ? 'true' : fallback), ports },
  );
  return got;
};

describe('a delivery follows the merge', () => {
  it("a stale pulse delivers from the PR index's MERGED row", async () => {
    pulse.current = stalePulse();
    const w = world();
    const asked: string[] = [];
    const answer = await deliverability(w, SLUG, undefined, portsOf(w.file, store('MERGED'), countingHost('not-merged', asked)));
    expect(answer.verdict).toBe('deliverable');
    expect(asked).toEqual([]);
  });

  it('a stale pulse delivers once the host reads the branch merged', async () => {
    pulse.current = stalePulse();
    const w = world();
    const asked: string[] = [];
    const got = await post(w, portsOf(w.file, store('OPEN'), countingHost('merged', asked)));
    expect(got.status).toBe(202);
    expect(asked).toEqual([BRANCH]);
  });

  it('a branch the host reads open is named in the refusal', async () => {
    pulse.current = stalePulse();
    const w = world();
    const got = await post(w, portsOf(w.file, store('OPEN'), countingHost('not-merged', [])));
    expect(got.status).toBe(409);
    expect(got.body.reason).toBe('not-deliverable');
    expect(String(got.body.detail)).toContain(`the host reads open: \`${BRANCH}\``);
  });

  it('a host that cannot answer refuses merge-unconfirmed', async () => {
    pulse.current = stalePulse();
    const w = world();
    const got = await post(w, portsOf(w.file, null, countingHost('unknown', [])));
    expect(got.status).toBe(409);
    expect(got.body.reason).toBe('merge-unconfirmed');
    expect(got.body.reason).not.toBe('not-deliverable');
  });

  it('a landed pulse asks the host nothing', async () => {
    pulse.current = landedPulse();
    const w = world();
    const asked: string[] = [];
    const answer = await deliverability(w, SLUG, undefined, portsOf(w.file, store('OPEN'), countingHost('not-merged', asked)));
    expect(answer.verdict).toBe('deliverable');
    expect(asked).toEqual([]);
  });
});
