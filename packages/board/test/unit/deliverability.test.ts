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
