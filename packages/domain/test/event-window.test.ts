import { describe, expect, it } from 'vitest';
import { ruleEventWindow, ruleWelcome, type EventWindow } from '../src/rules/event-window.js';

const feed = (times: number[], windowMs: number): boolean[] => {
  let window: EventWindow = {};
  return times.map((at) => {
    const ruling = ruleEventWindow(window, at, windowMs);
    window = ruling.window;
    return ruling.admit;
  });
};

describe('ruleEventWindow', () => {
  it('admits the first arrival', () => {
    expect(feed([5], 1000)).toEqual([true]);
  });

  it('admits one of ten arrivals inside one window', () => {
    const times = Array.from({ length: 10 }, (_, i) => 100 + i * 50);
    expect(feed(times, 1000).filter(Boolean)).toHaveLength(1);
  });

  it('admits again once the window has passed', () => {
    expect(feed([0, 100, 999, 1000, 1500], 1000)).toEqual([true, false, false, true, false]);
  });

  it('admits three arrivals spaced beyond the window', () => {
    expect(feed([0, 1500, 3000], 1000)).toEqual([true, true, true]);
  });

  it('measures from the last admitted arrival, not the last dropped one', () => {
    expect(feed([0, 600, 1100], 1000)).toEqual([true, false, true]);
  });

  it('admits when the clock moved backwards', () => {
    expect(feed([5000, 100], 1000)).toEqual([true, true]);
  });
});

describe('ruleEventWindow trailing send', () => {
  it('reports the end of the open window on a dropped arrival', () => {
    const first = ruleEventWindow({}, 100, 1000);
    expect(first.trailingAt).toBeUndefined();
    const dropped = ruleEventWindow(first.window, 600, 1000);
    expect(dropped.admit).toBe(false);
    expect(dropped.trailingAt).toBe(1100);
  });

  it('reports the same end for every drop in one window', () => {
    const { window } = ruleEventWindow({}, 0, 1000);
    expect([100, 500, 999].map((at) => ruleEventWindow(window, at, 1000).trailingAt)).toEqual([1000, 1000, 1000]);
  });

  it('admits at the reported end', () => {
    const { window } = ruleEventWindow({}, 0, 1000);
    expect(ruleEventWindow(window, 1000, 1000).admit).toBe(true);
  });
});

describe('ruleWelcome', () => {
  it('does not refetch on the first welcome', () => {
    expect(ruleWelcome({ heard: false }).refetch).toBe(false);
  });

  it('refetches on a later welcome', () => {
    const first = ruleWelcome({ heard: false });
    expect(ruleWelcome(first.window).refetch).toBe(true);
  });
});
