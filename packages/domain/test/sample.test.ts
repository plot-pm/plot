import { describe, it, expect } from 'vitest';
import {
  sample,
  publication,
  idleNow,
  type DeskReading,
  type MonitorReading,
  type MonitorVerdict,
} from '../src/rules/sample.js';

/**
 * A live agent whose subtree is frozen, over a tree that has not moved, on a
 * branch that already carries work.
 *
 * The base case is the one that FIRES, so every test below names the single
 * reading it changes and what withholds the word is visible in the test.
 */
const quiet = (over: Partial<MonitorReading> = {}): MonitorReading => ({
  pid: 'alive',
  activity: 'idle',
  fingerprint: 'unchanged',
  commits: 'yes',
  ...over,
});

/** Drive the rule over a run of readings, collecting what it would publish. */
const run = (readings: readonly MonitorReading[]): MonitorVerdict[] => {
  let previous: MonitorReading | null = null;
  const verdicts: MonitorVerdict[] = [];
  for (const reading of readings) {
    verdicts.push(sample(previous, reading));
    previous = reading;
  }
  return verdicts;
};

describe('sample — the two-sample rule', () => {
  it('reports nothing on a single idle reading', () => {
    // One idle reading is a process caught between syscalls. The COMPARISON is
    // the finding, so one pass cannot make it.
    expect(sample(null, quiet())).toBe('silent');
  });

  it('reports idle on two consecutive idle readings over an unchanged tree', () => {
    expect(sample(quiet(), quiet())).toBe('idle');
  });

  it('holds the finding from the second pass onward', () => {
    expect(run([quiet(), quiet(), quiet(), quiet()]))
      .toEqual(['silent', 'idle', 'idle', 'idle']);
  });
});

describe('sample — an agent with no commits is never idle', () => {
  // THE MIDDLE ROW, and the condition most easily lost when a rule moves
  // languages. An agent given a hard first slice is quiet for a long time with
  // nothing to show; calling that a stall is the cry-wolf that costs the
  // finding its readers. What separated the three stalls measured 2026-08-30 is
  // that each had already COMMITTED and then gone quiet.
  it('is silent however long a committed-nothing agent stays quiet', () => {
    const nothing = quiet({ commits: 'no' });
    expect(run([nothing, nothing, nothing, nothing, nothing, nothing]))
      .toEqual(['silent', 'silent', 'silent', 'silent', 'silent', 'silent']);
  });

  it('is silent when the commit question could not be answered', () => {
    // No local ref to count against. A failure to observe is not evidence of
    // something to see — the rule `plot_worker_task_state` reached the hard way
    // after a fallback read every clean branch in a remote-less repo as stalled.
    const unanswerable = quiet({ commits: 'unanswerable' });
    expect(run([unanswerable, unanswerable, unanswerable]))
      .toEqual(['silent', 'silent', 'silent']);
  });

  it('fires the moment the same quiet agent commits', () => {
    // The control. Without it the two tests above would pass against a rule
    // that never says `idle` at all.
    expect(sample(quiet({ commits: 'no' }), quiet({ commits: 'yes' }))).toBe('idle');
  });
});

describe('sample — a tree that changed resets the comparison', () => {
  // The third row of the truth table. An agent can write for a long time
  // without its subtree registering a centisecond in any one sample, so a
  // fingerprint that moved means something is plainly happening.
  it('is silent across a fingerprint that moved', () => {
    expect(sample(quiet({ fingerprint: 'a' }), quiet({ fingerprint: 'b' }))).toBe('silent');
  });

  it('is silent for every pass of a tree that moves each time', () => {
    expect(run(['a', 'b', 'c', 'd'].map((f) => quiet({ fingerprint: f }))))
      .toEqual(['silent', 'silent', 'silent', 'silent']);
  });
});

describe('sample — an unmeasurable subtree is not an idle one', () => {
  // `plot_worker_activity` answers `''` for a pid whose subtree holds no CPU
  // clock at all, and it refuses to call that `idle` for a stated reason: the
  // absence of a child is not the presence of an idle one. Collapsing the empty
  // answer here is how a monitor invents a stall.
  it('is silent however many empty readings arrive', () => {
    const blind = quiet({ activity: '' });
    expect(run([blind, blind, blind, blind])).toEqual(['silent', 'silent', 'silent', 'silent']);
  });

  it('is silent when only the previous pass was unmeasurable', () => {
    expect(sample(quiet({ activity: '' }), quiet())).toBe('silent');
  });
});

describe('sample — a busy worker says nothing', () => {
  // Silence means healthy. This is the property that keeps the findings file
  // worth reading: a monitor emitting a line per pass would bury the one line
  // that matters under a hundred that do not.
  it('is silent for every pass of a working agent', () => {
    const busy = quiet({ activity: 'working' });
    expect(run([busy, busy, busy, busy, busy, busy]))
      .toEqual(['silent', 'silent', 'silent', 'silent', 'silent', 'silent']);
  });
});

describe('sample — one reading is enough for gone, and only for gone', () => {
  // ASYMMETRIC ON PURPOSE. A dead process does not come back, so a second
  // confirmation costs a whole interval and buys nothing; a frozen CPU clock
  // genuinely can be transient, which is why `idle` pays for two and `gone`
  // does not.
  it('reports gone on the first reading that sees a dead pid', () => {
    expect(sample(null, quiet({ pid: 'dead' }))).toBe('gone');
  });

  it('reports gone on the pass that sees it, after any history', () => {
    expect(run([quiet({ activity: 'working' }), quiet({ activity: 'working' }), quiet({ pid: 'dead' })]))
      .toEqual(['silent', 'silent', 'gone']);
  });

  it('reports gone whatever the other readings say', () => {
    // Every other question is meaningless once the pid is dead — the CPU of a
    // subtree that is not there cannot be measured.
    expect(sample(quiet(), { pid: 'dead', activity: '', fingerprint: 'x', commits: 'unanswerable' }))
      .toBe('gone');
  });
});

describe('sample — an unrecorded pid is *not yet*, never gone', () => {
  // THE STARTUP WINDOW, inherited rather than widened. The wrapper backgrounds
  // the monitor BEFORE it writes the pid file, so the first pass can genuinely
  // land in the gap. Reporting a dead agent because its birth has not been
  // recorded would make the loudest finding the least trustworthy — and it
  // would fire on every worker, once, forever.
  it('is silent on an unrecorded pid', () => {
    expect(sample(null, quiet({ pid: 'unrecorded' }))).toBe('silent');
  });

  it('does not let an unrecorded pid count as a quiet pass', () => {
    // An agent whose pid is not yet recorded has no measurable subtree, so it
    // cannot be half of the two-sample comparison.
    expect(sample(quiet({ pid: 'unrecorded' }), quiet())).toBe('silent');
  });
});

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
      sample(quiet(), quiet()),
      sample(null, quiet({ pid: 'dead' })),
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
