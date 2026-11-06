import { describe, expect, it } from 'vitest';

import { planGateAnswer, type PlanGateAsk } from '../../src/server/entry/plangate.js';

/**
 * The dispatch plan gate over plan-meta JSON: a `Spike approved:` record
 * admits a Design plan's spike only where its fourth field names the one
 * branch the plan marks.
 */

const ask = (branch: string): PlanGateAsk => ({
  slug: 'p', source: 'origin/main', defaultBranch: 'main', refResolved: true, allowLocal: false, branch,
});

const metaOf = (record: string, marked: string): string => JSON.stringify({
  file: 'docs/plans/2026-11-04-p.md',
  phase: 'design',
  impl: 'own-branches',
  spike_approved_raw: record,
  slices: [
    { branches: [{ branch: 'feature/a', ...(marked === 'feature/a' ? { spike: true } : {}) }] },
    { branches: [{ branch: 'feature/b', ...(marked === 'feature/b' ? { spike: true } : {}) }] },
  ],
});

describe('planGateAnswer — a record that licenses no branch', () => {
  it('refuses a moved marker as spike-unlicensed, naming spike-marker-moved', () => {
    const out = planGateAnswer(ask('feature/b'), metaOf('2026-11-03, jwloka, in-session, feature/a', 'feature/b'));
    expect(out.code).toBe(1);
    expect(out.lines.join('\n')).toContain('spike-marker-moved');
    expect(out.lines.join('\n')).toContain('plot-approve.mjs --spike p --who');
  });

  it('refuses a renamed branch, naming spike-branch-renamed', () => {
    const out = planGateAnswer(ask('feature/a'), metaOf('2026-11-03, jwloka, in-session, feature/c', 'feature/a'));
    expect(out.code).toBe(1);
    expect(out.lines.join('\n')).toContain('spike-branch-renamed');
  });

  it('refuses a branchless record, naming spike-record-branchless', () => {
    const out = planGateAnswer(ask('feature/a'), metaOf('2026-11-03', 'feature/a'));
    expect(out.code).toBe(1);
    expect(out.lines.join('\n')).toContain('spike-record-branchless');
  });

  it('keeps a plan with no record on state-wrong', () => {
    const out = planGateAnswer(ask('feature/a'), metaOf('', 'feature/a'));
    expect(out.code).toBe(1);
    expect(out.lines.join('\n')).toContain("not Approved");
    expect(out.lines.join('\n')).not.toContain('spike-record-absent');
  });

  it('admits the asked branch where the record names the marked branch', () => {
    expect(planGateAnswer(ask('feature/a'), metaOf('2026-11-03, jwloka, in-session, feature/a', 'feature/a')))
      .toEqual({ code: 0, lines: [] });
  });
});
