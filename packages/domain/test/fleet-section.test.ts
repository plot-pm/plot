import { describe, expect, it } from 'vitest';
import { agentPills, fleetSwitchRow, type FleetAgentState } from '../src/rules/fleet-section.js';
import type { StatusPill } from '../src/rules/status-pill.js';

describe('agentPills', () => {
  // A Record over the state union: a new state fails `tsc` here until it has its expected pill.
  const expected: Record<FleetAgentState, StatusPill> = {
    running: { word: 'running', tone: 'green', href: null },
    waiting: { word: 'asks a question', tone: 'amber', href: null },
    stalled: { word: 'stalled', tone: 'red', href: null },
    finished: { word: 'finished', tone: 'blue', href: null },
    failed: { word: 'failed', tone: 'red', href: null },
    ended: { word: 'ended', tone: 'grey', href: null },
    none: { word: 'no worker', tone: 'grey', href: null },
    elsewhere: { word: 'on another machine', tone: 'quiet', href: null },
    unknown: { word: 'not read', tone: 'quiet', href: null },
  };

  for (const [state, want] of Object.entries(expected)) {
    it(`gives ${state} the pill "${want.word}" in ${want.tone}`, () => {
      expect(agentPills(state)).toEqual([want]);
    });
  }

  it('reads a word outside the states as not read, never as a state it does not name', () => {
    expect(agentPills('idle')).toEqual([expected.unknown]);
    expect(agentPills('toString')).toEqual([expected.unknown]);
  });
});

describe('fleetSwitchRow', () => {
  it('shows for a running fleet', () => {
    expect(fleetSwitchRow({ state: 'up' })).toEqual({ shows: true, fleet: 'running' });
  });

  it('shows for a stopped fleet, whether it was stopped or died', () => {
    expect(fleetSwitchRow({ state: 'down' })).toEqual({ shows: true, fleet: 'stopped' });
    expect(fleetSwitchRow({ state: 'died' })).toEqual({ shows: true, fleet: 'stopped' });
  });

  it('shows for an unread fleet and calls it unread, never stopped', () => {
    expect(fleetSwitchRow(null)).toEqual({ shows: true, fleet: 'unread' });
    expect(fleetSwitchRow({ state: 'unknown' })).toEqual({ shows: true, fleet: 'unread' });
  });
});
