import { describe, expect, it } from 'vitest';

import {
  EMPTY_TURN_GATE,
  TURNS_PER_DAY,
  TURN_GAP_MS,
  absorbFinding,
  paneLines,
  raisesToast,
  turnGate,
  type FollowedFinding,
  type TurnGateState,
} from '../src/rules/follow-channel.js';
import { findingKey, type Finding } from '../src/entities/finding.js';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);

const finding = (over: Partial<FollowedFinding> = {}): FollowedFinding => ({
  monitor: 'IndexMonitor',
  branch: 'feature/one',
  finding: 'checks failing',
  since: '2026-10-10T09:00:00Z',
  evidence: 'pull request #1',
  ...over,
});

const LISTED = ['checks failing', 'default branch red'];

describe('turnGate', () => {
  it('starts the first listed finding at once', () => {
    const actual = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);

    expect(actual.start).toBe(true);
    expect(actual.text).toContain('checks failing — feature/one: pull request #1');
    expect(actual.state).toMatchObject({ lastStartedAt: T0, count: 1, held: [] });
  });

  it('starts nothing for a finding that is not listed, whatever its name', () => {
    const actual = turnGate(EMPTY_TURN_GATE, finding({ finding: 'pr merged' }), T0, LISTED);

    expect(actual).toEqual({ start: false, text: '', state: EMPTY_TURN_GATE });
  });

  it('starts nothing by default: an empty list lists nothing', () => {
    expect(turnGate(EMPTY_TURN_GATE, finding(), T0, []).start).toBe(false);
  });

  it('holds a second finding at minute 4 and carries it into the turn at minute 6', () => {
    const first = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);
    const second = turnGate(first.state, finding({ branch: 'feature/two' }), T0 + 4 * MIN, LISTED);
    const third = turnGate(second.state, finding({ branch: 'feature/three' }), T0 + 6 * MIN, LISTED);

    expect(second.start).toBe(false);
    expect(second.state.held).toEqual(['checks failing — feature/two: pull request #1']);
    expect(third.start).toBe(true);
    expect(third.text).toBe(
      [
        'checks failing — feature/two: pull request #1',
        'checks failing — feature/three: pull request #1',
      ].join('\n'),
    );
    expect(third.state.held).toEqual([]);
  });

  it('measures the gap from the last started turn, not from the last held finding', () => {
    const first = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);
    const held = turnGate(first.state, finding({ branch: 'b' }), T0 + 4 * MIN, LISTED);

    expect(turnGate(held.state, finding({ branch: 'c' }), T0 + TURN_GAP_MS, LISTED).start).toBe(true);
  });

  it('adds a repeated line once', () => {
    const first = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);
    const a = turnGate(first.state, finding({ branch: 'b' }), T0 + MIN, LISTED);
    const b = turnGate(a.state, finding({ branch: 'b' }), T0 + 2 * MIN, LISTED);

    expect(b.state.held).toHaveLength(1);
  });

  it('starts no 25th turn in a day, and the next day resets the count', () => {
    let state: TurnGateState = EMPTY_TURN_GATE;
    let started = 0;
    for (let i = 0; i < TURNS_PER_DAY + 1; i += 1) {
      const result = turnGate(state, finding({ branch: `b${i}` }), T0 + i * 6 * MIN, LISTED);
      if (result.start) started += 1;
      state = result.state;
    }

    expect(started).toBe(TURNS_PER_DAY);
    expect(state.held).toEqual(['checks failing — b24: pull request #1']);

    const nextDay = Date.UTC(2026, 9, 11, 9, 0, 0);
    const reset = turnGate(state, finding({ branch: 'next' }), nextDay, LISTED);
    expect(reset.start).toBe(true);
    expect(reset.state.count).toBe(1);
    expect(reset.text).toContain('b24');
  });

  it('is a function of the persisted state, so a reload between calls changes nothing', () => {
    const first = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);
    const reloaded: TurnGateState = JSON.parse(JSON.stringify(first.state));

    expect(turnGate(reloaded, finding({ branch: 'b' }), T0 + MIN, LISTED).start).toBe(false);
  });

  it('keeps the held lines bounded', () => {
    let state: TurnGateState = { ...EMPTY_TURN_GATE, lastStartedAt: T0, day: '2026-10-10', count: TURNS_PER_DAY };
    for (let i = 0; i < 80; i += 1) {
      state = turnGate(state, finding({ branch: `b${i}` }), T0 + MIN, LISTED).state;
    }

    expect(state.held.length).toBeLessThanOrEqual(50);
    expect(state.held.at(-1)).toContain('b79');
  });
});

describe('raisesToast', () => {
  it('names exactly the three findings', () => {
    expect(['checks failing', 'pr merged', 'owes an answer'].every(raisesToast)).toBe(true);
    expect(raisesToast('idle')).toBe(false);
    expect(raisesToast('default branch red')).toBe(false);
  });
});

describe('absorbFinding', () => {
  it('replaces a slot rather than adding to it', () => {
    const one = absorbFinding([], finding());
    const two = absorbFinding(one, finding({ evidence: 'pull request #2' }));

    expect(two).toHaveLength(1);
    expect(two[0].evidence).toBe('pull request #2');
  });

  it('removes the slot on a clear', () => {
    const held = absorbFinding([finding(), finding({ branch: 'other' })], finding({ finding: 'clear' }));

    expect(held.map((f) => f.branch)).toEqual(['other']);
  });

  it('keys a slot as the channel does', () => {
    const a = finding();
    const b = finding({ monitor: 'AgentMonitor' });
    const held = absorbFinding(absorbFinding([], a), b);

    const key = (f: FollowedFinding) =>
      findingKey({ monitor: f.monitor as Finding['monitor'], branch: f.branch });

    expect(key(a)).not.toBe(key(b));
    expect(held).toHaveLength(2);
  });
});

describe('paneLines', () => {
  it('says it has heard nothing before a welcome, never an all-clear', () => {
    expect(paneLines([], false)).toEqual(['fleet channel: nothing heard yet']);
  });

  it('says there are no findings only after a welcome', () => {
    expect(paneLines([], true)).toEqual(['fleet channel: no current findings']);
  });

  it('lists findings oldest first', () => {
    const lines = paneLines(
      [finding({ branch: 'late', since: '2026-10-10T10:00:00Z' }), finding({ branch: 'early' })],
      true,
    );

    expect(lines[0]).toContain('early');
    expect(lines[1]).toContain('late');
  });
});
