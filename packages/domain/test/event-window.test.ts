import { describe, expect, it } from 'vitest';
import { ruleEventWindow, type EventWindow } from '../src/rules/event-window.js';

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
