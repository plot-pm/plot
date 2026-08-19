// `parseClaim` — reading the dispatcher's own words, and inventing none.
//
// The endpoint's rule is that every fact it reports is something
// `plot-dispatch.sh` PRINTED: nothing here asks git a second question. A second
// question would be asked at a different moment than the claim, and its answer
// could disagree with the act it claims to describe — which is the class of bug
// `/api/claim` exists to spare its caller.
//
// So the parser is where that rule is testable as a value, without a server, a
// repo, or a push.
import { describe, it, expect } from 'vitest';
import { parseClaim } from '../../src/server/claim.js';

const SUMMARY = 'summary: dispatched=1 reused=0 skipped=0 started=0 brief=missing worker=suppressed';

describe('parseClaim', () => {
  it('reads a winning claim out of the `dispatched` line', () => {
    const r = parseClaim('ship-it', `dispatched feature/x → /tmp/wt/plot-wt-feature-x\n${SUMMARY}`);
    expect(r.claimed).toBe(true);
    expect(r.branch).toBe('feature/x');
    expect(r.worktree).toBe('/tmp/wt/plot-wt-feature-x');
    expect(r.slug).toBe('ship-it');
    expect(r.summary).toBe(SUMMARY);
  });

  it('treats an adopted worktree as claimed — the branch is ours either way', () => {
    // `plot-dispatch.sh` is idempotent by design: re-running adopts rather than
    // duplicates. A caller re-asking after a crash must be told it HOLDS the
    // branch, not that nothing happened — the second reading would send it to
    // claim something else and abandon a worktree it owns.
    const r = parseClaim('s', 'reusing existing worktree for feature/x → /tmp/wt/plot-wt-feature-x');
    expect(r.claimed).toBe(true);
    expect(r.branch).toBe('feature/x');
    expect(r.worktree).toBe('/tmp/wt/plot-wt-feature-x');
  });

  it('prefers a NEW claim over an adopted one when a run reports both', () => {
    // `--max 1` makes this rare rather than impossible. A run that claimed
    // something new is reporting the stronger fact, and it is the one the
    // caller asked for.
    const r = parseClaim('s', [
      'reusing existing worktree for feature/old → /tmp/wt/old',
      'dispatched feature/new → /tmp/wt/new',
    ].join('\n'));
    expect(r.branch).toBe('feature/new');
  });

  it('reports a lost race as a fact, with the loser\'s own reason', () => {
    // Losing is the NORMAL outcome of two dispatchers asking at once: the refs
    // diverge and git rejects the second push, which IS the concurrency
    // control. The caller needs to know it should ask for different work.
    const r = parseClaim('s', 'skipped feature/x (claimed by another session)');
    expect(r.claimed).toBe(false);
    expect(r.branch).toBeNull();
    expect(r.worktree).toBeNull();
    expect(r.reason).toMatch(/claimed by another session/);
  });

  it('distinguishes "someone won it" from "there is nothing to take"', () => {
    // The script says NOTHING when the eligible set is empty, and a silence is
    // not a reason a caller can act on. The two produce the same `claimed:
    // false` and mean opposite things — ask for different work, versus stop
    // asking about this plan — so the endpoint supplies the missing sentence
    // rather than forwarding an empty string.
    const empty = parseClaim('s', 'summary: dispatched=0 reused=0 skipped=0 started=0');
    expect(empty.claimed).toBe(false);
    expect(empty.reason).toMatch(/nothing eligible/);
    expect(empty.reason).not.toMatch(/another session/);
  });

  it('survives a script that printed nothing at all', () => {
    // A killed or crashed dispatcher. The answer must still be a well-formed
    // negative rather than a throw that becomes a 500 — the caller learns it
    // holds nothing, which is true.
    const r = parseClaim('s', '');
    expect(r.claimed).toBe(false);
    expect(r.branch).toBeNull();
    expect(r.reason).toMatch(/nothing eligible/);
    expect(r.summary).toBe('');
  });

  it('keeps a branch name containing slashes whole', () => {
    // `→` is the script's own separator and a literal in its format string;
    // branch names contain `/` as the normal case (`feature/x`), and splitting
    // on anything else would truncate them.
    const r = parseClaim('s', 'dispatched feature/deep/nested-name → /tmp/wt/plot-wt-feature-deep-nested-name');
    expect(r.branch).toBe('feature/deep/nested-name');
  });
});
