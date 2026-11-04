import { describe, expect, it } from 'vitest';

import { callerOf } from '../src/workflows/decision.js';

describe('callerOf', () => {
  it('reads person from an unset PLOT_UNATTENDED', () => {
    const value: string | undefined = undefined;
    expect(callerOf({ unattended: value === '1' })).toBe('person');
  });

  it('reads person from PLOT_UNATTENDED=0', () => {
    const value: string | undefined = '0';
    expect(callerOf({ unattended: value === '1' })).toBe('person');
  });

  it('reads unattended from PLOT_UNATTENDED=1', () => {
    const value: string | undefined = '1';
    expect(callerOf({ unattended: value === '1' })).toBe('unattended');
  });

  it('reads unattended from the --unattended flag', () => {
    expect(callerOf({ unattended: ['--unattended'].includes('--unattended') })).toBe('unattended');
  });
});
