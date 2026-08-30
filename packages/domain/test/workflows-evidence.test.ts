import { describe, it, expect } from 'vitest';
import { EVIDENCE, isScriptVerified, decide, refuse } from '../src/workflows/index.js';

/**
 * The plan requires the two prose-derived workflows to be marked IN THE CODE as
 * fixture-verified only, and a comment saying so cannot be asserted on.
 *
 * These tests are the marking's teeth: they fail if either workflow is ever
 * promoted to `script`, which is the direction the mistake would go — a later
 * reader seeing five workflows tested alike and levelling the field.
 */
describe('evidence — what each workflow’s expression can be checked against', () => {
  it.each(['approve', 'deliver', 'reap'] as const)(
    '%s is backed by a script, which has an exit code',
    (workflow) => {
      expect(EVIDENCE[workflow]).toBe('script');
      expect(isScriptVerified(workflow)).toBe(true);
    },
  );

  it.each(['implement', 'release'] as const)(
    '%s is FIXTURE-VERIFIED ONLY — its specification is prose, and prose cannot fail',
    (workflow) => {
      expect(EVIDENCE[workflow]).toBe('fixture');
      expect(isScriptVerified(workflow)).toBe(false);
    },
  );

  it('marks every workflow, so a new one cannot arrive unclassified', () => {
    expect(Object.keys(EVIDENCE).sort()).toEqual([
      'approve',
      'deliver',
      'implement',
      'reap',
      'release',
    ]);
  });
});

describe('outcomes carry the workflow that produced them', () => {
  it('names the workflow on a decision', () => {
    expect(decide('approve', [], null).workflow).toBe('approve');
  });

  it('names the workflow and the rule on a refusal', () => {
    const out = refuse('deliver', 'phase-wrong', 'because');
    expect([out.workflow, out.reason, out.detail]).toEqual(['deliver', 'phase-wrong', 'because']);
  });
});
