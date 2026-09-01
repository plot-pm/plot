import { describe, it, expect } from 'vitest';
import {
  sample,
  publication,
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
