import { describe, expect, it } from 'vitest';

import type { Readings } from '../src/entities/snapshot.js';
import {
  missedChangeLine,
  missedChanges,
  SAFETY_NET_MS,
  safetyNetDue,
} from '../src/rules/missed-changes.js';

const read = <T>(value: T, readAt = 1) => ({ state: 'read' as const, readAt, value });

const desk = (path: string, clean: boolean) => ({
  path,
  branch: `feature/${path.split('/').pop() ?? ''}`,
  detached: false,
  isMain: false,
  clean,
  agentSession: null,
  prunable: false,
});

const files = (question: string) => ({ question, markers: [], pid: '', exit: null });

describe('missedChanges names each reading that changed with no trigger', () => {
  it('names a whole-repository key whose content changed while nothing named it', () => {
    const held: Partial<Readings> = { config: read({ 'Plan directory': 'docs/plans/' }) };
    const fresh: Partial<Readings> = { config: read({ 'Plan directory': 'plans/' }, 2) };
    expect(missedChanges(held, fresh, [])).toEqual([{ key: 'config' }]);
  });

  it('names nothing where a trigger named the key', () => {
    const held: Partial<Readings> = { config: read({ a: '1' }) };
    const fresh: Partial<Readings> = { config: read({ a: '2' }) };
    expect(missedChanges(held, fresh, [{ key: 'config' }])).toEqual([]);
  });

  it('compares content and not readAt', () => {
    const held: Partial<Readings> = { config: read({ a: '1' }, 1) };
    const fresh: Partial<Readings> = { config: read({ a: '1' }, 99) };
    expect(missedChanges(held, fresh, [])).toEqual([]);
  });

  it('names the desk of a per-desk key, and not the desks that held still', () => {
    const held: Partial<Readings> = { desks: read([desk('/r/a', true), desk('/r/b', true)]) };
    const fresh: Partial<Readings> = { desks: read([desk('/r/a', true), desk('/r/b', false)]) };
    expect(missedChanges(held, fresh, [])).toEqual([{ key: 'desks', desk: '/r/b' }]);
  });

  it('names nothing for a desk a trigger named, and still names another desk', () => {
    const held: Partial<Readings> = { deskFiles: read({ '/r/a': files(''), '/r/b': files('') }) };
    const fresh: Partial<Readings> = { deskFiles: read({ '/r/a': files('why?'), '/r/b': files('how?') }) };
    expect(missedChanges(held, fresh, [{ key: 'deskFiles', desk: '/r/a' }])).toEqual([{ key: 'deskFiles', desk: '/r/b' }]);
  });

  it('names nothing per desk where a trigger named the whole key', () => {
    const held: Partial<Readings> = { workers: read({}) };
    const fresh: Partial<Readings> = {
      workers: read({ '/r/a': { state: 'running', pid: '7', exitCode: '', activity: 'working' } }),
    };
    expect(missedChanges(held, fresh, [{ key: 'workers' }])).toEqual([]);
  });

  it('names a desk that appeared or went away', () => {
    const held: Partial<Readings> = { desks: read([desk('/r/a', true)]) };
    const fresh: Partial<Readings> = { desks: read([desk('/r/b', true)]) };
    expect(missedChanges(held, fresh, [])).toEqual([
      { key: 'desks', desk: '/r/a' },
      { key: 'desks', desk: '/r/b' },
    ]);
  });

  it('compares only two read readings: a first read, a failed read and a key the full read did not take name nothing', () => {
    const held: Partial<Readings> = {
      config: { state: 'unread' },
      refs: { state: 'failed', readAt: 1, reason: 'no git' },
      registry: read([]),
    };
    const fresh: Partial<Readings> = {
      config: read({ a: '1' }),
      refs: read({ entries: [], digest: 'd' }),
      plans: { state: 'failed', readAt: 2, reason: 'gone' },
    };
    expect(missedChanges(held, fresh, [])).toEqual([]);
  });

  it('never names the walk, which every trigger names and which carries its own clock', () => {
    const header = { main: 'main', readRef: 'a', localHead: 'a', fetchFailed: false, fetchError: '', planDir: 'docs/plans/', mergeDetect: '' };
    const walk = (nowSeconds: number) =>
      read({
        header: { ...header, nowSeconds },
        estate: { mainSha: 'a', source: 'ref', blobs: [], indexes: [], dangling: [] },
        branches: { mainSha: 'a', backend: 'github', origin: '', hostReach: 'reached', merges: [], added: {}, branches: [] },
        desks: { mainSha: 'a', desks: [] },
        conflicts: {},
      }) as unknown as Readings['walk'];
    expect(missedChanges({ walk: walk(1) }, { walk: walk(2) }, [])).toEqual([]);
  });

  it('lists the keys in reading-key order', () => {
    const held: Partial<Readings> = { questions: read({}), config: read({ a: '1' }) };
    const fresh: Partial<Readings> = {
      questions: read({ 'feature/x': { question: 'q' } }) as unknown as Readings['questions'],
      config: read({ a: '2' }),
    };
    expect(missedChanges(held, fresh, []).map((change) => change.key)).toEqual(['config', 'questions']);
  });
});

describe('missedChangeLine', () => {
  it('names the key alone for a whole-repository key', () => {
    expect(missedChangeLine({ key: 'config' })).toBe('plot-fleetd: safety net: config changed with no trigger\n');
  });
  it('names the key and the desk for a per-desk key', () => {
    expect(missedChangeLine({ key: 'desks', desk: '/r/b' })).toBe('plot-fleetd: safety net: desks /r/b changed with no trigger\n');
  });
});

describe('safetyNetDue', () => {
  it('is due before the first full read', () => {
    expect(safetyNetDue(null, 0)).toBe(true);
  });
  it('is due 10 minutes after the last one, and not a moment before', () => {
    expect(SAFETY_NET_MS).toBe(600_000);
    expect(safetyNetDue(1000, 1000 + SAFETY_NET_MS - 1)).toBe(false);
    expect(safetyNetDue(1000, 1000 + SAFETY_NET_MS)).toBe(true);
  });
  it('is due after a wake', () => {
    expect(safetyNetDue(1000, 1001, true)).toBe(true);
  });
  it('is due when the wall clock was set back before the last one', () => {
    expect(safetyNetDue(10_000, 5_000)).toBe(true);
  });
});
