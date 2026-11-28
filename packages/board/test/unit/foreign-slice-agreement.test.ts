// The fleet scan's walk and `/plot-deliver`'s `deliverabilityOf` read a foreign
// slice through one rule, `crossRepoMergeState`. These tests hand both callers
// the same plan text and the same `prState` answers and assert one answer, so a
// second fold in either caller fails here.
import { describe, expect, it } from 'vitest';
import { hostFixture, planRecord, planStoreFixture, refsFixture } from '@plot-pm/domain/adapters';
import { answered, failed, isAnswered, type Host } from '@plot-pm/domain';
import type { PlanRecordBranch } from '@plot-pm/domain/ports/plan-store';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import { branchState } from '@plot-pm/domain/rules/branch-state';
import { readBranchReadings } from '@plot-pm/domain/workflows/plan-walk-branches';
import type { Estate } from '@plot-pm/domain/workflows/plan-walk-estate';

import { deliverabilityOf } from '../../src/server/controllers/deliverability.js';

const FILE = 'docs/plans/2026-11-28-x.md';
const SLUG = '2026-11-28-x';

type Answer = 'merged' | 'not-merged' | 'unknown';

const noIndex: PrIndexStore = {
  location: async () => answered('/dev/null'),
  read: async () => answered(null),
  write: async () => answered(undefined),
};

/** A host answering `prState(N, { repo })` from `answers`, keyed `owner/repo#N`, and `prMerged` from `mergedByName`. */
const hostOf = (answers: Readonly<Record<string, Answer>>, mergedByName: readonly string[] = []): Host => {
  const inner = hostFixture({ backend: 'bitbucket', merged: mergedByName });
  return {
    ...inner,
    prMergeCommit: async () => answered(''),
    prState: async (ref, opts) => {
      const answer = answers[`${opts?.repo ?? ''}#${ref}`];
      if (answer === undefined || answer === 'unknown') return failed();
      return answered({ number: Number(ref), state: answer === 'merged' ? 'MERGED' : 'OPEN' } as never);
    },
  };
};

const branchLine = (branch: string, text: string): PlanRecordBranch => ({
  branch,
  deferred: false,
  deferredReason: '',
  claimed: '',
  waitsOn: [],
  line: text,
});

const planText = (lines: readonly string[]): string => ['# X', '', '## Slices', '', '### One', '', ...lines, ''].join('\n');

/** The walk's state for each branch, over a plan whose slices hold `lines`. */
const walkStates = async (slices: readonly (readonly PlanRecordBranch[])[], host: Host, refs = refsFixture({
  shas: { 'origin/main': 'm1' },
  remotes: { origin: 'git@bitbucket.org:ws/kus.git' },
  additions: { [FILE]: 'add1' },
})) => {
  const estate: Estate = {
    mainSha: 'm1',
    plans: [
      {
        blob: { source: 'main', path: FILE, sha: 'p1' } as Estate['plans'][number]['blob'],
        record: planRecord({
          file: FILE,
          phase: 'approved',
          slices: slices.map((branches, i) => ({ name: `wave ${i + 1}`, branches: [...branches] })),
        }),
      },
    ],
    indexes: [],
    dangling: [],
  };
  const read = await readBranchReadings(refs, host, estate, { mainBranch: 'main', planDir: 'docs/plans/', askAbsent: true });
  if (!isAnswered(read)) throw new Error('readBranchReadings should answer');
  return read.value.branches.map((b) => ({ branch: b.branch, state: branchState(b.readings), foreignPr: b.readings.foreignPr }));
};

const deliverOf = async (slices: readonly (readonly PlanRecordBranch[])[], host: Host) =>
  deliverabilityOf(
    {
      planStore: planStoreFixture({
        plans: [planRecord({ file: FILE, slices: slices.map((branches, i) => ({ name: `wave ${i + 1}`, branches: [...branches] })) })],
        files: { [FILE]: planText(slices.flat().map((b) => b.line!)) },
      }),
      host,
      refs: { commitFiles: async () => answered([]) } as never,
      prIndex: noIndex,
    },
    SLUG,
    FILE,
  );

/** What `deliverabilityOf` says about a one-branch plan, in the rule's words. */
const deliveredAs = (answer: { deliverable: boolean; reason: string }): Answer =>
  answer.deliverable ? 'merged' : answer.reason === 'cannot-tell' ? 'unknown' : 'not-merged';

describe('the walk and deliverabilityOf read a foreign slice through one rule', () => {
  const words: readonly Answer[] = ['merged', 'not-merged', 'unknown'];
  const combinations = words.flatMap((first) => words.map((second) => [first, second] as const));

  it.each(combinations)('agree where ws/portal#31 answers %s and ws/apps-infra#176 answers %s', async (first, second) => {
    const host = hostOf({ 'ws/portal#31': first, 'ws/apps-infra#176': second });
    const only = [[branchLine('feature/both', '- `feature/both` — two homes → ws/portal#31 → ws/apps-infra#176')]];
    const [walked] = await walkStates(only, host);
    const delivered = deliveredAs(await deliverOf(only, host));
    expect(walked!.foreignPr).toBe(delivered);
    expect(walked!.state).toBe(delivered === 'merged' ? 'merged' : 'foreign');
  });

  it('reads the #3762 fixture merged on both sides', async () => {
    const slices = [
      [
        branchLine('feature/local', '- `feature/local` — the local part → #16'),
        branchLine('feature/portal', '- `feature/portal` — the portal part → ws/portal#31'),
      ],
      [branchLine('feature/entra-client-credentials', '- `feature/entra-client-credentials` — the infra part → ws/apps-infra#176')],
    ];
    const host = hostOf({ 'ws/portal#31': 'merged', 'ws/apps-infra#176': 'merged' }, ['feature/local']);
    const refs = refsFixture({
      shas: { 'origin/main': 'm1' },
      remotes: { origin: 'git@bitbucket.org:ws/kus.git' },
      additions: { [FILE]: 'add1' },
      merges: [{ sha: 'mg16', subject: 'Merged in feature/local (pull request #16)' }],
      ancestry: { 'mg16 add1': 'no' },
    });
    const walked = await walkStates(slices, host, refs);
    expect(walked.map((b) => b.state)).toEqual(['merged', 'merged', 'merged']);
    const delivered = await deliverOf(slices, host);
    expect(delivered).toMatchObject({ deliverable: true, merged: 3 });
  });
});
