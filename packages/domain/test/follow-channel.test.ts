import { describe, expect, it } from 'vitest';

import {
  EMPTY_TURN_GATE,
  TURNS_PER_DAY,
  TURN_GAP_MS,
  absorbFinding,
  isRepeat,
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

  it('starts nothing for a finding that is not listed, whatever its name, and records it as announced', () => {
    const actual = turnGate(EMPTY_TURN_GATE, finding({ finding: 'pr merged' }), T0, LISTED);

    expect(actual).toMatchObject({ start: false, isNew: true, text: '' });
    expect(actual.state).toMatchObject({ lastStartedAt: null, count: 0, held: [] });
    expect(isRepeat(actual.state.announced, finding({ finding: 'pr merged' }))).toBe(true);
  });

  it('starts nothing by default: an empty list lists nothing', () => {
    expect(turnGate(EMPTY_TURN_GATE, finding(), T0, []).start).toBe(false);
  });

  it('holds a second finding at minute 4 and carries it into the turn at minute 6', () => {
    const first = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);
    const second = turnGate(first.state, finding({ branch: 'feature/two' }), T0 + 4 * MIN, LISTED);
    const third = turnGate(second.state, finding({ branch: 'feature/three' }), T0 + 6 * MIN, LISTED);

    expect(second.start).toBe(false);
    expect(second.state.held.map((h) => h.line)).toEqual(['checks failing — feature/two: pull request #1']);
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

  it('adds a repeated line once, when a new reading of the slot reads the same', () => {
    const first = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);
    const a = turnGate(first.state, finding({ branch: 'b' }), T0 + MIN, LISTED);
    const b = turnGate(a.state, finding({ branch: 'b', since: '2026-10-10T09:01:00Z' }), T0 + 2 * MIN, LISTED);

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
    expect(state.held.map((h) => h.line)).toEqual(['checks failing — b24: pull request #1']);

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

  it('drops the held line of a slot when a clear arrives for it, and keeps the others', () => {
    const gated: TurnGateState = { ...EMPTY_TURN_GATE, lastStartedAt: T0, day: '2026-10-10', count: 1 };
    const one = turnGate(gated, finding({ branch: 'one' }), T0 + MIN, LISTED);
    const two = turnGate(one.state, finding({ branch: 'two' }), T0 + MIN, LISTED);
    expect(two.state.held).toHaveLength(2);

    const cleared = turnGate(two.state, finding({ branch: 'one', finding: 'clear' }), T0 + 2 * MIN, LISTED);

    expect(cleared.start).toBe(false);
    expect(cleared.state.held.map((h) => h.line)).toEqual(['checks failing — two: pull request #1']);
  });

  it('starts no second turn for a reading it announced, even after the pane was emptied by a welcome', () => {
    // fleetd restarts: the welcome carries `current: []`, the same reading arrives again.
    const first = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);
    const again = turnGate(first.state, finding(), T0 + 6 * MIN, LISTED);

    expect(first.start).toBe(true);
    expect(again).toEqual({ start: false, isNew: false, text: '', state: first.state });
  });

  it('starts a turn for a changed reading of an announced slot', () => {
    const first = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);
    const changed = turnGate(first.state, finding({ evidence: 'pull request #2' }), T0 + 6 * MIN, LISTED);

    expect(changed).toMatchObject({ start: true, isNew: true });
  });

  it('starts no turn and holds no line for a reading another session claimed', () => {
    const actual = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED, false);

    expect(actual).toMatchObject({ start: false, isNew: true, text: '' });
    expect(actual.state.held).toEqual([]);
    expect(actual.state.count).toBe(0);
    expect(isRepeat(actual.state.announced, finding())).toBe(true);
  });

  it('forgets the announced reading of a slot on a clear, so the reading counts as new again', () => {
    const first = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED);
    const other = turnGate(first.state, finding({ branch: 'other', finding: 'pr merged' }), T0, LISTED);
    const cleared = turnGate(other.state, finding({ finding: 'clear' }), T0 + MIN, LISTED);

    expect(cleared.isNew).toBe(false);
    expect(isRepeat(cleared.state.announced, finding())).toBe(false);
    expect(isRepeat(cleared.state.announced, finding({ branch: 'other', finding: 'pr merged' }))).toBe(true);
    expect(turnGate(cleared.state, finding(), T0 + 6 * MIN, LISTED).start).toBe(true);
  });

  it('keeps the announced readings bounded, dropping the oldest slot', () => {
    let state: TurnGateState = EMPTY_TURN_GATE;
    for (let i = 0; i < 520; i += 1) {
      state = turnGate(state, finding({ branch: `b${i}`, finding: 'idle' }), T0, LISTED).state;
    }

    expect(Object.keys(state.announced)).toHaveLength(500);
    expect(isRepeat(state.announced, finding({ branch: 'b0', finding: 'idle' }))).toBe(false);
    expect(isRepeat(state.announced, finding({ branch: 'b519', finding: 'idle' }))).toBe(true);
  });

  it('keeps the held lines bounded', () => {
    let state: TurnGateState = { ...EMPTY_TURN_GATE, lastStartedAt: T0, day: '2026-10-10', count: TURNS_PER_DAY };
    for (let i = 0; i < 80; i += 1) {
      state = turnGate(state, finding({ branch: `b${i}` }), T0 + MIN, LISTED).state;
    }

    expect(state.held.length).toBeLessThanOrEqual(50);
    expect(state.held.at(-1)?.line).toContain('b79');
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

describe('isRepeat', () => {
  const announced = turnGate(EMPTY_TURN_GATE, finding(), T0, LISTED).state.announced;

  it('is true for the same slot with the same name, since and evidence', () => {
    expect(isRepeat(announced, finding())).toBe(true);
  });

  it('is false for a changed name, evidence or since, another slot, or nothing announced', () => {
    expect(isRepeat(announced, finding({ finding: 'default branch red' }))).toBe(false);
    expect(isRepeat(announced, finding({ evidence: 'pull request #2' }))).toBe(false);
    expect(isRepeat(announced, finding({ since: '2026-10-10T10:00:00Z' }))).toBe(false);
    expect(isRepeat(announced, finding({ branch: 'other' }))).toBe(false);
    expect(isRepeat(announced, finding({ monitor: 'AgentMonitor' }))).toBe(false);
    expect(isRepeat({}, finding())).toBe(false);
  });
});

describe('paneLines', () => {
  it('marks findings heard before a reload as out of date rather than as nothing heard', () => {
    const lines = paneLines([finding()], false, true);

    expect(lines[0]).toBe('fleet channel: reconnecting, findings may be out of date');
    expect(lines[1]).toContain('feature/one');
  });

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
