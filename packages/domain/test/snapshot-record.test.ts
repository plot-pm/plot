import { describe, expect, it } from 'vitest';

import { emptySnapshot, type RepoSnapshot } from '../src/entities/snapshot.js';
import { recordReading } from '../src/rules/snapshot-record.js';
import { fullSnapshot } from './fixtures/snapshot.js';

const sha = (c: string): string => c.repeat(40);

const refsAt = (main: string) =>
  ({
    state: 'read',
    readAt: 100,
    value: {
      entries: [
        { ref: 'refs/heads/main', sha: main, head: true },
        { ref: 'refs/remotes/origin/main', sha: sha('a') },
      ],
      digest: `refs/heads/main=${main}\nrefs/remotes/origin/main=${sha('a')}`,
    },
  }) as const;

const withRefs = (main: string): RepoSnapshot => recordReading(emptySnapshot(), 'refs', refsAt(main)).snapshot;

describe('recordReading', () => {
  it('records a first reading as a change', () => {
    const { snapshot, changed } = recordReading(emptySnapshot(), 'refs', refsAt(sha('a')));
    expect(changed).toEqual(['refs']);
    expect(snapshot.generation).toBe(1);
    expect(snapshot.readings.refs).toEqual(refsAt(sha('a')));
  });

  it('changes nothing for a reading equal to the held one', () => {
    const held = withRefs(sha('a'));
    const { snapshot, changed } = recordReading(held, 'refs', { ...refsAt(sha('a')), readAt: 200 });
    expect(changed).toEqual([]);
    expect(snapshot.generation).toBe(held.generation);
    expect(snapshot).toBe(held);
  });

  it('moves the generation once for one moved ref', () => {
    const held = withRefs(sha('a'));
    const { snapshot, changed } = recordReading(held, 'refs', refsAt(sha('b')));
    expect(changed).toEqual(['refs']);
    expect(snapshot.generation).toBe(held.generation + 1);
    expect(snapshot.readings.refs).toEqual(refsAt(sha('b')));
  });

  it('leaves every other reading as it was', () => {
    const held = fullSnapshot();
    const { snapshot } = recordReading(held, 'issues', { state: 'read', readAt: 2, value: [] });
    for (const key of ['refs', 'desks', 'prs', 'config'] as const) expect(snapshot.readings[key]).toBe(held.readings[key]);
  });

  it('does not change the snapshot it was given', () => {
    const held = withRefs(sha('a'));
    recordReading(held, 'refs', refsAt(sha('b')));
    expect(held.readings.refs).toEqual(refsAt(sha('a')));
    expect(held.generation).toBe(1);
  });

  it('records a read reading that fails as a change', () => {
    const held = fullSnapshot();
    const { snapshot, changed } = recordReading(held, 'prs', { state: 'failed', readAt: 2, reason: 'rate limited' });
    expect(changed).toEqual(['prs']);
    expect(snapshot.generation).toBe(held.generation + 1);
  });

  it('records a failure with a new reason as a change', () => {
    const held = fullSnapshot();
    const { changed } = recordReading(held, 'defaultBranch', { state: 'failed', readAt: 2, reason: 'timed out' });
    expect(changed).toEqual(['defaultBranch']);
  });

  it('changes nothing for a failure with the same reason', () => {
    const held = fullSnapshot();
    const { changed } = recordReading(held, 'defaultBranch', { state: 'failed', readAt: 9, reason: 'host refused' });
    expect(changed).toEqual([]);
  });

  it('changes nothing for an unread reading over an unread one', () => {
    const held = emptySnapshot();
    const { snapshot, changed } = recordReading(held, 'plans', { state: 'unread' });
    expect(changed).toEqual([]);
    expect(snapshot).toBe(held);
  });

  it('compares a record by content, not by key order', () => {
    const held = recordReading(emptySnapshot(), 'config', { state: 'read', readAt: 1, value: { a: '1', b: '2' } }).snapshot;
    const { changed } = recordReading(held, 'config', { state: 'read', readAt: 2, value: { b: '2', a: '1' } });
    expect(changed).toEqual([]);
  });

  it.each([
    ['a changed value', { a: '1', b: '3' }],
    ['a key fewer', { a: '1' }],
    ['a key renamed', { a: '1', c: '2' }],
  ])('records %s in a record as a change', (_name, value) => {
    const held = recordReading(emptySnapshot(), 'config', { state: 'read', readAt: 1, value: { a: '1', b: '2' } }).snapshot;
    expect(recordReading(held, 'config', { state: 'read', readAt: 2, value }).changed).toEqual(['config']);
  });

  it('records a desk whose session moved from none to one as a change', () => {
    const desk = {
      path: '/repo',
      branch: 'main',
      detached: false,
      isMain: true,
      clean: true,
      agentSession: null,
      prunable: false,
    };
    const held = recordReading(emptySnapshot(), 'desks', { state: 'read', readAt: 1, value: [desk] }).snapshot;
    const moved = { ...desk, agentSession: 's-1' };
    expect(recordReading(held, 'desks', { state: 'read', readAt: 2, value: [moved] }).changed).toEqual(['desks']);
  });

  it('records a worker whose activity moved as a change', () => {
    const held = recordReading(emptySnapshot(), 'workers', {
      state: 'read',
      readAt: 1,
      value: { '/d': { state: 'running', pid: '1', exitCode: '', activity: 'working' } },
    }).snapshot;
    const { changed } = recordReading(held, 'workers', {
      state: 'read',
      readAt: 2,
      value: { '/d': { state: 'running', pid: '1', exitCode: '', activity: 'idle' } },
    });
    expect(changed).toEqual(['workers']);
  });

  it('records an array replaced by an object of the same keys as a change', () => {
    const held = recordReading(emptySnapshot(), 'config', { state: 'read', readAt: 1, value: {} }).snapshot;
    // A reading built outside the schema: the comparison holds for any JSON value.
    const odd = { state: 'read', readAt: 2, value: [] } as unknown as { state: 'read'; readAt: number; value: Record<string, string> };
    expect(recordReading(held, 'config', odd).changed).toEqual(['config']);
  });
});
