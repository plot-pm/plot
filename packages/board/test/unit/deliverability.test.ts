// `deliverabilityOf` reads the PR store first, and asks the host only for what
// the store cannot answer — the fix for bug #1165: a 12-slice plan on
// Bitbucket sent ~60 host requests, and a 429 among them was misread as "not
// merged", wrongly refusing delivery of a finished plan.
//
// **THE HOST FIXTURE THROWS, NOT COUNTS.** A double that answered and let the
// test read a counter afterwards would pass even if the implementation asked
// it and discarded the answer — the claim under test is that the store path
// asks the host NOTHING, and a throwing double is the only fixture a naive
// "read the store, then ask the host anyway" implementation cannot survive.
//
// **NO SERVER AND NO BROWSER.** The controller takes ports and the domain
// takes values, so this file needs neither a scratch repo nor real git.
import { describe, it, expect } from 'vitest';
import { hostFixture, planRecord, planStoreFixture } from '@plot-pm/domain/adapters';
import { PR_INDEX_VERSION, type Host } from '@plot-pm/domain';
import type { PrIndex, PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';

import {
  deliverabilityOf,
  type DeliverabilityPorts,
} from '../../src/server/controllers/deliverability.js';

const FILE = 'docs/plans/x.md';
const SLUG = 'x';

/** A terminal `MERGED` row for a branch, numbered for a stable sort. */
const mergedRow = (number: number, head: string): PrIndexRow => ({
  number,
  head,
  state: 'MERGED',
  draft: false,
  checks: 'none',
  review: '',
  url: '',
});

/** An `OPEN` row — never trusted without asking the host. */
const openRow = (number: number, head: string): PrIndexRow => ({
  number,
  head,
  state: 'OPEN',
  draft: false,
  checks: 'none',
  review: '',
  url: '',
});

const store = (rows: readonly PrIndexRow[]): PrIndex => ({
  v: PR_INDEX_VERSION,
  connector: 'github',
  watermark: null,
  complete: true,
  at: '2026-10-08T00:00:00Z',
  rows,
});

/** A `PrIndexStore` that answers one connector from a fixed index, or `null`. */
const prIndexFixture = (held: PrIndex | null): PrIndexStore => ({
  location: async () => ({ ok: true, value: '/dev/null' }),
  read: async () => ({ ok: true, value: held }),
  write: async () => ({ ok: true, value: undefined }),
});

/** A `PrIndexStore` whose read fails outright — the unparseable/wrong-version case. */
const failingPrIndex = (): PrIndexStore => ({
  location: async () => ({ ok: true, value: '/dev/null' }),
  read: async () => ({ ok: false, why: 'failed' }),
  write: async () => ({ ok: true, value: undefined }),
});

/** A `Host` that throws on every call — proof the store path asks it nothing. */
const throwingHost = (): Host => {
  const boom = () => {
    throw new Error('the host must not be asked');
  };
  return {
    backend: async () => ({ ok: true, value: 'github' }),
    account: boom,
    prState: boom,
    prMerged: boom,
    prMergeCommit: boom,
    prCreate: boom,
    prList: boom,
    limit: boom,
    observe: boom,
    lastRefusal: () => null,
  } as unknown as Host;
};

/**
 * `throwingHost` with `prMergeCommit` answered.
 *
 * `carriedWorkOf` calls `prMergeCommit` unconditionally for every merged,
 * non-deferred branch — regardless of whether `merged` came from the store or
 * the host, by the brief's own instruction (`deliverability.ts:175`). The
 * "zero host calls" claim this file tests is about `prMerged` only; a host
 * that threw on `prMergeCommit` too would fail every merged-branch test for a
 * call the fix never promised to remove.
 */
const throwingHostExceptMergeCommit = (): Host => ({
  ...throwingHost(),
  prMergeCommit: async () => ({ ok: true, value: '' }),
});

const plan = (branches: readonly string[]) =>
  planRecord({
    file: FILE,
    slices: [
      {
        name: 'one',
        branches: branches.map((branch) => ({
          branch,
          deferred: false,
          deferredReason: '',
          claimed: '',
          waitsOn: [],
        })),
      },
    ],
  });

const ports = (plans: ReturnType<typeof plan>[], host: Host, prIndex: PrIndexStore): DeliverabilityPorts => ({
  planStore: planStoreFixture({ plans }),
  host,
  refs: { commitFiles: async () => ({ ok: true, value: [] }) } as never,
  prIndex,
});

describe('deliverabilityOf refuses a plan with an unread branch item', () => {
  // Models ewz-kus-portal plan 3853: one branch the claim grammar reads
  // (merged), and one foreign-repository branch named only in a non-claim
  // list item. Before this wave, `deliverabilityOf` never read
  // `unreadBranchItems` and answered `deliverable: true`.
  it('refuses as slices-unread even though the one claimed branch merged', async () => {
    const p: DeliverabilityPorts = {
      planStore: planStoreFixture({
        plans: [
          planRecord({
            file: FILE,
            slices: [
              {
                name: 'one',
                branches: [
                  { branch: 'feature/a', deferred: false, deferredReason: '', claimed: '', waitsOn: [] },
                ],
              },
            ],
            unreadBranchItems: [
              { wave: 'one', branch: 'feature/other-repo', line: '- feature/other-repo: pending' },
            ],
          }),
        ],
      }),
      host: throwingHostExceptMergeCommit(),
      refs: { commitFiles: async () => ({ ok: true, value: [] }) } as never,
      prIndex: prIndexFixture(store([mergedRow(1, 'feature/a')])),
    };

    const answer = await deliverabilityOf(p, SLUG, FILE);

    expect(answer.deliverable).toBe(false);
    expect(answer.reason).toBe('slices-unread');
    expect(answer.refusal).toContain('feature/other-repo');
  });
});

describe('deliverabilityOf reads the PR store before the host', () => {
  it('is deliverable with zero host calls when the store holds every branch MERGED', async () => {
    const branches = Array.from({ length: 12 }, (_, i) => `feature/slice-${i}`);
    const rows = branches.map((branch, i) => mergedRow(i + 1, branch));
    const p = ports([plan(branches)], throwingHostExceptMergeCommit(), prIndexFixture(store(rows)));

    const answer = await deliverabilityOf(p, SLUG, FILE);

    expect(answer.deliverable).toBe(true);
    expect(answer.merged).toBe(12);
  });

  it('refuses as cannot-tell, naming the confirmed count, when the host answers unknown for one branch', async () => {
    const branches = Array.from({ length: 12 }, (_, i) => `feature/slice-${i}`);
    const rows = branches.slice(0, 11).map((branch, i) => mergedRow(i + 1, branch));
    const unresolved = branches[11];
    const host: Host = {
      ...throwingHost(),
      prMerged: async (branch: string) =>
        branch === unresolved
          ? ({ ok: false, why: 'failed' } as const)
          : (() => {
              throw new Error('only the unresolved branch should be asked');
            })(),
    };
    const p = ports([plan(branches)], host, prIndexFixture(store(rows)));

    const answer = await deliverabilityOf(p, SLUG, FILE);

    expect(answer.deliverable).toBe(false);
    expect(answer.reason).toBe('cannot-tell');
    expect(answer.merged).toBe(11);
    expect(answer.refusal).toContain(unresolved);
  });

  it('does not refuse as cannot-tell for a deferred branch the host cannot answer', async () => {
    const owed = 'feature/owed';
    const parked = 'feature/parked';
    const host: Host = {
      ...throwingHostExceptMergeCommit(),
      prMerged: async (branch: string) =>
        branch === parked
          ? ({ ok: true, value: 'unknown' } as const)
          : ({ ok: true, value: 'merged' } as const),
    };
    const deferredPlan = planRecord({
      file: FILE,
      slices: [
        {
          name: 'one',
          branches: [
            { branch: owed, deferred: false, deferredReason: '', claimed: '', waitsOn: [] },
            { branch: parked, deferred: true, deferredReason: 'later', claimed: '', waitsOn: [] },
          ],
        },
      ],
    });
    const p = ports([deferredPlan], host, prIndexFixture(null));

    const answer = await deliverabilityOf(p, SLUG, FILE);

    expect(answer.reason).not.toBe('cannot-tell');
    expect(answer.deliverable).toBe(true);
    expect(answer.merged).toBe(1);
    expect(answer.deferred).toBe(1);
  });

  it('asks the host when the stored row is OPEN, giving the host the last word', async () => {
    const branch = 'feature/reopened';
    const host: Host = {
      ...throwingHostExceptMergeCommit(),
      prMerged: async () => ({ ok: true, value: 'merged' }),
    };
    const p = ports([plan([branch])], host, prIndexFixture(store([openRow(1, branch)])));

    const answer = await deliverabilityOf(p, SLUG, FILE);

    expect(answer.deliverable).toBe(true);
    expect(answer.merged).toBe(1);
  });

  it('asks the host when the store holds no store at all', async () => {
    const branch = 'feature/no-store';
    const host: Host = {
      ...throwingHostExceptMergeCommit(),
      prMerged: async () => ({ ok: true, value: 'merged' }),
    };
    const p = ports([plan([branch])], host, prIndexFixture(null));

    const answer = await deliverabilityOf(p, SLUG, FILE);

    expect(answer.deliverable).toBe(true);
    expect(answer.merged).toBe(1);
  });

  it('asks the host when the store holds no row for this branch', async () => {
    const branch = 'feature/missing-row';
    const host: Host = {
      ...throwingHostExceptMergeCommit(),
      prMerged: async () => ({ ok: true, value: 'merged' }),
    };
    const p = ports([plan([branch])], host, prIndexFixture(store([mergedRow(1, 'feature/other')])));

    const answer = await deliverabilityOf(p, SLUG, FILE);

    expect(answer.deliverable).toBe(true);
    expect(answer.merged).toBe(1);
  });

  it('asks the host when the store read fails outright (unparseable or wrong version)', async () => {
    const branch = 'feature/wrong-version';
    const host: Host = {
      ...throwingHostExceptMergeCommit(),
      prMerged: async () => ({ ok: true, value: 'merged' }),
    };
    const p = ports([plan([branch])], host, failingPrIndex());

    const answer = await deliverabilityOf(p, SLUG, FILE);

    expect(answer.deliverable).toBe(true);
    expect(answer.merged).toBe(1);
  });
});

describe('deliverabilityOf reads the commits a slice names', () => {
  /** A plan whose slices each name branch, commits and deferral. */
  const commitPlan = (
    lines: readonly { branch: string; commits?: readonly string[]; deferred?: boolean }[],
  ) =>
    planRecord({
      file: FILE,
      slices: [
        {
          name: 'one',
          branches: lines.map((l) => ({
            branch: l.branch,
            deferred: l.deferred ?? false,
            deferredReason: '',
            claimed: '',
            waitsOn: [],
            ...(l.commits ? { commits: l.commits } : {}),
          })),
        },
      ],
    });

  /** Refs that hold exactly the commits in `onDefault`; every other commit is absent. */
  const refsHolding = (onDefault: readonly string[], asked: string[] = []) =>
    ({
      commitFiles: async () => ({ ok: true, value: ['src/work.ts'] }),
      defaultBranch: async () => ({ ok: true, value: 'main' }),
      contains: async (ancestor: string, descendant: string) => {
        asked.push(`${ancestor} in ${descendant}`);
        return { ok: true, value: onDefault.includes(ancestor) ? 'yes' : 'no' };
      },
    }) as never;

  /** A host that answers "merged" for these heads only. */
  const hostMerging = (heads: readonly string[]): Host =>
    ({
      ...throwingHost(),
      prMerged: async (branch: string) => ({ ok: true, value: heads.includes(branch) ? 'merged' : 'not-merged' }),
      prMergeCommit: async () => ({ ok: true, value: '' }),
    }) as unknown as Host;

  const withRefs = (
    p: ReturnType<typeof commitPlan>,
    refs: never,
    host: Host = throwingHost(),
  ): DeliverabilityPorts => ({
    planStore: planStoreFixture({ plans: [p] }),
    host,
    refs,
    prIndex: prIndexFixture(null),
  });

  it('is deliverable when every named commit is on the default branch, and asks the host nothing', async () => {
    const asked: string[] = [];
    const p = withRefs(
      commitPlan([{ branch: 'docs/foo', commits: ['abc1234', 'def5678'] }]),
      refsHolding(['abc1234', 'def5678'], asked),
    );
    const answer = await deliverabilityOf(p, SLUG, FILE);
    expect(answer.deliverable).toBe(true);
    expect(answer.merged).toBe(1);
    expect(asked).toEqual(['abc1234 in origin/main', 'def5678 in origin/main']);
  });

  it('keeps the slice open when one named commit is not on the default branch', async () => {
    const answer = await deliverabilityOf(
      withRefs(
        commitPlan([{ branch: 'docs/foo', commits: ['abc1234', 'def5678'] }]),
        refsHolding(['abc1234']),
      ),
      SLUG,
      FILE,
    );
    expect(answer.deliverable).toBe(false);
    expect(answer.reason).toBe('branches-unmerged');
    expect(answer.unmerged).toEqual(['docs/foo']);
  });

  it('lets the commits decide even when a PR under the same head merged', async () => {
    const answer = await deliverabilityOf(
      withRefs(
        commitPlan([{ branch: 'docs/foo', commits: ['abc1234'] }]),
        refsHolding([]),
        hostMerging(['docs/foo']),
      ),
      SLUG,
      FILE,
    );
    expect(answer.deliverable).toBe(false);
    expect(answer.unmerged).toEqual(['docs/foo']);
  });

  it('delivers a mix of a merged PR, a landed commit and a deferred slice', async () => {
    const answer = await deliverabilityOf(
      withRefs(
        commitPlan([
          { branch: 'feature/by-pr' },
          { branch: 'docs/by-push', commits: ['abc1234'] },
          { branch: 'docs/given-up', commits: ['ffff000'], deferred: true },
        ]),
        refsHolding(['abc1234']),
        hostMerging(['feature/by-pr']),
      ),
      SLUG,
      FILE,
    );
    expect(answer.deliverable).toBe(true);
    expect(answer.merged).toBe(2);
    expect(answer.deferred).toBe(1);
  });

  it('refuses the mix when the PR slice is unmerged although the commit landed', async () => {
    const answer = await deliverabilityOf(
      withRefs(
        commitPlan([{ branch: 'feature/by-pr' }, { branch: 'docs/by-push', commits: ['abc1234'] }]),
        refsHolding(['abc1234']),
        hostMerging([]),
      ),
      SLUG,
      FILE,
    );
    expect(answer.deliverable).toBe(false);
    expect(answer.unmerged).toEqual(['feature/by-pr']);
  });

  it('does not read a commit in another repository as done', async () => {
    const asked: string[] = [];
    const answer = await deliverabilityOf(
      withRefs(
        commitPlan([{ branch: 'docs/foo', commits: ['acme/other@abc1234'] }]),
        refsHolding(['abc1234'], asked),
      ),
      SLUG,
      FILE,
    );
    expect(answer.deliverable).toBe(false);
    expect(answer.reason).toBe('cannot-tell');
    expect(answer.refusal).toContain('another repository');
    expect(asked).toEqual([]);
  });

  it('keeps the slice open when a local commit is missing beside a foreign one', async () => {
    const answer = await deliverabilityOf(
      withRefs(
        commitPlan([{ branch: 'docs/foo', commits: ['abc1234', 'acme/other@def5678'] }]),
        refsHolding([]),
      ),
      SLUG,
      FILE,
    );
    expect(answer.reason).toBe('branches-unmerged');
  });

  it('uses the default branch the caller resolved', async () => {
    const asked: string[] = [];
    const base = withRefs(
      commitPlan([{ branch: 'docs/foo', commits: ['abc1234'] }]),
      refsHolding(['abc1234'], asked),
    );
    await deliverabilityOf({ ...base, defaultBranch: 'trunk' }, SLUG, FILE);
    expect(asked).toEqual(['abc1234 in origin/trunk']);
  });
});

describe('deliverabilityOf reads a cross-repo reference from the plan text', () => {
  const branch = 'feature/lives-elsewhere';
  const text = ['# X', '', '## Slices', '', `- \`${branch}\` — the work → quatico/the-github-side#4711`, ''].join('\n');
  const portsWithText = (host: Host): DeliverabilityPorts => ({
    planStore: planStoreFixture({ plans: [plan([branch])], files: { [FILE]: text } }),
    host,
    refs: { commitFiles: async () => ({ ok: true, value: [] }) } as never,
    prIndex: prIndexFixture(null),
  });

  it('asks Host.prState with the repo the reference names, never prMerged', async () => {
    const asked: unknown[] = [];
    const host: Host = {
      ...throwingHostExceptMergeCommit(),
      prState: async (ref, opts) => {
        asked.push([ref, opts]);
        return { ok: true, value: { state: 'MERGED' } } as never;
      },
    };
    const answer = await deliverabilityOf(portsWithText(host), SLUG, FILE);

    expect(asked).toEqual([[4711, { repo: 'quatico/the-github-side' }]]);
    expect(answer.deliverable).toBe(true);
  });

  it('refuses as cannot-tell when the host that reference names cannot be asked', async () => {
    const host: Host = { ...throwingHostExceptMergeCommit(), prState: async () => ({ ok: false, why: 'failed' }) };
    const answer = await deliverabilityOf(portsWithText(host), SLUG, FILE);

    expect(answer.reason).toBe('cannot-tell');
  });
});

describe('deliverabilityOf reads every cross-repo reference a branch names, not only the first', () => {
  // Models ewz-kus-portal plan 3853: one branch name claimed identically in six
  // repositories. Before this slice, `crossRepoReferences` kept only the first
  // line's reference, so `deliverabilityOf` asked about #11 alone and reported
  // `deliverable: true` while #22 and #33 sat open.
  const branch = 'infra/shared-name';
  const text = [
    '# X',
    '',
    '## Slices',
    '',
    `- \`${branch}\` — repo one → quatico/one#11`,
    `- \`${branch}\` — repo two → quatico/two#22`,
    `- \`${branch}\` — repo three → quatico/three#33`,
    '',
  ].join('\n');
  const portsWithText = (host: Host): DeliverabilityPorts => ({
    planStore: planStoreFixture({ plans: [plan([branch])], files: { [FILE]: text } }),
    host,
    refs: { commitFiles: async () => ({ ok: true, value: [] }) } as never,
    prIndex: prIndexFixture(null),
  });

  it('asks every reference and refuses, naming the branch, when two of three are unmerged', async () => {
    const asked: unknown[] = [];
    const host: Host = {
      ...throwingHostExceptMergeCommit(),
      prState: async (ref, opts) => {
        asked.push([ref, opts]);
        const merged = ref === 11;
        return { ok: true, value: { state: merged ? 'MERGED' : 'OPEN' } } as never;
      },
    };
    const answer = await deliverabilityOf(portsWithText(host), SLUG, FILE);

    expect(asked).toEqual([
      [11, { repo: 'quatico/one' }],
      [22, { repo: 'quatico/two' }],
      [33, { repo: 'quatico/three' }],
    ]);
    expect(answer.deliverable).toBe(false);
    expect(answer.unmerged).toEqual([branch]);
  });

  it('delivers only once every reference answers merged', async () => {
    const host: Host = {
      ...throwingHostExceptMergeCommit(),
      prState: async () => ({ ok: true, value: { state: 'MERGED' } }) as never,
    };
    const answer = await deliverabilityOf(portsWithText(host), SLUG, FILE);

    expect(answer.deliverable).toBe(true);
    expect(answer.merged).toBe(1);
  });
});
