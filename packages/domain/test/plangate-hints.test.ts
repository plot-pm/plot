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

  it('hints every refusal the gate can return', () => {
    const reasons: PlanGateRefusal[] = [
      'plan-not-found', 'ref-unreadable', 'plan-unreadable', 'phase-draft', 'state-terminal',
      'state-unreadable', 'state-wrong', 'impl-same-branch', 'impl-other-repo', 'impl-none',
      'impl-unrecognised', 'spike-only',
    ];
    for (const reason of reasons) expect(planGateHint(reason, 'g', 'main')).toMatch(/\S/);
    expect(planGateHint('ref-unreadable', 'g', 'trunk')).toContain('git fetch origin trunk');
    expect(planGateHint('plan-not-found', 'g', 'trunk')).toContain('grep -i g');
  });

  it('refuses the ways the gate cannot read the plan', () => {
    const base = readings({ phase: 'approved', impl: 'own-branches' });
    const no = (gate: object, input = {}) => plangate({ ...base, gate: { ...base.gate, ...gate } }, input)?.reason;
    expect(plangate({ ...base, gate: undefined }, {})?.reason).toBe('plan-not-found');
    expect(no({ refResolved: false })).toBe('ref-unreadable');
    expect(no({ refResolved: false, file: '' }, { allowLocal: true })).toBe('plan-not-found');
    expect(no({ file: '' })).toBe('plan-not-found');
    expect(no({ parsed: false })).toBe('plan-unreadable');
  });

  it('names the slug and the next command in the spike-only hint', () => {
    expect(planGateHint('spike-only', 'my-plan', 'main')).toContain('/plot-approve my-plan');
  });

  it('names the slug in the approve hint', () => {
    expect(planGateHint('phase-draft', 'my-plan', 'main')).toBe('Review it, then: /plot-approve my-plan');
  });
});
