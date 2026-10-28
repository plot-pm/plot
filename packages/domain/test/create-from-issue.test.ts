import { describe, expect, it } from 'vitest';
import { createFromIssueVerdict } from '../src/rules/create-from-issue.js';

const AVAILABLE = { available: true, reason: '' };
const UNAVAILABLE = (reason: string) => ({ available: false, reason });

describe.each(['plan', 'story'] as const)('createFromIssueVerdict — %s', (kind) => {
  it('is available when the answer is answered and the binding is available', () => {
    expect(createFromIssueVerdict(AVAILABLE, 'answered', kind)).toEqual({ kind: 'available' });
  });

  it('is pending with no sentence when the answer is null (not read yet)', () => {
    const verdict = createFromIssueVerdict(AVAILABLE, null, kind);
    expect(verdict.kind).toBe('pending');
    // Pins the regression this slice fixes: a rule that maps `null` to
    // `unsupported` would print this sentence instead of staying quiet.
    if (verdict.kind === 'pending' || verdict.kind === 'refused') {
      expect(JSON.stringify(verdict)).not.toMatch(/no issue read/);
    }
  });

  it('is refused with the host sentence when the answer is unsupported', () => {
    const verdict = createFromIssueVerdict(AVAILABLE, 'unsupported', kind);
    expect(verdict).toEqual({
      kind: 'refused',
      reason: kind === 'plan'
        ? 'this git host has no issue read, so an issue cannot become a plan from here'
        : 'this git host has no issue read, so a ticket cannot become a story from here',
    });
  });

  it('is refused with the outage sentence when the answer is failed', () => {
    const verdict = createFromIssueVerdict(AVAILABLE, 'failed', kind);
    expect(verdict).toEqual({
      kind: 'refused',
      reason: kind === 'plan'
        ? 'the issue lookup is failing, so this issue cannot be read — nothing was created'
        : 'the issue lookup is failing, so this ticket cannot be read — nothing was created',
    });
  });

  it('is refused with the binding reason when the answer is answered but the binding is unavailable', () => {
    expect(createFromIssueVerdict(UNAVAILABLE('the board is bound to 0.0.0.0, not localhost'), 'answered', kind))
      .toEqual({ kind: 'refused', reason: 'the board is bound to 0.0.0.0, not localhost' });
  });

  it('is refused with a fallback sentence when the binding is unavailable with no stated reason', () => {
    const verdict = createFromIssueVerdict(UNAVAILABLE(''), 'answered', kind);
    expect(verdict.kind).toBe('refused');
    expect(verdict).not.toEqual({ kind: 'refused', reason: '' });
  });

  it('names the tracker first when both the answer and the binding are unavailable', () => {
    const verdict = createFromIssueVerdict(UNAVAILABLE('bound to 0.0.0.0'), 'unsupported', kind);
    expect(verdict.kind).toBe('refused');
    if (verdict.kind === 'refused') expect(verdict.reason).toMatch(/no issue read/);
  });
});
