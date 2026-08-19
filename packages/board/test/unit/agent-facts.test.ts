// What the panel SAYS — the formatting half, asserted without a page.
//
// The suite runs with `environment: 'node'` and the recent waves' practice is to
// put the decision in exported pure functions and assert those. The decision
// here is *whether a field appears at all*, which `Fact` answers by returning
// null — so the omission rule is testable as a value rather than scraped out of
// markup.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { Fact, agoLabel, tokenLabel, uptimeLabel } from '../../src/app/components/AgentPanelFacts.js';

describe('uptime reads as the shortest true phrase', () => {
  const cases: [number, string][] = [
    [0, '0s'],
    [42, '42s'],
    [59, '59s'],
    [60, '1m'],
    [90, '1m'],
    [3599, '59m'],
    [3600, '1h'],
    [3660, '1h 1m'],
    [86_400, '1d'],
    [90_000, '1d 1h'],
  ];
  for (const [seconds, label] of cases) {
    it(`${seconds}s reads as ${label}`, () => {
      assert.equal(uptimeLabel(seconds), label);
    });
  }
});

describe('context reads in thousands', () => {
  it('keeps small counts exact', () => {
    assert.equal(tokenLabel(999), '999');
  });
  it('rounds larger ones to k', () => {
    assert.equal(tokenLabel(103_619), '104k');
  });
});

describe('last activity is relative and never invented', () => {
  const now = Date.parse('2026-08-19T09:00:00.000Z');

  it('reads a recent turn as "just now"', () => {
    assert.equal(agoLabel('2026-08-19T08:59:30.000Z', now), 'just now');
  });

  it('reads an older turn as an age', () => {
    assert.equal(agoLabel('2026-08-19T08:00:00.000Z', now), '1h ago');
  });

  it('clamps a timestamp from the future rather than reading negative', () => {
    // Clock skew between the runtime writing the transcript and the board
    // reading it is ordinary; "-3s ago" is not a thing to render.
    assert.equal(agoLabel('2026-08-19T09:00:30.000Z', now), 'just now');
  });

  it('omits an unparseable timestamp rather than rendering Invalid Date', () => {
    // One more unrecognised field, treated exactly like the others.
    assert.equal(agoLabel('not-a-date', now), null);
  });
});

// THE OMISSION RULE, structurally. There is no code path in `Fact` that prints
// a placeholder: a value it was not given produces no element, so a field the
// panel could not read cannot appear as "—", "unknown", or a stale last value.
describe('a fact with nothing to say renders nothing', () => {
  for (const [name, value] of [
    ['undefined — the shape a missing transcript field takes', undefined],
    ['null — the shape an exited worker\'s uptime takes', null],
    ['an empty string — the shape an unrecorded pid takes', ''],
  ] as const) {
    it(`renders no element for ${name}`, () => {
      assert.equal(Fact({ label: 'model', value }), null);
    });
  }

  it('renders an element once there is something true to show', () => {
    const el = Fact({ label: 'model', value: 'claude-opus-5' });
    assert.notEqual(el, null, 'a readable fact must appear');
  });

  it('renders a zero, which is a value rather than an absence', () => {
    // The trap a falsy check would spring: `0s` of uptime is a real reading of
    // a process that just started, and must not be omitted the way null is.
    assert.notEqual(Fact({ label: 'uptime', value: uptimeLabel(0) }), null);
  });
});
