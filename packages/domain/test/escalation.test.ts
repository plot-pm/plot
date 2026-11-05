import { describe, expect, it } from 'vitest';

import { escalationComment, escalationMarker, escalationReason, planIssueId } from '../src/rules/escalation.js';

describe('escalationReason', () => {
  it('reads the reason of an escalated row', () => {
    expect(escalationReason([{ outcome: 'escalated test' }])).toBe('test');
  });

  it('reads the reason of the answer-cap escalation', () => {
    expect(escalationReason([{ outcome: 'escalated answer-cap' }])).toBe('answer-cap');
  });

  it('answers null where the last row is started, not escalated', () => {
    expect(escalationReason([{ outcome: 'escalated test' }, { outcome: 'started' }])).toBeNull();
  });

  it('answers null for a refused, a failed and an empty record', () => {
    expect(escalationReason([{ outcome: 'refused unparseable-run' }])).toBeNull();
    expect(escalationReason([{ outcome: 'failed run ended bound' }])).toBeNull();
    expect(escalationReason([])).toBeNull();
  });

  it('answers null for an escalation row with no reason', () => {
    expect(escalationReason([{ outcome: 'escalated ' }])).toBeNull();
  });
});

describe('escalationComment', () => {
  const input = { branch: 'feature/x', askedAt: '2026-11-05T10:00:00.000Z', question: 'which adapter?\nand why?', reason: 'scope' };

  it('starts with its marker and holds the question, the reason and the branch', () => {
    const { body, marker } = escalationComment(input);
    expect(body.startsWith(`${marker}\n`)).toBe(true);
    expect(body).toContain('`feature/x`');
    expect(body).toContain('escalated: scope');
    expect(body).toContain('> which adapter?\n> and why?');
  });

  it('keys the marker on the desk and askedAt', () => {
    expect(escalationComment(input).marker).toBe(escalationMarker('feature/x', input.askedAt));
    expect(escalationMarker('feature/x', input.askedAt)).not.toBe(escalationMarker('feature/x', '2026-11-05T11:00:00.000Z'));
    expect(escalationMarker('feature/x', input.askedAt)).not.toBe(escalationMarker('feature/y', input.askedAt));
  });
});

describe('planIssueId', () => {
  it('reads #N from the Status section', () => {
    expect(planIssueId('# P\n\n## Status\n\n- **State:** Approved\n- **Issue:** #3064\n\n## Next\n')).toBe('3064');
  });

  it('reads a Jira key', () => {
    expect(planIssueId('## Status\n- **Issue:** ABC-12\n')).toBe('ABC-12');
  });

  it('answers null for no line or a line naming no issue', () => {
    expect(planIssueId('## Status\n- **State:** Approved\n')).toBeNull();
    expect(planIssueId('## Status\n- **Issue:** none\n')).toBeNull();
  });
});
