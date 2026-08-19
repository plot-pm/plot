import { describe, it, expect } from 'vitest';
import { armedLabel, refusalReason } from '../../src/app/components/CreatePlanButton.js';
import type { IssueRow } from '../../src/contract/schema.js';

/**
 * The issue row's one action — the decisions that reduce to functions.
 *
 * What only a rendered page can settle (the confirmation arms, a double click
 * sends one POST, the body carries only a number) lives in
 * `test/integration/issue-becomes-a-plan.browser.test.ts`.
 *
 * **`refusalReason` is asserted here because it is defence in depth.** Wave 1
 * renders issue rows only where `issueAnswer === 'answered'`, so today an
 * `unsupported` or `failed` tracker produces no row and therefore no action —
 * a structural guarantee the browser test asserts. This function is what would
 * refuse if a row ever reached the page on a non-`answered` answer, which is a
 * real possibility: `refreshIssues` KEEPS the last good list when a lookup
 * fails. A branch with no reachable caller today is exactly the branch that
 * rots, so it is pinned here rather than left to a page that cannot show it.
 */

const issue = (over: Partial<IssueRow> = {}): IssueRow => ({
  number: 228, title: 'Fleet scan asks the host once per branch', url: '', ageMinutes: 120,
  ...over,
});

const CAN = { available: true, reason: '' };

describe('the armed label names the boundary, not just the act', () => {
  it('says Draft, because that is what the reader is committing to', () => {
    // A label reading only "create a plan" would leave a reader wondering
    // whether the click also commits the work — precisely the decision this row
    // asks them to make separately.
    expect(armedLabel(issue())).toBe('Create plan — Draft for #228?');
  });
});

describe('two independent questions, and both must pass', () => {
  it('offers the action when the board can act and the tracker answered', () => {
    expect(refusalReason(CAN, 'answered')).toBe('');
  });

  it('refuses a host with no issue read, whatever the binding says', () => {
    // `unsupported` is a standing fact about Bitbucket, not an outage — and it
    // outranks an available binding, because no amount of localhost makes a
    // tracker answerable.
    expect(refusalReason(CAN, 'unsupported')).toMatch(/no issue read/);
  });

  it('refuses a failed lookup, and never calls it "no issues"', () => {
    // AN OUTAGE IS NOT AN ANSWER, in this direction too. The row is on screen
    // because the last good lookup found it, so the message must say the lookup
    // is broken rather than imply the issue is gone.
    const reason = refusalReason(CAN, 'failed');
    expect(reason).toMatch(/failing/);
    expect(reason).not.toMatch(/no issues/);
  });

  it('refuses a board bound off localhost, and passes the reason through', () => {
    // The server's own sentence, not a paraphrase: it names the binding, which
    // is the fact a reader needs to fix it.
    const bound = { available: false, reason: 'the board is bound to 0.0.0.0, not localhost' };
    expect(refusalReason(bound, 'answered')).toBe(bound.reason);
  });

  it('still refuses when the board says nothing about why', () => {
    // An older server sends `available: false` with no reason. The control must
    // still refuse and still say something — silence beside a dimmed button is
    // the state a reader cannot act on.
    expect(refusalReason({ available: false, reason: '' }, 'answered')).not.toBe('');
  });

  it('names the TRACKER first when both are unavailable', () => {
    // The order is deliberate. A Bitbucket repo on a Tailscale binding fails
    // both tests, and "this host has no issue read" is the one that will still
    // be true tomorrow — telling the reader to move to localhost would send
    // them to fix the half that would not help.
    expect(refusalReason({ available: false, reason: 'bound to 0.0.0.0' }, 'unsupported'))
      .toMatch(/no issue read/);
  });
});
