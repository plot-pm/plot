import { describe, expect, it } from 'vitest';

import { briefNeedsWrite, hasStartedLine, insertStartedLine, startedLine } from '../src/rules/brief-booking.js';

const PLAN = '# A\n\n## Status\n\n- **Started:**\n- **Delivered:**\n';

describe('startedLine', () => {
  it('matches the shell\'s shape', () => {
    expect(startedLine('2026-10-26', 'Plot Test', 'bug/foo')).toBe('- **Started:** 2026-10-26, Plot Test, `bug/foo`');
  });
});

describe('hasStartedLine', () => {
  it('is false on a plan with no Started line for the branch', () => {
    expect(hasStartedLine(PLAN, 'bug/foo')).toBe(false);
  });

  it('is true once the branch is recorded', () => {
    const booked = PLAN.replace('- **Started:**', '- **Started:** 2026-10-26, Plot Test, `bug/foo`');
    expect(hasStartedLine(booked, 'bug/foo')).toBe(true);
  });

  it('does not let feature/api match feature/api-v2', () => {
    const booked = PLAN.replace('- **Started:**', '- **Started:** 2026-10-26, Plot Test, `feature/api-v2`');
    expect(hasStartedLine(booked, 'feature/api')).toBe(false);
  });
});

describe('insertStartedLine', () => {
  it('fills the empty Started placeholder', () => {
    const result = insertStartedLine(PLAN, '2026-10-26', 'Plot Test', 'bug/foo');
    expect(result).toEqual({
      outcome: 'inserted',
      content: PLAN.replace('- **Started:**', '- **Started:** 2026-10-26, Plot Test, `bug/foo`'),
    });
  });

  it('appends after the last bullet when there is no empty placeholder', () => {
    const plan = '# A\n\n## Status\n\n- **Delivered:** 2026-10-01, Jan, `bug/old`\n';
    const result = insertStartedLine(plan, '2026-10-26', 'Plot Test', 'bug/foo');
    expect(result).toEqual({
      outcome: 'inserted',
      content: '# A\n\n## Status\n\n- **Delivered:** 2026-10-01, Jan, `bug/old`\n- **Started:** 2026-10-26, Plot Test, `bug/foo`\n',
    });
  });

  it('refuses a plan with no Status section', () => {
    expect(insertStartedLine('# A\n\n## Slices\n', '2026-10-26', 'Plot Test', 'bug/foo')).toEqual({
      outcome: 'refused',
      reason: 'no-status-section',
    });
  });

  it('reports unchanged, and writes nothing, for a branch already recorded', () => {
    const booked = PLAN.replace('- **Started:**', '- **Started:** 2026-10-20, Someone, `bug/foo`');
    expect(insertStartedLine(booked, '2026-10-26', 'Plot Test', 'bug/foo')).toEqual({
      outcome: 'unchanged',
      content: booked,
    });
  });

  it('does not match the date, so a later re-run still books nothing', () => {
    const booked = PLAN.replace('- **Started:**', '- **Started:** 2026-10-20, Someone, `bug/foo`');
    const result = insertStartedLine(booked, '2099-01-01', 'Plot Test', 'bug/foo');
    expect(result.outcome).toBe('unchanged');
  });
});

describe('briefNeedsWrite', () => {
  it('is true when no brief is on the ref', () => {
    expect(briefNeedsWrite({ briefOnRef: null, briefText: 'hello' })).toBe(true);
  });

  it('is false once the ref already carries the same bytes', () => {
    expect(briefNeedsWrite({ briefOnRef: 'hello', briefText: 'hello' })).toBe(false);
  });

  it('is true where the ref carries different bytes', () => {
    expect(briefNeedsWrite({ briefOnRef: 'old', briefText: 'new' })).toBe(true);
  });
});
