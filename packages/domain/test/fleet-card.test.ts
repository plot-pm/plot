import { describe, it, expect } from 'vitest';
import { fleetCard } from '../src/rules/fleet-card.js';

const of = (...groups: Array<'free' | 'working' | 'blocked'>) => groups.map((group) => ({ group }));

describe('fleetCard', () => {
  it('reads blocked over working when both are present', () => {
    expect(fleetCard(of('working', 'blocked', 'free'))).toEqual({ state: 'blocked', free: 1, working: 1, blocked: 1 });
  });
  it('reads working when none is blocked', () => {
    expect(fleetCard(of('working', 'working', 'free'))).toEqual({ state: 'working', free: 1, working: 2, blocked: 0 });
  });
  it('reads idle with the free count when every agent is free', () => {
    expect(fleetCard(of('free', 'free', 'free'))).toEqual({ state: 'idle', free: 3, working: 0, blocked: 0 });
  });
  it('reads idle with three zeros for an empty fleet', () => {
    expect(fleetCard([])).toEqual({ state: 'idle', free: 0, working: 0, blocked: 0 });
  });
  it('reads blocked alone', () => {
    expect(fleetCard(of('blocked')).state).toBe('blocked');
  });
});
