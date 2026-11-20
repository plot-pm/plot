import { describe, expect, it } from 'vitest';
import { isAgentDesk, notWorkingReason, registryFact, workingCounts, type NotWorkingReason } from '../src/index.js';

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
  const counts = (manifestCount: number, synthesizedCount: number, checkoutCount = 0, unreadCount = 0) =>
    ({ manifestCount, synthesizedCount, checkoutCount, unreadCount });

  it('says nothing where every agent has a registry file', () => {
    expect(registryFact(counts(3, 0))).toBeNull();
  });

  it('counts the agents with no registry file against all of them', () => {
    expect(registryFact(counts(3, 14))).toEqual({ text: '14 of 17 agents have no registry file', warn: false });
    expect(registryFact(counts(1, 1))).toEqual({ text: '1 of 2 agents has no registry file', warn: false });
  });

  it('warns where fleet agents run and none has a registry file', () => {
    expect(registryFact(counts(0, 5))).toEqual({ text: '0 of 5 agents have a registry file', warn: true });
  });

  it('leaves a checkout where no worker ran out of both counts', () => {
    expect(registryFact(counts(3, 5, 4))).toEqual({ text: '1 of 4 agents has no registry file', warn: false });
    expect(registryFact(counts(0, 5, 2))).toEqual({ text: '0 of 3 agents have a registry file', warn: true });
  });

  it('says nothing where every desk with no manifest is a checkout', () => {
    expect(registryFact(counts(3, 20, 20))).toBeNull();
  });

  it('says nothing where the fleet runs no agent', () => {
    expect(registryFact(counts(0, 23, 23))).toBeNull();
    expect(registryFact(counts(0, 0))).toBeNull();
  });

  it('says nothing about a registry file where every desk with no manifest has a state nobody read', () => {
    expect(registryFact(counts(3, 13, 0, 13))).toBeNull();
    expect(registryFact(counts(0, 13, 0, 13))).toBeNull();
  });

  it('leaves a desk with an unread state out of both counts', () => {
    expect(registryFact(counts(3, 16, 0, 13))).toEqual({ text: '3 of 6 agents have no registry file', warn: false });
    expect(registryFact(counts(0, 5, 1, 2))).toEqual({ text: '0 of 2 agents have a registry file', warn: true });
  });

  it('reads a registry from before the unread count as one with no unread desk', () => {
    expect(registryFact({ manifestCount: 3, synthesizedCount: 2, checkoutCount: 0 })).toEqual({ text: '2 of 5 agents have no registry file', warn: false });
  });
});

describe('workingCounts', () => {
  const entry = (why: NotWorkingReason, key: string = why) => ({ key, why });
  const registry = (manifestCount: number, synthesizedCount: number, checkoutCount: number, unreadCount: number) =>
    ({ manifestCount, synthesizedCount, checkoutCount, unreadCount });

  it('counts every stopped agent and prints no fact where each agent has a registry file', () => {
    const stopped = [entry('finished'), entry('exited')];
    expect(workingCounts(stopped, registry(3, 0, 0, 0))).toEqual({ stopped, registry: null, unread: null });
  });

  it('names the agents with no registry file where their state was read', () => {
    const got = workingCounts([entry('exited')], registry(3, 2, 0, 0));
    expect(got.registry).toEqual({ text: '2 of 5 agents have no registry file', warn: false });
    expect(got.unread).toBeNull();
  });

  it('says the state was not read, and names no registry file and no stopped agent, where only unread desks exist', () => {
    const unread = Array.from({ length: 13 }, (_, i) => entry('unread', `u${i}`));
    const got = workingCounts(unread, registry(3, 13, 0, 13));
    expect(got).toEqual({
      stopped: [],
      registry: null,
      unread: { text: 'the board could not read the state of 13 worktrees', warn: true },
    });
  });

  it('keeps the unread desks out of the stopped count and the registry count where both kinds exist', () => {
    const got = workingCounts([entry('stalled'), entry('unread', 'u1'), entry('gone')], registry(3, 4, 0, 1));
    expect(got.stopped.map((e) => e.why)).toEqual(['stalled', 'gone']);
    expect(got.registry).toEqual({ text: '3 of 6 agents have no registry file', warn: false });
    expect(got.unread).toEqual({ text: 'the board could not read the state of 1 worktree', warn: true });
  });

  it('prints nothing where there is no worktree', () => {
    expect(workingCounts([], registry(0, 0, 0, 0))).toEqual({ stopped: [], registry: null, unread: null });
    expect(workingCounts([], undefined)).toEqual({ stopped: [], registry: null, unread: null });
  });
});
