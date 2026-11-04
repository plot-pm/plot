// `POST /api/needs-design` starts the bundle through the `Detached` port, and the
// bundle refuses under `PLOT_UNATTENDED=1` before it reads anything.
import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import type { Detached } from '@plot-pm/domain';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { planStoreFixture } from '@plot-pm/domain/adapters/plan-store/plan-store-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import type { PortResult } from '@plot-pm/domain';
import type { PlanStore, PlanRecord } from '@plot-pm/domain/ports/plan-store';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { handleNeedsDesign } from '../../src/server/needs-design.js';
import { perform, type Context } from '../../src/server/entry/needs-design.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const BUNDLE = path.join(SCRIPTS, 'board/plot-needs-design.mjs');

const made: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

const repo = (): string => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-needs-design-route-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const post = async (dir: string, payload: unknown, detached: Detached): Promise<{ status: number; body: Record<string, unknown> }> => {
  const req = Readable.from([JSON.stringify(payload)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  let status = 0;
  let text = '';
  const res = {
    headersSent: false,
    writeHead(s: number) {
      status = s;
      return this;
    },
    end(chunk?: string) {
      text = chunk ?? '';
      return this;
    },
  } as unknown as http.ServerResponse;
  await handleNeedsDesign(req, res, { repoRoot: dir, scriptsDir: SCRIPTS, host: 'localhost', port: 7777, detached });
  return { status, body: JSON.parse(text) as Record<string, unknown> };
};

describe('POST /api/needs-design', () => {
  it('starts the bundle for the slug and answers 202 with the log', async () => {
    const dir = repo();
    const calls: { script: string; args: readonly string[]; cwd: string; log: string }[] = [];
    const detached: Detached = {
      node: (script, args, cwd, log) => {
        calls.push({ script, args, cwd, log });
        return { pid: 1, exitCode: () => null };
      },
    };
    const answer = await post(dir, { slug: 'a-draft-to-design', who: 'jwloka' }, detached);
    assert.equal(answer.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].script, BUNDLE);
    assert.deepEqual(calls[0].args, ['a-draft-to-design', '--channel', 'board', '--who', 'jwloka']);
    assert.equal(calls[0].cwd, dir);
    assert.equal(answer.body.log, calls[0].log);
  });

  it('tells the bundle its channel is board, with or without a who', async () => {
    const calls: (readonly string[])[] = [];
    const detached: Detached = {
      node: (_script, args) => {
        calls.push(args);
        return { pid: 1, exitCode: () => null };
      },
    };
    const answer = await post(repo(), { slug: 'a-draft-to-design' }, detached);
    assert.equal(answer.status, 202);
    assert.deepEqual(calls, [['a-draft-to-design', '--channel', 'board']]);
  });

  it('refuses a body without a plan slug and starts nothing', async () => {
    let started = 0;
    const detached: Detached = {
      node: () => {
        started += 1;
        return { pid: 1, exitCode: () => null };
      },
    };
    const answer = await post(repo(), { slug: '../etc' }, detached);
    assert.equal(answer.status, 400);
    assert.equal(started, 0);
  });
});

describe('plot-needs-design.mjs under PLOT_UNATTENDED=1', () => {
  it.skipIf(!fs.existsSync(BUNDLE))('refuses with exit 1 and names the reason', () => {
    const dir = repo();
    const run = spawnSync(process.execPath, [BUNDLE, 'a-draft-to-design'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PLOT_UNATTENDED: '1' },
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /a person moves a plan to Design/);
  });
});

describe('perform — an open PR the host named with no head commit is named, not silently dropped', () => {
  const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });
  const SLUG = 'a-plan';

  /** A `Scripts` stub answering only the `## Plot Config` keys this path reaches. */
  const scriptsStub = (): Scripts => ({
    config: async (key, fallback) => answered(({
      'Plan directory': 'docs/plans/',
      'Active index': 'docs/plans/active/',
    })[key] ?? fallback),
  } as unknown as Scripts);

  /** A `Trees` stub: `originHead` answers so `resolveMain` never asks the host. */
  const treesStub = (): Trees => ({
    originHead: async () => answered('main'),
    fetch: async () => answered(undefined),
    userName: async () => answered('jwloka'),
  } as unknown as Trees);

  /** A plan not in the checkout and not on the default branch; the only open PR is own-repo but carries no `headSha` — the shape that previously made `openPrsOf` drop it and report "no plan found". */
  const ctxUnreadOpenPr = (): Context => ({
    repoRoot: '/repo',
    scriptDir: '/repo/skills/plot/scripts',
    host: hostFixture({
      prs: [{
        number: 975, repo: '', head: `idea/batch-${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
        draft: false, mergeable: 'unknown', review: 'none', checks: 'unknown', failingChecks: [],
        url: '', author: '',
      }],
    }),
    planStore: planStoreFixture({ files: {} }),
    refs: refsFixture(),
    scripts: scriptsStub(),
    trees: treesStub(),
  });

  it('names the unread PR in the plan-not-found refusal', async () => {
    const ctx = ctxUnreadOpenPr();

    let message = '';
    try {
      await perform(ctx, { who: 'jwloka', slug: SLUG, channel: 'board' }, () => {}, () => {});
      assert.fail('expected perform() to throw Refused');
    } catch (err) {
      message = (err as Error).message;
    }

    assert.match(message, /no plan found/);
    assert.match(message, /#975/);
    assert.match(message, /the host named no head commit/);
  });
});

describe('perform — two open PRs changing the plan file', () => {
  const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });
  const SLUG = 'a-plan';
  const PLAN_FILE = `docs/plans/${SLUG}.md`;
  const HEAD = 'a'.repeat(40);
  const RIVAL_HEAD = 'b'.repeat(40);
  const PLAN_TEXT = '# P\n\n## Status\n\n- **State:** Draft\n- **Review:** pr\n- **Impl:** own branches\n';
  const RIVAL_TEXT = '# P (rival copy)\n\n## Status\n\n- **State:** Draft\n- **Review:** pr\n- **Impl:** own branches\n';

  /** A `Scripts` stub answering only the `## Plot Config` keys this path reaches. */
  const scriptsStub = (): Scripts => ({
    config: async (key, fallback) => answered(({
      'Plan directory': 'docs/plans/',
      'Active index': 'docs/plans/active/',
    })[key] ?? fallback),
  } as unknown as Scripts);

  /** A `Trees` stub: `originHead` answers so `resolveMain` never asks the host. */
  const treesStub = (): Trees => ({
    originHead: async () => answered('main'),
    fetch: async () => answered(undefined),
    userName: async () => answered('jwloka'),
  } as unknown as Trees);

  /**
   * `readPlanAt` writes the shown text to a scratch path it names itself (a
   * random temp directory plus the file's basename) and reads it back through
   * `planStore.readPlan`. A fixture keyed by the real plan path cannot predict
   * that scratch path, so this resolves any path by basename instead.
   */
  const planStoreResolvingByBasename = (plan: PlanRecord): PlanStore => {
    const base = planStoreFixture({ files: {} });
    const basename = plan.file.slice(plan.file.lastIndexOf('/') + 1);
    return {
      ...base,
      readPlan: async (file) => (file.endsWith(`/${basename}`) || file === basename ? answered(plan) : base.readPlan(file)),
    };
  };

  const planRecordFor = (file: string): PlanRecord => ({
    file,
    format: 'canonical',
    phase: 'draft',
    phaseRaw: 'Draft',
    type: '',
    title: '',
    sprint: '',
    story: '',
    assignee: '',
    branches: [],
    prs: [],
    deferredPrs: [],
    slices: [],
    review: 'pr',
    impl: 'own-branches',
    approvedRaw: '',
    spikeApprovedRaw: '',
    deliveredRaw: '',
    releasedRaw: '',
    startedRaw: [],
    rejectedRaw: '',
    unreadBranchItems: [],
  });

  /** No `idea/<slug>` PR; two open PRs each add the plan file (the open route), with differing copies. */
  const ctxTwoOpenPrs = (): Context => ({
    repoRoot: '/repo',
    scriptDir: '/repo/skills/plot/scripts',
    host: hostFixture({
      prs: [
        {
          number: 50, repo: '', head: `idea/batch-${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
          draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
          url: '', author: '', headSha: HEAD,
        },
        {
          number: 51, repo: '', head: `idea/batch2-${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
          draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
          url: '', author: '', headSha: RIVAL_HEAD,
        },
      ],
    }),
    planStore: planStoreResolvingByBasename(planRecordFor(PLAN_FILE)),
    refs: refsFixture({
      shas: { [`${HEAD}^{commit}`]: HEAD, [`${RIVAL_HEAD}^{commit}`]: RIVAL_HEAD },
      changedFiles: { [HEAD]: [PLAN_FILE], [RIVAL_HEAD]: [PLAN_FILE] },
      files: { [`${HEAD}:${PLAN_FILE}`]: PLAN_TEXT, [`${RIVAL_HEAD}:${PLAN_FILE}`]: RIVAL_TEXT },
    }),
    scripts: scriptsStub(),
    trees: treesStub(),
  });

  it('refuses pr-copies-differ, naming the rival', async () => {
    const ctx = ctxTwoOpenPrs();

    let message = '';
    try {
      await perform(ctx, { who: 'jwloka', slug: SLUG, channel: 'board' }, () => {}, () => {});
      assert.fail('expected perform() to throw Refused');
    } catch (err) {
      message = (err as Error).message;
    }

    assert.match(message, /differs between the plan PR/);
    assert.match(message, /#51/);
  });
});
