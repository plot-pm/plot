import { describe, it, expect } from 'vitest';

import type { RegisteredTreeReadings } from '@plot-pm/domain/rules/unclaimed';
import { ENDING_FILENAME } from '@plot-pm/domain/entities/ending';

import {
  nothingDoneCandidateTrees,
  readNothingDoneCandidates,
  nothingDoneDecisions,
  applyNothingDoneDecisions,
  nothingDoneLines,
  prOpenReading,
  type NothingDoneCandidateReadings,
  type NothingDoneDecision,
} from '../../src/server/entry/registryd.js';

const PLAN = '2026-10-05-a-plan';

const tree = (over: Partial<RegisteredTreeReadings> = {}): RegisteredTreeReadings => ({
  path: '/estate/.worktrees/feature-x',
  branch: 'feature/x',
  isMain: false,
  prunable: false,
  registered: false,
  planNamed: true,
  plan: PLAN,
  dirtyCount: 0,
  ...over,
});

const endingFile = (reason: string, detail = '', over: Record<string, string> = {}) =>
  JSON.stringify({ reason, actor: 'agent', branch: 'feature/x', detail, ...over });

describe('nothingDoneCandidateTrees', () => {
  it('names an unregistered, plan-named, non-main desk — the same join freshAgentCandidateTrees takes', () => {
    expect(nothingDoneCandidateTrees([tree()])).toEqual([tree()]);
  });

  it('excludes the main checkout', () => {
    expect(nothingDoneCandidateTrees([tree({ isMain: true })])).toEqual([]);
  });

  it('excludes a desk a manifest already names', () => {
    expect(nothingDoneCandidateTrees([tree({ registered: true })])).toEqual([]);
  });

  it('excludes a desk no plan names', () => {
    expect(nothingDoneCandidateTrees([tree({ planNamed: false })])).toEqual([]);
  });
});

describe('readNothingDoneCandidates', () => {
  it('reads the ending reason off the desk', async () => {
    const deskFile = (_worktree: string, name: string) =>
      name === ENDING_FILENAME ? endingFile('nothing-done') : null;
    const [reading] = readNothingDoneCandidates([tree()], deskFile);
    expect(reading?.ending).toBe('nothing-done');
  });

  it('reads null where no ending was written', async () => {
    const [reading] = readNothingDoneCandidates([tree()], () => null);
    expect(reading?.ending).toBeNull();
    expect(reading?.refusedAssignment).toBe('');
  });

  it('reads the assignment a take-up refused off the ending', async () => {
    const deskFile = (_worktree: string, name: string) =>
      name === ENDING_FILENAME ? endingFile('holding-work', '', { refusedAssignment: 'infra/assigned' }) : null;
    const [reading] = readNothingDoneCandidates([tree()], deskFile);
    expect(reading).toMatchObject({ ending: 'holding-work', branch: 'feature/x', refusedAssignment: 'infra/assigned' });
  });

  it('carries the branch and worktree the tree names', async () => {
    const [reading] = readNothingDoneCandidates([tree()], () => null);
    expect(reading?.branch).toBe('feature/x');
    expect(reading?.worktree).toBe('/estate/.worktrees/feature-x');
  });
});

const candidate = (over: Partial<NothingDoneCandidateReadings> = {}): NothingDoneCandidateReadings => ({
  plan: PLAN,
  branch: 'feature/x',
  worktree: '/estate/.worktrees/feature-x',
  ending: 'nothing-done',
  refusedAssignment: '',
  ...over,
});

const noFreshSessions = async (): Promise<number> => 0;

describe('nothingDoneDecisions', () => {
  it('decides release-claim for a clean nothing-done desk', async () => {
    const [decision] = await nothingDoneDecisions(
      [candidate()],
      async () => 'no',
      async () => false,
      noFreshSessions,
    );
    expect(decision?.verdict).toBe('release-claim');
    expect(decision?.branch).toBe('feature/x');
    expect(decision?.worktree).toBe('/estate/.worktrees/feature-x');
  });

  it('leaves a desk with a commit beyond its claim alone', async () => {
    const [decision] = await nothingDoneDecisions(
      [candidate()],
      async () => 'yes',
      async () => false,
      noFreshSessions,
    );
    expect(decision?.verdict).toBe('leave');
  });

  it('leaves a desk with an open PR alone', async () => {
    const [decision] = await nothingDoneDecisions(
      [candidate()],
      async () => 'no',
      async () => true,
      noFreshSessions,
    );
    expect(decision?.verdict).toBe('leave');
  });

  it('leaves a desk alone when the host could not say whether a PR is open', async () => {
    const [decision] = await nothingDoneDecisions(
      [candidate()],
      async () => 'no',
      async () => 'unanswerable',
      noFreshSessions,
    );
    expect(decision?.verdict).toBe('leave');
  });

  it('decides release-claim for the refused assignment of a take-up holding-work, never the desk\'s branch (#1281)', async () => {
    const [decision] = await nothingDoneDecisions(
      [candidate({ ending: 'holding-work', refusedAssignment: 'infra/assigned' })],
      async () => 'yes',
      async () => false,
      noFreshSessions,
    );
    expect(decision).toEqual({ branch: 'infra/assigned', worktree: '/estate/.worktrees/feature-x', verdict: 'release-claim' });
  });

  it('leaves every ending but nothing-done alone', async () => {
    const [decision] = await nothingDoneDecisions(
      [candidate({ ending: 'unstarted' })],
      async () => 'no',
      async () => false,
      noFreshSessions,
    );
    expect(decision?.verdict).toBe('leave');
  });

  it('leaves a missing ending alone', async () => {
    const [decision] = await nothingDoneDecisions(
      [candidate({ ending: null })],
      async () => 'no',
      async () => false,
      noFreshSessions,
    );
    expect(decision?.verdict).toBe('leave');
  });

  it('asks the commit reader by desk and the PR reader by branch, once per candidate', async () => {
    const commitAsked: string[] = [];
    const prAsked: string[] = [];
    await nothingDoneDecisions(
      [candidate({ branch: 'a', worktree: '/wa' }), candidate({ branch: 'b', worktree: '/wb' })],
      async (worktree) => {
        commitAsked.push(worktree);
        return 'no';
      },
      async (branch) => {
        prAsked.push(branch);
        return false;
      },
      noFreshSessions,
    );
    expect(commitAsked).toEqual(['/wa', '/wb']);
    expect(prAsked).toEqual(['a', 'b']);
  });

  it('asks the shared fresh-session store by plan and branch for a holding-work ending', async () => {
    // THE CROSS-PIPELINE SHARE: a holding-work ending that already used its
    // one fresh session (via the fresh-agent pipeline) must not also release
    // the claim as though nothing happened — it answers needs-a-person, same
    // as freshAgentDecisions would for the identical reading.
    const asked: Array<[string, string]> = [];
    const [decision] = await nothingDoneDecisions(
      [candidate({ ending: 'holding-work', refusedAssignment: '' })],
      async () => 'no',
      async () => false,
      async (plan, branch) => {
        asked.push([plan, branch]);
        return 1;
      },
    );
    expect(asked).toEqual([[PLAN, 'feature/x']]);
    expect(decision?.verdict).toBe('needs-a-person');
  });
});

describe('prOpenReading', () => {
  it('reads an open PR as true, a closed one and no PR as false', () => {
    expect(prOpenReading({ ok: true, value: { number: 1, head: 'a', state: 'OPEN' } as never })).toBe(true);
    expect(prOpenReading({ ok: true, value: { number: 1, head: 'a', state: 'CLOSED' } as never })).toBe(false);
    expect(prOpenReading({ ok: true, value: null })).toBe(false);
  });

  it('reads a host that could not be asked as unanswerable, never as no PR', () => {
    expect(prOpenReading({ ok: false, why: 'failed' })).toBe('unanswerable');
    expect(prOpenReading({ ok: false, why: 'unaskable' })).toBe('unanswerable');
  });
});

describe('applyNothingDoneDecisions', () => {
  it('releases the claim for a release-claim verdict', async () => {
    const released: string[] = [];
    const applied = await applyNothingDoneDecisions(
      [{ branch: 'feature/x', worktree: '/w', verdict: 'release-claim' }],
      async (branch) => {
        released.push(branch);
        return { released: true, detail: 'released' };
      },
    );
    expect(applied).toEqual([{ branch: 'feature/x', outcome: 'released', detail: 'released' }]);
    expect(released).toEqual(['feature/x']);
  });

  it('reports a refusal without retrying it', async () => {
    let calls = 0;
    const applied = await applyNothingDoneDecisions(
      [{ branch: 'feature/x', worktree: '/w', verdict: 'release-claim' }],
      async () => {
        calls += 1;
        return { released: false, detail: 'a live worker still holds this desk' };
      },
    );
    expect(applied).toEqual([
      { branch: 'feature/x', outcome: 'refused', detail: 'a live worker still holds this desk' },
    ]);
    expect(calls).toBe(1);
  });

  it('reports a thrown release without stopping the next desk', async () => {
    const applied = await applyNothingDoneDecisions(
      [
        { branch: 'a', worktree: '/a', verdict: 'release-claim' },
        { branch: 'b', worktree: '/b', verdict: 'release-claim' },
      ],
      async (branch) => {
        if (branch === 'a') throw new Error('the release script could not be run');
        return { released: true, detail: 'released' };
      },
    );
    expect(applied).toEqual([
      { branch: 'a', outcome: 'threw', detail: 'the release script could not be run' },
      { branch: 'b', outcome: 'released', detail: 'released' },
    ]);
  });

  it('skips every desk decided leave', async () => {
    const decisions: NothingDoneDecision[] = [{ branch: 'feature/x', worktree: '/w', verdict: 'leave' }];
    let calls = 0;
    const applied = await applyNothingDoneDecisions(decisions, async () => {
      calls += 1;
      return { released: true, detail: 'released' };
    });
    expect(applied).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe('nothingDoneLines', () => {
  it('sends released to the log and every other outcome to the error stream', () => {
    const lines = nothingDoneLines([
      { branch: 'a', outcome: 'released', detail: 'ok' },
      { branch: 'b', outcome: 'refused', detail: 'no' },
      { branch: 'c', outcome: 'threw', detail: 'boom' },
    ]);
    expect(lines.map((l) => l.error)).toEqual([false, true, true]);
    expect(lines[1]?.line).toBe('plot-registryd nothing-done b: refused — no');
  });
});
