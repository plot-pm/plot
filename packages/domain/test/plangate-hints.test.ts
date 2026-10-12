import { describe, it, expect } from 'vitest';
import { plangate, planGateHint, type PlanGateRefusal } from '../src/workflows/dispatch.js';

const readings = (gate: { phase: string; impl: string }) => ({
  inRepository: true,
  slug: 'g',
  defaultBranch: 'main',
  candidates: [],
  workerCommand: 'configured' as const,
  gate: { refResolved: true, file: 'docs/plans/g.md', parsed: true, source: 'origin/main', ...gate },
});

describe('plangate', () => {
  it('passes an approved plan on its own branches', () => {
    expect(plangate(readings({ phase: 'approved', impl: 'own-branches' }), {})).toBeUndefined();
  });

  it('gives every refusal a hint that names the next step', () => {
    const arms: [string, string, PlanGateRefusal][] = [
      ['draft', 'own-branches', 'phase-draft'],
      ['delivered', 'own-branches', 'state-terminal'],
      ['NONE', 'own-branches', 'state-unreadable'],
      ['weird', 'own-branches', 'state-wrong'],
      ['approved', 'same-branch', 'impl-same-branch'],
      ['approved', 'other-repo', 'impl-other-repo'],
      ['approved', 'none', 'impl-none'],
      ['approved', 'sideways', 'impl-unrecognised'],
    ];
    for (const [phase, impl, reason] of arms) {
      const refusal = plangate(readings({ phase, impl }), {});
      expect(refusal?.reason).toBe(reason);
      expect(planGateHint(reason, 'g', 'main')).not.toBe('');
    }
  });

  it('names the slug in the approve hint', () => {
    expect(planGateHint('phase-draft', 'my-plan', 'main')).toBe('Review it, then: /plot-approve my-plan');
  });
});
