// What a monitor's findings mean for a reader, decided over values.
//
// THE FINDINGS THEMSELVES ARE THE INPUT, not a socket and not a file. The
// channel slice proved the protocol; this proves what a finding NAMES once it
// has arrived, and the two share no code — which is why the plan split them.
import { describe, it, expect } from 'vitest';
import {
  currentFindings,
  findingReading,
  isErrand,
  monitorSubject,
} from '../src/rules/attention.js';
import { MEASURED_BY, type Finding, type FindingName } from '../src/entities/finding.js';

/** One reading; every test names the ONE field it changes. */
const finding = (over: Partial<Finding> = {}): Finding => ({
  monitor: 'AgentMonitor',
  branch: 'feature/one',
  worktree: '/w/one',
  finding: 'owes a review',
  since: '2026-08-31T10:00:00Z',
  evidence: '4 commits ahead, no PR',
  measuredAt: '2026-08-31T10:00:00Z',
  ...over,
});

describe('the findings that hold now', () => {
  it('keeps one finding per monitor and branch, the latest winning', () => {
    const held = currentFindings([
      finding({ finding: 'holds unlanded work', measuredAt: '2026-08-31T10:00:00Z' }),
      finding({ finding: 'owes a review', measuredAt: '2026-08-31T10:05:00Z' }),
    ]);

    expect(held).toHaveLength(1);
    expect(held[0].finding).toBe('owes a review');
  });

  it('keeps both monitors\' readings about one branch', () => {
    const held = currentFindings([
      finding({ monitor: 'AgentMonitor', finding: 'owes a review' }),
      finding({ monitor: 'WorkerMonitor', finding: 'idle' }),
    ]);

    expect(held.map((f) => f.monitor).sort()).toEqual(['AgentMonitor', 'WorkerMonitor']);
  });

  it('keeps both branches\' readings from one monitor', () => {
    const held = currentFindings([
      finding({ branch: 'feature/one' }),
      finding({ branch: 'feature/two' }),
    ]);

    expect(held).toHaveLength(2);
  });

  // THE CLEARING CLAUSE. `clear` is a retraction, not a finding — the line the
  // AgentMonitor writes when a PR is opened over an `owes a review` branch.
  it('drops the finding a `clear` retracts, leaving no entry behind', () => {
    const held = currentFindings([
      finding({ finding: 'owes a review' }),
      finding({ finding: 'clear', evidence: 'the owes a review finding no longer holds' }),
    ]);

    expect(held).toEqual([]);
  });

  it('clears only the monitor that retracted, not the other', () => {
    const held = currentFindings([
      finding({ monitor: 'AgentMonitor', finding: 'owes a review' }),
      finding({ monitor: 'WorkerMonitor', finding: 'idle' }),
      finding({ monitor: 'AgentMonitor', finding: 'clear' }),
    ]);

    expect(held.map((f) => f.finding)).toEqual(['idle']);
  });

  it('lets a finding published after a clear hold again', () => {
    const held = currentFindings([
      finding({ finding: 'owes a review' }),
      finding({ finding: 'clear' }),
      finding({ finding: 'owes a gate' }),
    ]);

    expect(held.map((f) => f.finding)).toEqual(['owes a gate']);
  });

  it('answers nothing for a log nobody wrote to', () => {
    expect(currentFindings([])).toEqual([]);
  });
});

describe('what a finding asks a reader to do', () => {
  // TOTALITY, asserted rather than reviewed. A monitor gaining a finding must
  // not leave the attention surface silent about it.
  it('reads every finding a monitor can publish', () => {
    for (const name of Object.keys(MEASURED_BY) as FindingName[]) {
      if (!isErrand(name)) continue;
      const reading = findingReading(name);
      expect(reading, name).not.toBeNull();
      expect(reading?.action, name).not.toBe('');
    }
  });

  it('reads `clear` as no errand at all', () => {
    expect(findingReading('clear')).toBeNull();
  });

  // A GREEN BUILD IS NOT WORK. A list that carried it would report a thing
  // going right as something to do.
  it('reads `build passed` as no errand', () => {
    expect(isErrand('build passed')).toBe(false);
    expect(findingReading('build passed')).toBeNull();
  });

  it('sends `owes a review` to an agent, because an agent can open the PR', () => {
    expect(findingReading('owes a review')).toEqual({
      verdict: 'owes-review',
      action: 'open a PR for it',
      list: 'needsAgent',
    });
  });

  // ITS OWN LIST, for the reason `question` has one: restarting a worker
  // holding the door open re-runs what it finished before it asked.
  it('sends `owes an answer` to the waiting list, never to an agent', () => {
    expect(findingReading('owes an answer')?.list).toBe('waiting');
  });

  it('sends a failing build to a person', () => {
    expect(findingReading('build failed')?.list).toBe('needsHuman');
  });
});

describe('which monitor found it', () => {
  // A WorkerMonitor `idle` and an AgentMonitor finding call for different
  // responses, so an entry must not flatten them.
  it('names a different subject for each monitor', () => {
    const subjects = ['WorkerMonitor', 'AgentMonitor', 'BuildMonitor'].map((m) =>
      monitorSubject(m as Finding['monitor']),
    );

    expect(new Set(subjects).size).toBe(3);
    expect(subjects).toEqual(['the process', 'the desk', 'the run']);
  });
});
