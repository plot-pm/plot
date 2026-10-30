import { describe, expect, it } from 'vitest';

import type { AgentStateReadings } from '../src/rules/agent-state.js';
import { deskDead } from '../src/rules/desk-dead.js';

const desk = (over: Partial<AgentStateReadings> = {}) =>
  ({
    read: 'desk',
    worktreeHere: true,
    pidRecorded: true,
    liveness: 'dead',
    exit: '1',
    task: { hasPr: false, blocked: false, dirty: false, unpushed: false },
    ...over,
  }) as const;

describe('deskDead', () => {
  it('reads a PLOT-BLOCKED marker as waiting, not dead', () => {
    const task = { hasPr: false, blocked: true, dirty: false, unpushed: false };
    expect(deskDead(desk({ task }))).toEqual({ dead: false, why: 'waiting' });
  });

  it('reads a worktree on another machine as elsewhere, not dead', () => {
    expect(deskDead(desk({ worktreeHere: false }))).toEqual({ dead: false, why: 'elsewhere' });
  });

  it('reads a failed read as unread, which holds', () => {
    expect(deskDead({ read: 'unread' })).toEqual({ dead: false, why: 'unread' });
  });

  it('reads a live pid as live', () => {
    expect(deskDead(desk({ liveness: 'live' }))).toEqual({ dead: false, why: 'live' });
  });

  it.each(['dead', 'stale', 'orphaned'] as const)('reads a %s pid as dead', (liveness) => {
    expect(deskDead(desk({ liveness }))).toEqual({ dead: true });
  });

  it('reads no recorded pid as dead', () => {
    expect(deskDead(desk({ pidRecorded: false, liveness: 'dead', exit: null }))).toEqual({ dead: true });
  });
});
