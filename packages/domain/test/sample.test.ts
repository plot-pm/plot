import { describe, it, expect } from 'vitest';
import {
  publication,
  idleNow,
  type DeskReading,
} from '../src/rules/sample.js';

describe('publication — a held finding is published once', () => {
  it('publishes the finding at the moment it first holds', () => {
    expect(publication('silent', 'idle')).toBe('idle');
  });

  it('says nothing while the same finding keeps holding', () => {
    expect(publication('idle', 'idle')).toBeNull();
  });

  it('says nothing while nothing holds', () => {
    expect(publication('silent', 'silent')).toBeNull();
  });

  it('retracts a finding that stopped holding', () => {
    // THE CLEARING CASE IS NEWS TOO. A board that only ever hears about the
    // onset leaves a stale entry up after the worker recovered, and an operator
    // learns that entries are not to be believed.
    expect(publication('idle', 'silent')).toBe('clear');
  });

  it('publishes a finding that replaced another', () => {
    expect(publication('idle', 'gone')).toBe('gone');
  });
});

describe('the vocabulary is a contract with the spec', () => {
  // `stalled` is an AGENT fact — exited 0, unlanded work, no PR. A stalled
  // agent has work to rescue; an idle worker may just be waiting on the
  // network. An earlier draft reused the name and put a process fact on the
  // agent side, which is the exact confusion CLAUDE.md's Machine/Registry split
  // exists to prevent.
  it('never says stalled', () => {
    const said = [
      idleNow({
        pid: 'alive', spoken: true, silenceSeconds: 900, childOnCore: false,
        treeQuietSeconds: 900, commits: 'yes',
      }, 900),
      publication('idle', 'silent'),
    ];
    expect(said.join(' ')).not.toMatch(/stall/i);
  });
});

/**
 * A live agent whose conversation has spoken, silent past the window, with no
 * child on a core, over a tree nothing has touched for just as long, on a
 * branch that already carries work.
 *
 * THE BASE CASE FIRES, so every test below names the single reading it changes
 * and what withholds the word is visible in the test itself. Both durations sit
 * exactly AT the window rather than far past it, because the boundary is where
 * a `>` written for a `>=` hides.
 */
const desk = (over: Partial<DeskReading> = {}): DeskReading => ({
  pid: 'alive',
  spoken: true,
  silenceSeconds: 900,
  childOnCore: false,
  treeQuietSeconds: 900,
  commits: 'yes',
  ...over,
});

describe('idleNow — the one-sample rule', () => {
  it('reports idle on ONE reading where every condition holds', () => {
    // The whole slice in one assertion. `sample` needed two readings for this
    // and a process to hold the first; every condition here is a duration the
    // desk already records, so one answers it.
    expect(idleNow(desk(), 900)).toBe('idle');
  });

  // ── each condition false ALONE ──────────────────────────────────────────
  // SIX CASES, and they catch an `&&` that became an `||`. A rule that ORs its
  // conditions still answers `idle` for the base case above, so the base case
  // alone proves nothing about the conjunction.

  it('is silent where the pid is dead, and never gone', () => {
    // NO `gone` ARM. The wrapper that starts the agent knows the instant it
    // ends and publishes `gone` itself, so this rule has none and no caller
    // needs one. Asserted as `silent` rather than merely `not idle`, because
    // a `gone` here would reach a findings file as a restart request.
    expect(idleNow(desk({ pid: 'dead' }), 900)).toBe('silent');
  });

  it('is silent where the pid was never recorded', () => {
    // THE STARTUP WINDOW. The wrapper backgrounds the watcher BEFORE it writes
    // the pid file, so an absent or empty file means the birth has not been
    // recorded yet — a missing reading, not a dead process.
    expect(idleNow(desk({ pid: 'unrecorded' }), 900)).toBe('silent');
  });

  it('is silent where the conversation has not spoken', () => {
    // #1074. After a hop the loop mints a fresh handle, and the new
    // conversation has no transcript until its first line — so the desk's
    // silence belongs to the PREVIOUS slice and is not this worker's.
    expect(idleNow(desk({ spoken: false }), 900)).toBe('silent');
  });

  it('is silent where a child is on a core', () => {
    // THE VETO, and the case a threshold alone cannot cover. 28 of the 37
    // over-window stretches wave 1 measured were an agent waiting on its own
    // command; what separates that agent from a stopped one is a child burning
    // CPU, and nothing else can say so.
    expect(idleNow(desk({ childOnCore: true }), 900)).toBe('silent');
  });

  it('is silent where the branch carries no commits yet', () => {
    // WHERE THE FALSE POSITIVES WOULD HAVE BEEN. An agent given a hard first
    // slice is quiet for a long time with nothing to show, and calling that a
    // stall is the cry-wolf that costs the finding its readers.
    expect(idleNow(desk({ commits: 'no' }), 900)).toBe('silent');
  });

  it('is silent where the commit question could not be answered', () => {
    // `unanswerable` IS NOT `no`, and it is kept apart from it because the
    // readings differ: there is no local ref to count against, so the question
    // was never put. Counting against nothing would read every branch in a
    // remote-less repository as having committed — the failure
    // `plot_worker_task_state` records having made in the other direction.
    expect(idleNow(desk({ commits: 'unanswerable' }), 900)).toBe('silent');
  });

  // ── the boundary, for BOTH durations ────────────────────────────────────

  it('takes the window itself as quiet, for both durations', () => {
    // `>= window`, NOT `>`. The window is the point at which the question
    // becomes worth asking, so a desk exactly at it is eligible — the same
    // boundary `quiet -lt window → busy` draws from the other side.
    expect(idleNow(desk({ silenceSeconds: 900 }), 900)).toBe('idle');
    expect(idleNow(desk({ treeQuietSeconds: 900 }), 900)).toBe('idle');
  });

  it('is silent one second inside the window, for both durations', () => {
    // The other half of the boundary. Asserted for each duration separately:
    // a rule that checked only one would pass a test that moved both.
    expect(idleNow(desk({ silenceSeconds: 899 }), 900)).toBe('silent');
    expect(idleNow(desk({ treeQuietSeconds: 899 }), 900)).toBe('silent');
  });

  it('reads the window from its argument, not from a constant', () => {
    // A PROJECT WHOSE GATES ARE SLOWER THAN THIS REPO'S must be able to widen
    // the window, the same reason `Worker bound` is a config key. 900 s is this
    // estate's measurement and Plot does not assume every adopter's suite looks
    // like its own.
    expect(idleNow(desk({ silenceSeconds: 1200, treeQuietSeconds: 1200 }), 1800))
      .toBe('silent');
    expect(idleNow(desk({ silenceSeconds: 1800, treeQuietSeconds: 1800 }), 1800))
      .toBe('idle');
  });

  it('withholds the finding where either duration is unreadable', () => {
    // A FAILURE TO OBSERVE IS NOT EVIDENCE OF SOMETHING TO SEE. The caller maps
    // `unavailable` and `unreadable` onto a number the rule refuses, and this
    // asserts the refusal holds whichever shape arrives — zero would read as
    // *everything just moved* and a huge number as *nothing has moved in
    // years*, so a caller that guessed either would be inventing a reading.
    expect(idleNow(desk({ silenceSeconds: Number.NaN }), 900)).toBe('silent');
    expect(idleNow(desk({ treeQuietSeconds: Number.NaN }), 900)).toBe('silent');
  });

  it('answers idle for a desk far past the window, not only at it', () => {
    // The ordinary case an operator actually meets: a worker that stopped
    // hours ago. Asserted so the boundary tests above cannot be satisfied by a
    // rule that only ever fires AT the window.
    expect(idleNow(desk({ silenceSeconds: 99_999, treeQuietSeconds: 99_999 }), 900))
      .toBe('idle');
  });
});
