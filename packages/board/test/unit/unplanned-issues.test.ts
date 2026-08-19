import { describe, it, expect } from 'vitest';
import { inferredPlanName, ageLabel } from '../../src/app/components/AgentList.js';
import { FleetSchema, IssueRowSchema } from '../../src/contract/schema.js';

/**
 * An issue is a signal the board can see — the decisions that reduce to
 * functions and to the contract.
 *
 * What only a rendered page can settle (the name is not an anchor, the branch
 * column is empty, a numberless host renders plain text) lives in
 * `test/integration/unplanned-issues.browser.test.ts`.
 */

describe('inferredPlanName — a proposal, not a promise', () => {
  it('slugs a title the way this repo names plans', () => {
    expect(inferredPlanName('The fleet scan asks once, not once per branch'))
      .toBe('the-fleet-scan-asks-once-not');
  });

  it('drops a tracker area prefix, which says nothing about the work', () => {
    // "Board: one PR refresh costs three Bitbucket calls" — the real title of
    // #226, whose first word is the area rather than the subject.
    expect(inferredPlanName('Board: one PR refresh costs three calls'))
      .toBe('one-pr-refresh-costs-three-calls');
  });

  it('truncates without an ellipsis — nothing longer exists to point at', () => {
    const name = inferredPlanName('one two three four five six seven eight');
    expect(name).toBe('one-two-three-four-five-six');
    expect(name).not.toContain('…');
  });

  it('returns empty for a title with nothing sluggable, rather than punctuation', () => {
    expect(inferredPlanName('!!! ???')).toBe('');
  });
});

describe('ageLabel — one formatter, so two row kinds cannot disagree', () => {
  it('says minutes, hours and days the way a branch row does', () => {
    expect(ageLabel(45)).toBe('45m');
    expect(ageLabel(120)).toBe('2h');
    expect(ageLabel(60 * 24 * 3)).toBe('3d');
  });
});

describe('the contract keeps the three answers apart', () => {
  it('defaults to unsupported, never to answered', () => {
    // THE LOAD-BEARING DEFAULT. An older server sends no issues and no answer;
    // reading that silence as `answered` would render an empty inbox as a clear
    // one, from a server that was never asked.
    const fleet = FleetSchema.parse({
      generatedAt: '2026-08-19T00:00:00Z', ageSeconds: 1, ready: true, error: null,
      rows: [],
      summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
      stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
      prAgeSeconds: null, prError: null,
    });
    expect(fleet.issueAnswer).toBe('unsupported');
    expect(fleet.issues).toEqual([]);
    expect(fleet.issueError).toBeNull();
  });

  it('an issue whose host gave no url carries "", not a guess', () => {
    const issue = IssueRowSchema.parse({ number: 228, title: 'A signal' });
    expect(issue.url).toBe('');
    // Null rather than 0: 0 would claim the issue was opened this instant.
    expect(issue.ageMinutes).toBeNull();
  });
});
