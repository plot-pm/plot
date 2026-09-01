import { describe, it, expect } from 'vitest';
import {
  MEASURABLE,
  measurableConditions,
  absorb,
  admit,
  monitorLiveness,
  missedBeatsTolerance,
  onJoin,
  route,
} from '../src/rules/channel.js';
import { findingKey, type Finding } from '../src/entities/finding.js';
import { serves, isServed, type Subscription } from '../src/entities/subscription.js';
import { decode, encode, type ChannelMessage } from '../src/entities/channel-message.js';

/**
 * One reading, as a monitor publishes it.
 *
 * The base case is a healthy `owes a review` finding; every test names the ONE
 * field it changes, so what drives a decision is visible in the test rather
 * than buried here.
 */
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

const board: Subscription = {
  id: 'c1',
  subscriber: 'board',
  purpose: { kind: 'everything' },
};

const waiter = (over: Partial<Subscription> = {}): Subscription => ({
  id: 'c2',
  subscriber: 'agent',
  purpose: { kind: 'until', finding: 'owes a review', branch: 'feature/one' },
  ...over,
});

describe('a purpose is the subscription', () => {
  it('admits everything, the board’s degenerate case', () => {
    const admission = admit('c1', { subscriber: 'board', purpose: { kind: 'everything' } });
    expect(admission.ok).toBe(true);
    if (admission.ok) expect(admission.subscription.purpose.kind).toBe('everything');
  });

  it('admits a condition the monitors do measure', () => {
    const admission = admit('c2', {
      purpose: { kind: 'until', finding: 'owes a review', branch: 'feature/one' },
    });
    expect(admission.ok).toBe(true);
  });

  it('refuses CI-is-green immediately, naming why rather than leaving it pending', () => {
    const admission = admit('c3', { purpose: { kind: 'until', finding: 'CI is green' } });
    expect(admission.ok).toBe(false);
    if (!admission.ok) {
      expect(admission.asked).toBe('CI is green');
      expect(admission.reason).toMatch(/check run/);
      // A refusal that teaches: it says what it CAN be asked.
      expect(admission.measurable).toContain('owes a review');
    }
  });

  it('refuses any condition no monitor measures, and names it back', () => {
    const admission = admit('c4', { purpose: { kind: 'until', finding: 'the coffee is ready' } });
    expect(admission.ok).toBe(false);
    if (!admission.ok) {
      expect(admission.asked).toBe('the coffee is ready');
      expect(admission.measurable).toEqual(MEASURABLE);
    }
  });

  it('refuses a request carrying no purpose at all', () => {
    const admission = admit('c5', { subscriber: 'confused' });
    expect(admission.ok).toBe(false);
    if (!admission.ok) expect(admission.reason).toMatch(/must carry a purpose/);
  });

  it('never offers `clear` as something to wait for — a retraction is not a condition', () => {
    expect(MEASURABLE).not.toContain('clear');
    expect(admit('c6', { purpose: { kind: 'until', finding: 'clear' } }).ok).toBe(false);
  });
});

describe('a subscriber joining late receives current state, not a replay', () => {
  it('sends the board everything the channel holds now', () => {
    const current = [finding(), finding({ monitor: 'WorkerMonitor', finding: 'idle' })];
    const { send, finished } = onJoin(board, current);
    expect(send).toHaveLength(2);
    expect(finished).toBe(false);
  });

  it('replaces rather than appends, so the list is state and not history', () => {
    const first = finding({ evidence: '1 commit ahead, no PR' });
    const second = finding({ evidence: '4 commits ahead, no PR' });
    const held = absorb(absorb([], first), second);
    expect(held).toHaveLength(1);
    expect(held[0].evidence).toBe('4 commits ahead, no PR');
  });

  it('keeps one slot per monitor per branch, so two monitors on one branch both survive', () => {
    const held = absorb(absorb([], finding()), finding({ monitor: 'WorkerMonitor', finding: 'idle' }));
    expect(held).toHaveLength(2);
    expect(new Set(held.map(findingKey)).size).toBe(2);
  });

  it('serves a waiting agent at once when its condition already holds', () => {
    const { send, finished } = onJoin(waiter(), [finding()]);
    expect(send).toHaveLength(1);
    // It never has to wait for the condition to happen a second time.
    expect(finished).toBe(true);
  });

  it('gives a waiting agent only what serves it, not the whole board', () => {
    const current = [finding(), finding({ monitor: 'WorkerMonitor', finding: 'idle' })];
    const { send } = onJoin(waiter(), current);
    expect(send).toHaveLength(1);
    expect(send[0].finding).toBe('owes a review');
  });
});

describe('two subscribers each receive every finding, knowing nothing of each other', () => {
  it('routes one finding to both, and neither appears in the other’s answer', () => {
    const { send } = route([board, waiter()], finding());
    expect(send.map((s) => s.id)).toEqual(['c1', 'c2']);
  });

  it('finishes the narrow purpose and leaves the board’s untouched', () => {
    const { send, finished } = route([board, waiter()], finding());
    expect(send).toHaveLength(2);
    expect(finished.map((s) => s.id)).toEqual(['c2']);
  });

  it('serves the board a finding no waiter asked for', () => {
    const { send, finished } = route([board, waiter()], finding({ finding: 'owes a gate' }));
    expect(send.map((s) => s.id)).toEqual(['c1']);
    expect(finished).toHaveLength(0);
  });

  it('keeps two waiters on different branches independent', () => {
    const one = waiter({ id: 'a', purpose: { kind: 'until', finding: 'owes a review', branch: 'feature/one' } });
    const two = waiter({ id: 'b', purpose: { kind: 'until', finding: 'owes a review', branch: 'feature/two' } });
    const { finished } = route([one, two], finding({ branch: 'feature/two' }));
    expect(finished.map((s) => s.id)).toEqual(['b']);
  });

  it('serves an any-branch purpose from whichever branch fires', () => {
    const any = waiter({ purpose: { kind: 'until', finding: 'build failed', branch: '' } });
    const { finished } = route([any], finding({ monitor: 'BuildMonitor', finding: 'build failed', branch: 'feature/nine' }));
    expect(finished).toHaveLength(1);
  });
});

describe('the purposes differ in when they end', () => {
  it('never finishes an `everything` purpose, however much it is sent', () => {
    expect(isServed(board.purpose, finding())).toBe(false);
    expect(serves(board.purpose, finding())).toBe(true);
  });

  it('does not let a retraction serve a purpose waiting for the condition', () => {
    const clear = finding({ finding: 'clear', evidence: 'the owes a review finding no longer holds' });
    expect(serves(waiter().purpose, clear)).toBe(false);
    expect(isServed(waiter().purpose, clear)).toBe(false);
  });

  it('still sends a retraction to the board, which renders it', () => {
    expect(serves(board.purpose, finding({ finding: 'clear' }))).toBe(true);
  });
});

describe('silence-because-healthy is distinguishable from silence-because-gone', () => {
  const beat = 30_000;
  const tolerance = missedBeatsTolerance(beat);

  it('reads a monitor beating on cadence as alive, though it found nothing', () => {
    expect(monitorLiveness('2026-08-31T10:00:00Z', '2026-08-31T10:00:20Z', tolerance)).toBe('alive');
  });

  it('forgives one late beat rather than calling a busy machine a death', () => {
    expect(monitorLiveness('2026-08-31T10:00:00Z', '2026-08-31T10:01:00Z', tolerance)).toBe('alive');
  });

  it('reads a monitor that stopped beating as gone', () => {
    expect(monitorLiveness('2026-08-31T10:00:00Z', '2026-08-31T10:05:00Z', tolerance)).toBe('gone');
  });

  it('distinguishes a monitor never heard from at all', () => {
    expect(monitorLiveness('', '2026-08-31T10:00:00Z', tolerance)).toBe('never-seen');
  });

  it('treats an unreadable timestamp as never-seen rather than alive', () => {
    // A reading without a judgeable time cannot be judged fresh — so it is not.
    expect(monitorLiveness('not a date', '2026-08-31T10:00:00Z', tolerance)).toBe('never-seen');
  });
});

describe('the wire carries one message per line', () => {
  const roundTrip = (m: ChannelMessage) => decode(encode(m));

  it('round-trips a finding', () => {
    const message: ChannelMessage = { type: 'finding', finding: finding() };
    expect(roundTrip(message)).toEqual(message);
  });

  it('round-trips a heartbeat carrying who was last heard, and when', () => {
    const message: ChannelMessage = {
      type: 'heartbeat',
      measuredAt: '2026-08-31T10:00:00Z',
      monitors: [{ monitor: 'AgentMonitor', lastSeen: '2026-08-31T09:59:30Z' }],
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it('round-trips a refusal, so a subscriber can print why', () => {
    const message: ChannelMessage = {
      type: 'refused',
      reason: 'no monitor asks the host about a check run',
      asked: 'CI is green',
      measurable: ['owes a review'],
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it('emits exactly one newline-terminated line, so a reader can split on it', () => {
    const line = encode({ type: 'finding', finding: finding() });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trimEnd()).not.toContain('\n');
  });

  it('skips a blank or foreign line rather than dying on it', () => {
    expect(decode('')).toBeUndefined();
    expect(decode('   ')).toBeUndefined();
    expect(decode('not json at all')).toBeUndefined();
    expect(decode('{"type":"something-else"}')).toBeUndefined();
  });
});

describe('what a refusal can teach', () => {
  it('lists every condition a purpose may name', () => {
    // The refusal names what it CANNOT serve and what it can; this is the
    // second half, and a caller building a message reaches for it rather than
    // re-deriving the set.
    expect(measurableConditions()).toEqual([...MEASURABLE]);
  });

  it('echoes nothing when the REQUEST is not an object at all', () => {
    // A peer that writes a bare string has said nothing to quote back. The
    // guard is separate from the one below because the two failures differ:
    // this one never named a purpose, that one named an unusable purpose.
    const refused = admit('c8', 'nonsense');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.asked).toBe('');
  });

  it('echoes nothing when the purpose is not an object at all', () => {
    // `describeAsked` exists so a refusal quotes the phrase back. A purpose
    // that is a bare string has no phrase to quote, and inventing one would
    // teach the asker something it did not say.
    const refused = admit('c9', { subscriber: 'agent', purpose: 'until-ci-is-green' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.asked).toBe('');
  });
});
