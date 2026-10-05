import { describe, expect, it } from 'vitest';
import { fragmentModel } from '../src/rules/fragment-model.js';

describe('fragmentModel', () => {
  it('reads --model <value>', () => {
    expect(fragmentModel('claude -p --model opus')).toEqual({ named: true, model: 'opus' });
  });

  it('reads --model=<value>', () => {
    expect(fragmentModel('claude -p --model=opus')).toEqual({ named: true, model: 'opus' });
  });

  it('reads the PLOT_MODEL= prefix a Worker command sets', () => {
    const fragment =
      'PLOT_UNATTENDED=1 CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 PLOT_MODEL=sonnet skills/plot/scripts/plot-worker-loop.sh';
    expect(fragmentModel(fragment)).toEqual({ named: true, model: 'sonnet' });
  });

  // THE DEFECT A NAIVE READ WOULD CAUSE: absent must not read as `''`.
  it('of a fragment with no --model answers none, not the empty string', () => {
    const result = fragmentModel('claude -p');
    expect(result.named).toBe(false);
    expect(result).not.toHaveProperty('model');
  });

  it('answers none for an empty fragment', () => {
    expect(fragmentModel('')).toEqual({ named: false });
  });

  it('a --model flag wins over a PLOT_MODEL= prefix when both are present', () => {
    const fragment = 'PLOT_MODEL=sonnet claude -p --model opus';
    expect(fragmentModel(fragment)).toEqual({ named: true, model: 'opus' });
  });
});
