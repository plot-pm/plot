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

  it.each([
    ['claude -p --model "opus"', 'opus'],
    ["claude -p --model 'sonnet'", 'sonnet'],
    ['claude -p --model="opus"', 'opus'],
    ['PLOT_MODEL="sonnet" plot-worker-loop.sh', 'sonnet'],
  ])('strips surrounding quotes: %s', (fragment, model) => {
    expect(fragmentModel(fragment)).toEqual({ named: true, model });
  });

  it.each([
    ['claude -p --model ${PLOT_MODEL:-opus}'],
    ['claude -p --model "$MODEL"'],
    ['PLOT_MODEL=${MODEL} plot-worker-loop.sh'],
    ['claude -p --model ""'],
  ])('answers none for a value the fragment does not state: %s', (fragment) => {
    expect(fragmentModel(fragment)).toEqual({ named: false });
  });
});
