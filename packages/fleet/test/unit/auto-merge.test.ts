// The merge tick: one passed slice PR merges per pass, and the memory of a host refusal holds.
import { describe, expect, it } from 'vitest';
import type { MergePorts } from '@plot-pm/domain/workflows/merge';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import { runLogFixture } from '@plot-pm/domain/adapters';
import { type ConversationHolds, mergeTick, type MergeRefusals } from '../../src/shared/auto-merge.js';

const TIP = 'c'.repeat(40);
const NOW = Date.parse('2026-10-30T12:00:00Z');
const WAIT = 3_600_000;

const head = (n: number): string => String(n).repeat(40).slice(0, 40);

const row = (n: number, over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: n,
  head: `feature/p${n}`,
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: head(n),
  checksSha: head(n),
  ciChecks: 'green',
  plotReview: 'success',
  plotReviewSha: head(n),
  plotReviewJudged: 'success',
  plotReviewCheckedSha: head(n),
  ...over,
});

const reading = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
  v: 1,
  branch: 'main',
  headSha: TIP,
  head: 'green',
  settled: { sha: TIP, state: 'green' },
  failingRuns: [],
  headSince: '2026-10-30T11:00:00Z',
  askedAt: '2026-10-30T11:55:00Z',
  at: '2026-10-30T11:55:00Z',
  ...over,
});

const readings = (over: Record<string, unknown> = {}) =>
  ({
    newestMerged: null,
    scope: { read: 'scope', sprint: {}, slugs: ['x'], branches: ['feature/p3', 'feature/p5'] },
    verdict: { read: 'absent' },
    defaultBranch: reading(),
    desk: { dead: false, why: 'live' },
    config: { autoReview: true, reviewBoundMs: 0, startBudget: 3, checksWaitMs: WAIT },
    now: NOW,
    ...over,
  }) as never;

const portsFor = (said: 'answered' | 'failed', conversations: Record<number, unknown> = {}) => {
  const calls: string[][] = [];
  const asked: number[] = [];
  const ports = {
    host: {
      backend: async () => ({ ok: true, value: 'github' }),
      prState: async (n: number) => ({
        ok: true,
        value: {
          number: n, repo: '', head: `feature/p${n}`, base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '',
          draft: false, mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [],
          url: '', author: '', headSha: head(n), checksSha: head(n),
        },
      }),
      prReview: async (n: number) => ({
        ok: true,
        value: { sha: head(n), state: 'success', description: '', time: '', bypass: false },
      }),
      reviewWriter: async () => ({ ok: true, value: '' }),
      prConversation: async (n: number) => {
        asked.push(n);
        return { ok: true, value: conversations[n] ?? { prAuthor: 'author', rows: [] } };
      },
    },
    scripts: {
      hostSaid: async (args: string[]) => {
        calls.push(args);
        return { answer: said, said: said === 'answered' ? '' : 'refused' };
      },
    },
    defaultBranch: { read: async () => ({ ok: true, value: reading() }) },
    refs: { remoteSha: async () => ({ ok: true, value: { sha: TIP } }), defaultBranch: async () => ({ ok: true, value: 'main' }) },
    checksWaitMs: WAIT,
    now: () => NOW,
    requireReading: true,
    caller: 'fleetd',
  } as unknown as MergePorts;
  return { ports, calls, asked };
};

const tick = (
  rows: PrIndexRow[],
  over: Record<string, unknown>,
  p: MergePorts,
  refused: MergeRefusals = new Map(),
  holds?: ConversationHolds,
) => mergeTick(rows, readings(over), p, refused, '/nowhere', () => false, undefined, undefined, undefined, holds);

describe('mergeTick', () => {
  it('merges exactly one of two mergeable PRs, the lower number', async () => {
    const { ports, calls } = portsFor('answered');
    const out = await tick([row(5), row(3)], {}, ports);
    expect(calls).toEqual([['pr-merge', '3', '--match-head', head(3)]]);
    expect(out.merged).toMatchObject({ pr: 3, result: { merged: true } });
  });

  it('merges nothing on a pass right after a merge: the tip moved, the reading did not refresh', async () => {
    const { ports, calls } = portsFor('answered');
    const out = await tick([row(5)], { newestMerged: { mergedAt: '2026-10-30T11:58:00Z' } }, ports);
    expect(calls).toEqual([]);
    expect(out.merged).toBeUndefined();
    expect(out.steps).toEqual([{ pr: 5, step: { step: 'hold', reason: 'merge-in-flight' } }]);
  });

  it('does not retry a host-refused merge at the same head, and tries the next PR', async () => {
    const { ports, calls } = portsFor('failed');
    const refused: MergeRefusals = new Map();
    await tick([row(3), row(5)], {}, ports, refused);
    expect(refused.get(3)).toBe(head(3));
    await tick([row(3), row(5)], {}, ports, refused);
    expect(calls.map((c) => c[1])).toEqual(['3', '5']);
  });

  it('retries once the head moves', async () => {
    const { ports, calls } = portsFor('failed');
    const refused: MergeRefusals = new Map([[3, 'f'.repeat(40)]]);
    await tick([row(3)], {}, ports, refused);
    expect(calls.map((c) => c[1])).toEqual(['3']);
  });

  describe('the merge decision reads the PR base', () => {
    const RED = reading({ head: 'red', settled: { sha: TIP, state: 'red' } });
    /** Ports whose own default-branch read is red, while the tick's selection read green. */
    const redAtMerge = (base: string) => {
      const { ports, calls } = portsFor('answered');
      const p = ports as unknown as { host: { prState: (n: number) => Promise<{ ok: true; value: Record<string, unknown> }> } };
      const prState = p.host.prState;
      return {
        calls,
        ports: {
          ...ports,
          host: { ...ports.host, prState: async (n: number) => { const out = await prState(n); return { ...out, value: { ...out.value, base } }; } },
          defaultBranch: { read: async () => ({ ok: true, value: RED }) },
        } as unknown as MergePorts,
      };
    };

    it('never merges a PR into the default branch past a red reading the merge reads', async () => {
      const { ports, calls } = redAtMerge('main');
      const out = await tick([row(3)], {}, ports);
      expect(calls).toEqual([]);
      expect(out.merged).toMatchObject({ pr: 3, result: { merged: false, reason: 'default-branch-red' } });
    });

    it('merges a PR into a sprint branch whatever the default branch reads at merge time', async () => {
      const { ports, calls } = redAtMerge('sprint/idle-and-supersede');
      const out = await tick([row(3)], {}, ports);
      expect(calls).toEqual([['pr-merge', '3', '--match-head', head(3)]]);
      expect(out.merged).toMatchObject({ pr: 3, result: { merged: true } });
    });
  });

  describe('a sprint PR on a red main', () => {
    const SPRINT = 'sprint/x';
    const RED = reading({ head: 'red', settled: { sha: TIP, state: 'red' } });
    const sprintRed = reading({ branch: SPRINT, head: 'red', settled: { sha: TIP, state: 'red' } });
    const sprintPorts = (base: DefaultBranchReading | null) => {
      const { ports, calls } = portsFor('answered');
      const prState = ports.host.prState;
      return {
        calls,
        ports: {
          ...ports,
          host: { ...ports.host, prState: async (n: number) => { const out = await prState(n); return { ...out, value: { ...out.value, base: SPRINT } }; } },
          defaultBranch: { read: async () => ({ ok: true, value: RED }) },
          baseBranch: () => ({ read: async () => ({ ok: true, value: base }) }),
        } as unknown as MergePorts,
      };
    };
    const over = (baseReading: DefaultBranchReading | null) => ({
      defaultBranch: RED,
      defaultBranchName: 'main',
      baseReadings: new Map([[SPRINT, baseReading]]),
    });

    it('selects the PR and merges it with the base file read', async () => {
      const { ports, calls } = sprintPorts(null);
      const out = await tick([row(3, { base: SPRINT })], over(null), ports);
      expect(calls).toEqual([['pr-merge', '3', '--match-head', head(3)]]);
      expect(out.merged).toMatchObject({ pr: 3, result: { merged: true } });
    });

    it('holds the PR on a fresh red base reading and does not call mergeAt', async () => {
      const { ports, calls } = sprintPorts(sprintRed);
      const out = await tick([row(3, { base: SPRINT })], over(sprintRed), ports);
      expect(calls).toEqual([]);
      expect(out.merged).toBeUndefined();
      expect(out.steps).toEqual([{ pr: 3, step: { step: 'hold', reason: 'base-branch-red' } }]);
    });

    it('refuses at merge time where the base turned red after selection', async () => {
      const { ports, calls } = sprintPorts(sprintRed);
      const out = await tick([row(3, { base: SPRINT })], over(null), ports);
      expect(calls).toEqual([]);
      expect(out.merged).toMatchObject({ pr: 3, result: { merged: false, reason: 'base-branch-red' } });
    });
  });

  it('merges nothing where Merger app is missing on GitHub', async () => {
    const { ports, calls } = portsFor('answered');
    await tick([row(3)], { backend: 'github', mergerApp: { read: 'absent' } }, ports);
    expect(calls).toEqual([]);
  });

  it('merges as app with a usable Merger app key on GitHub', async () => {
    const { ports, calls } = portsFor('answered');
    const out = await tick([row(3)], { backend: 'github', mergerApp: { read: 'usable' } }, ports);
    expect(calls).toEqual([['pr-merge', '3', '--match-head', head(3)]]);
    expect(out.merged).toMatchObject({ pr: 3, result: { merged: true } });
  });
});

describe('mergeTick reads the Merger app key again before a merge', () => {
  const recheckTick = (recheck: () => { read: 'usable' } | { read: 'invalid'; reason: string }, over: Record<string, unknown> = {}) => {
    const { ports, calls } = portsFor('answered');
    let rechecked = 0;
    const out = mergeTick([row(3)], readings({ backend: 'github', mergerApp: { read: 'usable' }, ...over }), ports, new Map(), '/nowhere', () => false, undefined, new Set(), () => {
      rechecked += 1;
      return recheck();
    });
    return { out, calls, rechecked: () => rechecked };
  };

  it('merges once the fresh reading still merges as the App', async () => {
    const run = recheckTick(() => ({ read: 'usable' }));
    expect((await run.out).merged).toMatchObject({ pr: 3, result: { merged: true } });
    expect(run.rechecked()).toBe(1);
  });

  it('merges nothing where the fresh reading no longer merges as the App', async () => {
    const run = recheckTick(() => ({ read: 'invalid', reason: 'key gone' }));
    expect((await run.out).merged).toBeUndefined();
    expect(run.calls).toEqual([]);
    expect(run.rechecked()).toBe(1);
  });

  it('reads no key again where no merge is picked, or the merge is not as the App', async () => {
    const held = recheckTick(() => ({ read: 'usable' }), { mergerApp: { read: 'absent' } });
    await held.out;
    expect(held.rechecked()).toBe(0);
    const host = recheckTick(() => ({ read: 'usable' }), { backend: 'bitbucket', mergerApp: undefined });
    await host.out;
    expect(host.rechecked()).toBe(0);
  });
});

describe('mergeTick action-log records', () => {
  const opts = () => ({ repoRoot: '/nowhere', scriptsDir: '/nowhere', runLog: runLogFixture() });

  it('logs one merge record naming the identity it merged as', async () => {
    const { ports } = portsFor('answered');
    const o = opts();
    await mergeTick([row(3)], readings({ backend: 'github', mergerApp: { read: 'usable' } }), ports, new Map(), '/nowhere', () => false, o);
    expect(o.runLog.lines).toEqual([
      { plan: '', branch: 'feature/p3', pr: '3', head: head(3), step: 'merge', outcome: 'merged as app', at: new Date(NOW).toISOString() },
    ]);
  });

  it('logs one merge record naming the host identity off GitHub', async () => {
    const { ports } = portsFor('answered');
    const o = opts();
    await mergeTick([row(3)], readings({}), ports, new Map(), '/nowhere', () => false, o);
    expect(o.runLog.lines).toEqual([
      { plan: '', branch: 'feature/p3', pr: '3', head: head(3), step: 'merge', outcome: 'merged as host', at: new Date(NOW).toISOString() },
    ]);
  });

  it('logs a failed merge attempt by its refusal reason', async () => {
    const { ports } = portsFor('failed');
    const o = opts();
    await mergeTick([row(3)], readings({}), ports, new Map(), '/nowhere', () => false, o);
    expect(o.runLog.lines).toEqual([
      { plan: '', branch: 'feature/p3', pr: '3', head: head(3), step: 'merge', outcome: 'failed: host-refused', at: new Date(NOW).toISOString() },
    ]);
  });

  it('logs a merge-hold once per PR, head and reason, and merges nothing', async () => {
    const { ports } = portsFor('answered');
    const o = opts();
    const logged = new Set<string>();
    await mergeTick([row(3)], readings({ backend: 'github', mergerApp: { read: 'absent' } }), ports, new Map(), '/nowhere', () => false, o, logged);
    await mergeTick([row(3)], readings({ backend: 'github', mergerApp: { read: 'absent' } }), ports, new Map(), '/nowhere', () => false, o, logged);
    expect(o.runLog.lines).toEqual([
      { plan: '', branch: 'feature/p3', pr: '3', head: 'feature/p3', step: 'merge-hold', outcome: 'merger-app-missing', at: new Date(NOW).toISOString() },
    ]);
  });

  it('logs nothing for a non-merger hold', async () => {
    const { ports } = portsFor('answered');
    const o = opts();
    await mergeTick([row(5)], readings({ newestMerged: { mergedAt: '2026-10-30T11:58:00Z' } }), ports, new Map(), '/nowhere', () => false, o);
    expect(o.runLog.lines).toEqual([]);
  });
});

describe('mergeTick on a red default branch', () => {
  const LAST_GREEN = 'e'.repeat(40);
  const FIRST_RED = 'f'.repeat(40);
  const REPAIR_BRANCH = `bug/main-repair-${LAST_GREEN.slice(0, 12)}`;
  const red = reading({ head: 'red', settled: { sha: TIP, state: 'red' } });
  const record = {
    v: 1, branch: 'main', state: 'repairing', lastGreenSha: LAST_GREEN, firstRedSha: FIRST_RED,
    redSince: '2026-10-30T10:00:00Z', candidates: [], rerun: 'asked', preRevertRerun: 'none', repairPr: 5,
    at: '2026-10-30T10:00:00Z',
  };

  const redPorts = (runs: 'failure' | 'success' = 'failure') => {
    const { ports, calls } = portsFor('answered');
    const asked: string[] = [];
    const base = ports as unknown as Record<string, unknown>;
    const host = base.host as Record<string, unknown>;
    const prState = host.prState as (n: number) => Promise<{ ok: true; value: Record<string, unknown> }>;
    const withRepairHead = {
      ...base,
      host: {
        ...host,
        prState: async (n: number) => {
          const out = await prState(n);
          return { ...out, value: { ...out.value, head: n === 5 ? REPAIR_BRANCH : out.value.head } };
        },
      },
      defaultBranch: { read: async () => ({ ok: true, value: red }) },
      refs: {
        remoteSha: async () => ({ ok: true, value: { sha: TIP } }),
        defaultBranch: async () => ({ ok: true, value: 'main' }),
        firstParentLine: async () => ({ ok: true, value: [TIP, FIRST_RED, LAST_GREEN] }),
      },
      repair: { read: async () => ({ ok: true, value: record }) },
      build: {
        runsForSha: async (branch: string, sha: string) => {
          asked.push(`${branch} ${sha}`);
          return { ok: true, value: [{ sha, status: 'completed', conclusion: runs, url: '', workflow: 'CI' }] };
        },
      },
      checks: ['CI'],
    } as unknown as MergePorts;
    return { ports: withRepairHead, calls, asked };
  };
  const rows = [row(3), row(5, { head: REPAIR_BRANCH })];
  const scope = { read: 'scope', sprint: {}, slugs: ['x'], branches: ['feature/p3'] };
  const redTick = (p: MergePorts) => tick(rows, { defaultBranch: red, scope }, p);

  it('picks the repair PR while every other open row holds default-branch-red', async () => {
    const { ports, calls } = redPorts();
    const out = await redTick(ports);
    expect(out.steps).toEqual([
      { pr: 3, step: { step: 'hold', reason: 'default-branch-red' } },
      { pr: 5, step: { step: 'merge', head: head(5) } },
    ]);
    expect(calls).toEqual([['pr-merge', '5', '--match-head', head(5)]]);
    expect(out.merged).toMatchObject({ pr: 5, result: { merged: true } });
  });

  it('asks the red commit’s runs once for the tick, not once per row', async () => {
    const { ports, asked } = redPorts();
    await redTick(ports);
    // The tick's one ask, plus mergeAt's own re-ask immediately before the merge.
    expect(asked).toEqual([`main ${TIP}`, `main ${TIP}`]);
  });

  it('merges nothing where the re-asked runs read green', async () => {
    const { ports, calls } = redPorts('success');
    const out = await redTick(ports);
    expect(out.steps[1]).toEqual({ pr: 5, step: { step: 'hold', reason: 'repair-red-unconfirmed' } });
    expect(calls).toEqual([]);
    expect(out.merged).toBeUndefined();
  });

  it('merges nothing where the record names no open row', async () => {
    const { ports, calls, asked } = redPorts();
    const out = await tick([row(3)], { defaultBranch: red, scope }, ports);
    expect(out.steps).toEqual([{ pr: 3, step: { step: 'hold', reason: 'default-branch-red' } }]);
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe('mergeTick — a PR held for an unanswered human comment', () => {
  const ASK = { prAuthor: 'author', rows: [{ kind: 'issue', id: 1, login: 'max', type: 'User', time: '2026-10-30T10:00:00Z', body: 'why MIT?' }] };
  const T0 = '2026-10-30T10:30:00Z';
  const stamp = (n: number, updatedAt: string, over: Partial<PrIndexRow> = {}) => row(n, { updatedAt, ...over });

  it('skips the held lower PR and merges the next candidate in the same pass', async () => {
    const { ports, calls } = portsFor('answered', { 3: ASK });
    const holds: ConversationHolds = new Map();
    const first = await tick([stamp(3, T0), stamp(5, T0)], {}, ports, new Map(), holds);
    // The first pass asks PR 3 and is refused; nothing merges until the next pass.
    expect(first.merged).toMatchObject({ pr: 3, result: { merged: false, reason: 'human-comment-open' } });
    expect(calls).toEqual([]);
    const second = await tick([stamp(3, T0), stamp(5, T0)], {}, ports, new Map(), holds);
    expect(calls).toEqual([['pr-merge', '5', '--match-head', head(5)]]);
    expect(second.merged).toMatchObject({ pr: 5, result: { merged: true } });
  });

  it('asks a held PR again only once its updatedAt or head moves', async () => {
    const { ports, asked } = portsFor('answered', { 3: ASK });
    const holds: ConversationHolds = new Map();
    await tick([stamp(3, T0)], {}, ports, new Map(), holds);
    expect(asked).toEqual([3]);
    await tick([stamp(3, T0)], {}, ports, new Map(), holds);
    expect(asked).toEqual([3]);
    await tick([stamp(3, '2026-10-30T11:00:00Z')], {}, ports, new Map(), holds);
    expect(asked).toEqual([3, 3]);
    const moved = stamp(3, '2026-10-30T11:00:00Z', { headSha: head(9), checksSha: head(9), plotReviewSha: head(9), plotReviewCheckedSha: head(9) });
    await tick([moved], {}, ports, new Map(), holds);
    expect(asked).toEqual([3, 3, 3]);
  });

  it('asks once, not every tick, when only a marked Plot comment moved updatedAt', async () => {
    // Plot's own marked comment is the newest row and moves updatedAt past the human comment's time.
    const marked = { ...ASK, rows: [...ASK.rows, { kind: 'issue', id: 2, login: 'plot', type: 'User', time: '2026-10-30T11:30:00Z', body: '<!-- plot-review -->' }] };
    const { ports, asked } = portsFor('answered', { 3: marked });
    const holds: ConversationHolds = new Map();
    const updated = '2026-10-30T11:30:05Z';
    await tick([stamp(3, updated)], {}, ports, new Map(), holds);
    await tick([stamp(3, updated)], {}, ports, new Map(), holds);
    await tick([stamp(3, updated)], {}, ports, new Map(), holds);
    expect(asked).toEqual([3]);
  });

  it('holds an unread conversation on the row’s own updatedAt', async () => {
    const { ports, asked } = portsFor('answered');
    // PR 3 has no entry; make its read fail by overriding the host.
    (ports.host as unknown as { prConversation: unknown }).prConversation = async (n: number) => { asked.push(n); return { ok: false, why: 'failed' }; };
    const holds: ConversationHolds = new Map();
    const out = await tick([stamp(3, T0)], {}, ports, new Map(), holds);
    expect(out.merged).toMatchObject({ result: { merged: false, reason: 'human-comment-unread' } });
    await tick([stamp(3, T0)], {}, ports, new Map(), holds);
    expect(asked).toEqual([3]);
    expect(holds.get(3)).toEqual({ head: head(3), at: new Date(T0).toISOString() });
  });
});
