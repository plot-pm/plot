import { describe, expect, it } from 'vitest';

import { BranchStateSchema } from '../src/entities/fleet.js';
import { branchState, type BranchReadings } from '../src/rules/branch-state.js';

/**
 * ONE CASE PER STATE, FROM READINGS THE TEST SUPPLIES — no host, no git.
 *
 * That is what makes all eight reachable. The live estate holds four of them:
 * `open`, `wip`, `deferred` and `waiting`, measured 2026-09-04, so `merged`,
 * `claimed`, `blocked` and `unknown` are only ever exercised here.
 *
 * The cases are taken from `plot-fleet-scan.sh`'s own branches rather than from
 * a summary of them: a reimplementation checked against someone's understanding
 * of the original inherits the misunderstanding, and this plan's interrogation
 * found two confident wrong claims about that script in three rounds.
 */

/**
 * A branch nobody has started: a ref that has never existed, a host that
 * answered and found nothing.
 *
 * Every case below states only what it changes.
 */
const unstarted: BranchReadings = {
  deferredByPlan: false,
  refTip: null,
  mainTip: 'aaa',
  mergeSubjectFound: false,
  hostReach: 'ok',
  pr: 'none',
  commitsAhead: 0,
  realCommitsAhead: 0,
  waits: null,
};

const reading = (over: Partial<BranchReadings>): BranchReadings => ({ ...unstarted, ...over });

describe('each of the eight states is produced from readings', () => {
  it('open — no ref, no merge evidence, and a host that answered', () => {
    expect(branchState(unstarted)).toBe('open');
  });

  it('claimed — a ref whose only commits beyond main are claim markers', () => {
    expect(branchState(reading({ refTip: 'bbb', commitsAhead: 1, realCommitsAhead: 0 }))).toBe(
      'claimed',
    );
  });

  it('wip — a ref carrying real work main does not have', () => {
    expect(branchState(reading({ refTip: 'bbb', commitsAhead: 3, realCommitsAhead: 2 }))).toBe(
      'wip',
    );
  });

  it('merged — a ref behind main, carrying nothing of its own', () => {
    expect(branchState(reading({ refTip: 'bbb', mainTip: 'aaa' }))).toBe('merged');
  });

  it('deferred — the plan gave the branch up', () => {
    expect(branchState(reading({ deferredByPlan: true }))).toBe('deferred');
  });

  it('unknown — the host was asked and could not answer', () => {
    expect(branchState(reading({ hostReach: 'throttled', pr: 'unreadable' }))).toBe('unknown');
  });

  it('waiting — the prerequisite has an open pull request', () => {
    expect(branchState(reading({ waits: { branch: 'feature/first', pr: 'OPEN' } }))).toBe('waiting');
  });

  it('blocked — the host has never seen a pull request for the prerequisite', () => {
    expect(branchState(reading({ waits: { branch: 'feature/typo', pr: 'none' } }))).toBe('blocked');
  });

  it('produces nothing outside the eight the entity declares', () => {
    // THE NINTH-STATE GUARD. The board groups every section by these words, so
    // a state this rule invented would render nowhere and be found by a reader
    // rather than by a test.
    const every: BranchReadings[] = [
      unstarted,
      reading({ refTip: 'bbb', commitsAhead: 1, realCommitsAhead: 0 }),
      reading({ refTip: 'bbb', commitsAhead: 3, realCommitsAhead: 2 }),
      reading({ refTip: 'bbb' }),
      reading({ deferredByPlan: true }),
      reading({ hostReach: 'failed', pr: 'unreadable' }),
      reading({ waits: { branch: 'feature/first', pr: 'CLOSED' } }),
      reading({ waits: { branch: 'feature/typo', pr: 'none' } }),
    ];
    for (const one of every) {
      expect(BranchStateSchema.options).toContain(branchState(one));
    }
  });
});

describe("a plan's deferred: beats a merged ref", () => {
  it('answers deferred for a branch git says merged', () => {
    // The asymmetry the corpus must respect: `deferred` is applied at the call
    // site in the shell, so a branch can be merged in git and deferred in the
    // plan, and the plan wins.
    expect(
      branchState(reading({ deferredByPlan: true, refTip: 'bbb', mainTip: 'aaa' })),
    ).toBe('deferred');
  });

  it('answers deferred for a branch carrying work', () => {
    expect(
      branchState(
        reading({ deferredByPlan: true, refTip: 'bbb', commitsAhead: 4, realCommitsAhead: 4 }),
      ),
    ).toBe('deferred');
  });

  it('answers deferred even where a prerequisite is unmerged', () => {
    // Somebody gave the branch up, which is a decision, while waiting is a
    // measurement.
    expect(
      branchState(reading({ deferredByPlan: true, waits: { branch: 'feature/first', pr: 'OPEN' } })),
    ).toBe('deferred');
  });
});

describe("a prerequisite's state beats open and unknown, and nothing else", () => {
  it('replaces open', () => {
    expect(branchState(reading({ waits: { branch: 'feature/first', pr: 'OPEN' } }))).toBe('waiting');
  });

  it('replaces unknown', () => {
    expect(
      branchState(
        reading({
          hostReach: 'failed',
          pr: 'unreadable',
          waits: { branch: 'feature/first', pr: 'OPEN' },
        }),
      ),
    ).toBe('waiting');
  });

  it('leaves wip alone', () => {
    expect(
      branchState(
        reading({
          refTip: 'bbb',
          commitsAhead: 2,
          realCommitsAhead: 2,
          waits: { branch: 'feature/first', pr: 'OPEN' },
        }),
      ),
    ).toBe('wip');
  });

  it('leaves claimed alone', () => {
    expect(
      branchState(
        reading({
          refTip: 'bbb',
          commitsAhead: 1,
          realCommitsAhead: 0,
          waits: { branch: 'feature/first', pr: 'OPEN' },
        }),
      ),
    ).toBe('claimed');
  });

  it('leaves merged alone — overriding it would stop the wave settling forever', () => {
    expect(
      branchState(
        reading({ refTip: 'bbb', mainTip: 'aaa', waits: { branch: 'feature/first', pr: 'OPEN' } }),
      ),
    ).toBe('merged');
  });

  it('clears when the prerequisite merged', () => {
    expect(branchState(reading({ waits: { branch: 'feature/first', pr: 'MERGED' } }))).toBe('open');
  });

  it('waits rather than blocks on a closed pull request', () => {
    // The host has seen the branch, so nothing is misspelt: somebody withdrew
    // the work, and that resolves by reopening it rather than by editing the
    // plan.
    expect(branchState(reading({ waits: { branch: 'feature/first', pr: 'CLOSED' } }))).toBe(
      'waiting',
    );
  });

  it('waits rather than blocks on an unreadable host', () => {
    // Silence is not evidence in either direction: not permission to start, and
    // not proof of a typo.
    expect(branchState(reading({ waits: { branch: 'feature/first', pr: 'unreadable' } }))).toBe(
      'waiting',
    );
  });
});

describe('unknown marks an absent reading, never an empty one', () => {
  it('answers open where the host was never asked', () => {
    // `unasked` — no host configured, or `--offline`. The scan was never going
    // to ask, so nothing was lost.
    expect(branchState(reading({ hostReach: 'unasked', pr: 'unreadable' }))).toBe('open');
  });

  it('answers open where the host answered that no pull request exists', () => {
    // An EMPTY reading: the host answered, and the answer is none.
    expect(branchState(reading({ hostReach: 'ok', pr: 'none' }))).toBe('open');
  });

  it.each(['throttled', 'secondary', 'failed'] as const)(
    'answers unknown where the host was asked and could not answer (%s)',
    (hostReach) => {
      expect(branchState(reading({ hostReach, pr: 'unreadable' }))).toBe('unknown');
    },
  );

  it('answers open where the host is ok, whatever the branch reads', () => {
    // The three failures gate it, never "not ok" — flipping every unstarted
    // branch to `unknown` on an offline scan would be a far larger change than
    // the defect.
    expect(branchState(reading({ hostReach: 'ok', pr: 'unreadable' }))).toBe('open');
  });

  it('never answers unknown for a branch with a ref', () => {
    // The host failure is read only in the no-ref arm: a branch with a ref has
    // git evidence of its own.
    expect(
      branchState(
        reading({ refTip: 'bbb', hostReach: 'failed', pr: 'unreadable', commitsAhead: 2, realCommitsAhead: 2 }),
      ),
    ).toBe('wip');
  });
});

describe('the ref check stays in front of the merge lookup', () => {
  it('reads a recreated branch as wip, not merged, while a stale merge subject names it', () => {
    // Merge `bug/flaky`, delete it, recreate it for a second attempt. The first
    // attempt's merge subject is still on main and is now stale evidence. A
    // rule that read it first would report in-flight work as `merged` and open
    // the next wave on it.
    expect(
      branchState(
        reading({ refTip: 'bbb', mergeSubjectFound: true, commitsAhead: 2, realCommitsAhead: 2 }),
      ),
    ).toBe('wip');
  });

  it('reads a recreated branch as claimed while a stale merge subject names it', () => {
    expect(
      branchState(
        reading({ refTip: 'bbb', mergeSubjectFound: true, commitsAhead: 1, realCommitsAhead: 0 }),
      ),
    ).toBe('claimed');
  });

  it('reads the merge subject only where the ref is gone', () => {
    expect(branchState(reading({ mergeSubjectFound: true }))).toBe('merged');
  });

  it("prefers the local subject to the host's silence", () => {
    // The subject is positive local evidence and needs no host round trip.
    expect(
      branchState(reading({ mergeSubjectFound: true, hostReach: 'failed', pr: 'unreadable' })),
    ).toBe('merged');
  });

  it("takes the host's merged answer where no subject names the branch", () => {
    // The ordinary case under a squash merge.
    expect(branchState(reading({ pr: 'MERGED' }))).toBe('merged');
  });
});

describe('a branch reset to main holds nothing', () => {
  it('answers open when its tip equals main', () => {
    // Measured 2026-08-29: a branch reset to `origin/main` so a worker could
    // rebuild it, its pull request CLOSED and never merged, read `merged` and
    // settled its wave onto work that does not exist.
    expect(branchState(reading({ refTip: 'aaa', mainTip: 'aaa' }))).toBe('open');
  });

  it('answers merged when its tip is behind main', () => {
    expect(branchState(reading({ refTip: 'bbb', mainTip: 'aaa' }))).toBe('merged');
  });

  it('answers merged where main cannot be read and the tip differs', () => {
    // The tips are compared, not resolved: an unreadable main is not equality.
    expect(branchState(reading({ refTip: 'bbb', mainTip: null }))).toBe('merged');
  });
});

describe('a resurrected ref is corrected by the host and by nothing else', () => {
  it('answers merged where a squash-merged branch was pushed back', () => {
    // `ahead > 0` and `real > 0` — the pre-squash commits are unreachable from
    // main — so the walk alone calls finished work `wip`. Measured 2026-08-23:
    // `bug/done-holds-finished-plans-only` read `wip` for three hours.
    expect(
      branchState(reading({ refTip: 'bbb', commitsAhead: 5, realCommitsAhead: 5, pr: 'MERGED' })),
    ).toBe('merged');
  });

  it.each(['OPEN', 'CLOSED', 'none', 'unreadable'] as const)(
    'leaves wip standing on a %s pull request',
    (pr) => {
      // Only MERGED may override the walk, and only toward `merged`.
      expect(
        branchState(reading({ refTip: 'bbb', commitsAhead: 5, realCommitsAhead: 5, pr })),
      ).toBe('wip');
    },
  );

  it('does not promote a claim to merged on an open pull request', () => {
    expect(
      branchState(reading({ refTip: 'bbb', commitsAhead: 1, realCommitsAhead: 0, pr: 'OPEN' })),
    ).toBe('claimed');
  });

  it('leaves a claim-only branch claimed even where a pull request merged', () => {
    // The claim arm returns BEFORE the host override, in the shell and here.
    // The override belongs to the work arm, where a resurrected ref is the case
    // it corrects; a branch whose only commits are claim markers carries no
    // work a squash merge could have rewritten.
    expect(
      branchState(reading({ refTip: 'bbb', commitsAhead: 1, realCommitsAhead: 0, pr: 'MERGED' })),
    ).toBe('claimed');
  });
});
