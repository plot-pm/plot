import {
  describe,
  it,
  expect } from 'vitest';
import { inferredPlanName,
} from '../../src/app/components/AgentList.js';
import { ageLabel } from '../../src/app/lib/agent-rows/row-identity.js';
import { FleetSchema, IssueRowSchema, issueKey } from '../../src/contract/schema.js';

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


  it('an issue key is a string — a Jira key survives the contract', () => {
    // `plot-host.sh` projects `number: .key`, so a Jira arm puts `PROJ-123` on
    // the wire. `z.number()` rejected it, which is the type half of the defect:
    // the entity docstring already said "an opaque string" and four consumers
    // said otherwise.
    const issue = IssueRowSchema.parse({ number: 'PROJ-123', title: 'A ticket' });
    expect(issue.number).toBe('PROJ-123');
  });

  it('a GitHub number arrives as a string, losslessly', () => {
    // `123` and `"123"` name the same issue. The host emits a JSON number for
    // GitHub and a quoted key for Jira, so the contract coerces the one form
    // that is lossless rather than rejecting half the hosts.
    const issue = IssueRowSchema.parse({ number: 849, title: 'A signal' });
    expect(issue.number).toBe('849');
  });


  it('an issue whose host gave no url carries "", not a guess', () => {
    const issue = IssueRowSchema.parse({ number: 228, title: 'A signal' });
    expect(issue.url).toBe('');
    // Null rather than 0: 0 would claim the issue was opened this instant.
    expect(issue.ageMinutes).toBeNull();
  });
});

describe('issueKey — one normalisation, so the two sides cannot disagree', () => {
  it('makes a GitHub number and its string form compare equal', () => {
    // The host emits a JSON number; a plan records `#849` which the parser
    // emits as a number too — but a Jira plan records a quoted key. Both sides
    // pass through here so the comparison is string-to-string either way.
    expect(issueKey(849)).toBe(issueKey('849'));
  });

  it('leaves a Jira key exactly as the tracker spells it', () => {
    // `PROJ-123` has no integer form at all, which is why the type is
    // unfixable in the other direction.
    expect(issueKey('PROJ-123')).toBe('PROJ-123');
  });

  it('never coerces a key to NaN', () => {
    // `Number('PROJ-123')` is NaN, and a Set of NaN matches nothing — a filter
    // that never fires, which is exactly the behaviour being fixed.
    expect(issueKey('PROJ-123')).not.toBe('NaN');
    expect(Number.isNaN(Number(issueKey('PROJ-123')))).toBe(true);
  });
});

describe('the inbox drains — the assertion a type-only change would pass without', () => {
  /**
   * The rule that makes the inbox an inbox: open tracker issues no plan
   * references. Stated here as the set membership it reduces to, because that
   * is the comparison `refreshIssues` performs and the one that silently never
   * matched.
   */
  const unreferenced = (
    open: (string | number)[],
    referenced: (string | number)[],
  ) => {
    const seen = new Set(referenced.map(issueKey));
    return open.filter((n) => !seen.has(issueKey(n)));
  };

  it('a Jira ticket answered by a plan LEAVES the inbox', () => {
    // The whole point. `PROJ-123` from the host against `PROJ-123` from the
    // plan: before this change the plan side was absent and the host side was
    // compared against a Set<number>, so it never matched and the ticket sat
    // in the inbox through deliver and release.
    expect(unreferenced(['PROJ-123', 'PROJ-9'], ['PROJ-123'])).toEqual(['PROJ-9']);
  });

  it('a GitHub issue still drains — the regression this could most easily cause', () => {
    // `849` from the host, `849` from the parser, both through issueKey.
    expect(unreferenced([849, 850], [849])).toEqual([850]);
  });

  it('a plan referencing nothing drains nothing — absent is not false', () => {
    expect(unreferenced([849, 'PROJ-1'], [])).toEqual([849, 'PROJ-1']);
  });
});
