import { describe, expect, it } from 'vitest';
import { planIsFinished, planNamesBranch } from '../src/rules/plan-names-branch.js';
import { looseDelete, type LooseDeleteReadings } from '../src/rules/loose-delete.js';

const BRANCH = 'feature/one-pr-reader-per-machine-and';

const plan = (phase: string, branch = BRANCH) => ({
  phase,
  slices: [
    { branches: [{ branch: 'feature/landed-slice' }] },
    { branches: [{ branch, deferred: true }] },
  ],
});

const TIP = 'a'.repeat(40);
const readings = (phase: string): LooseDeleteReadings => ({
  caller: 'person',
  branch: BRANCH,
  defaultBranch: { ok: true, value: 'main' },
  plan: { kind: 'named', file: 'docs/plans/p.md', phase, deferred: true, base: '' },
  desk: { ok: true, value: false },
  manifests: { ok: true, value: [] },
  commits: { ok: true, value: [{ subject: 'fix the thing', tree: 't2', parentTree: 't1' }] },
  pr: { ok: true, value: { number: 2436, state: 'CLOSED' } as never },
  merged: { ok: true, value: 'not-merged' },
  unpushed: null,
  remoteTip: { ok: true, value: { sha: TIP } },
  localTip: { ok: true, value: TIP },
});

describe('planNamesBranch', () => {
  it.each(['draft', 'design', 'approved', 'delivered'])('a deferred slice of a %s plan names its branch', (phase) => {
    expect(planNamesBranch(plan(phase), BRANCH)).toBe(true);
  });

  it.each(['released', 'superseded', 'rejected'])('a deferred slice of a %s plan names no branch', (phase) => {
    expect(planNamesBranch(plan(phase), BRANCH)).toBe(false);
  });

  it('reads the phase in any letter case', () => {
    expect(planNamesBranch(plan('Released'), BRANCH)).toBe(false);
    expect(planNamesBranch(plan('Delivered'), BRANCH)).toBe(true);
    expect(planIsFinished('Superseded')).toBe(true);
  });

  it('names no branch that no slice line holds', () => {
    expect(planNamesBranch(plan('approved'), 'feature/elsewhere')).toBe(false);
  });
});

describe('looseDelete reads the named refusal through planNamesBranch', () => {
  it.each(['draft', 'design', 'approved', 'delivered'])('refuses named for a deferred slice of a %s plan', (phase) => {
    expect(looseDelete(readings(phase))).toMatchObject({ kind: 'refuse', reason: 'named' });
  });

  it.each(['released', 'superseded', 'rejected'])('passes named for a deferred slice of a %s plan', (phase) => {
    expect(looseDelete(readings(phase))).toEqual({ kind: 'delete', tip: TIP });
  });
});
