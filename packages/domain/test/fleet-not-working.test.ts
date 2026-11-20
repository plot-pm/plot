import { describe, expect, it } from 'vitest';
import { isAgentDesk, notWorkingReason, registryFact } from '../src/index.js';

describe('notWorkingReason', () => {
  it('names a finished agent whose branch merged as merged', () => {
    expect(notWorkingReason('finished', true)).toBe('merged');
    expect(notWorkingReason('ended', true)).toBe('merged');
  });

  it('names each stopped state in words', () => {
    expect(notWorkingReason('finished', false)).toBe('finished');
    expect(notWorkingReason('stalled', false)).toBe('stalled');
    expect(notWorkingReason('failed', false)).toBe('exited');
    expect(notWorkingReason('ended', false)).toBe('exited');
    expect(notWorkingReason('none', false)).toBe('exited');
    expect(notWorkingReason('elsewhere', false)).toBe('gone');
    expect(notWorkingReason('unknown', false)).toBe('unread');
  });

  it('keeps stalled work stalled even where the branch merged', () => {
    expect(notWorkingReason('stalled', true)).toBe('stalled');
  });

  it('answers null for a live state', () => {
    expect(notWorkingReason('running', false)).toBeNull();
    expect(notWorkingReason('waiting', true)).toBeNull();
  });
});

describe('isAgentDesk', () => {
  it('counts a desk where a worker ran, whatever its state now', () => {
    for (const state of ['running', 'finished', 'failed', 'ended', 'waiting', 'stalled', 'elsewhere']) {
      expect(isAgentDesk(state)).toBe(true);
    }
  });

  it('counts a desk whose state nobody could read, because the registry cannot rule an agent out', () => {
    expect(isAgentDesk('unknown')).toBe(true);
  });

  it('does not count a desk where no worker ever ran', () => {
    expect(isAgentDesk('none')).toBe(false);
  });
});

describe('registryFact', () => {
  it('says nothing where every agent has a registry file', () => {
    expect(registryFact({ manifestCount: 3, synthesizedCount: 0, checkoutCount: 0 })).toBeNull();
  });

  it('counts the agents with no registry file against all of them', () => {
    expect(registryFact({ manifestCount: 3, synthesizedCount: 14, checkoutCount: 0 })).toEqual({ text: '14 of 17 agents have no registry file', warn: false });
    expect(registryFact({ manifestCount: 1, synthesizedCount: 1, checkoutCount: 0 })).toEqual({ text: '1 of 2 agents has no registry file', warn: false });
  });

  it('warns where fleet agents run and none has a registry file', () => {
    expect(registryFact({ manifestCount: 0, synthesizedCount: 5, checkoutCount: 0 })).toEqual({ text: '0 of 5 agents have a registry file', warn: true });
  });

  it('leaves a checkout where no worker ran out of both counts', () => {
    expect(registryFact({ manifestCount: 3, synthesizedCount: 5, checkoutCount: 4 })).toEqual({ text: '1 of 4 agents has no registry file', warn: false });
    expect(registryFact({ manifestCount: 0, synthesizedCount: 5, checkoutCount: 2 })).toEqual({ text: '0 of 3 agents have a registry file', warn: true });
  });

  it('says nothing where every desk with no manifest is a checkout', () => {
    expect(registryFact({ manifestCount: 3, synthesizedCount: 20, checkoutCount: 20 })).toBeNull();
  });

  it('says nothing where the fleet runs no agent', () => {
    expect(registryFact({ manifestCount: 0, synthesizedCount: 23, checkoutCount: 23 })).toBeNull();
    expect(registryFact({ manifestCount: 0, synthesizedCount: 0, checkoutCount: 0 })).toBeNull();
  });
});
