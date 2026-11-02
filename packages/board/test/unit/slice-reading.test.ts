import { describe, it, expect } from 'vitest';
import { sliceRowReading } from '../../src/app/lib/agent-rows/slice-reading.js';
import type { AgentRow } from '../../src/contract/schema.js';

type R = Pick<AgentRow, 'branch' | 'state' | 'startability' | 'note'>;

const waiting = (branch: string, note = `waits for feature/first`): R =>
  ({ branch, state: 'waiting', startability: null, note });
const blocked = (branch: string): R =>
  ({ branch, state: 'blocked', startability: null, note: 'waits for bug/typo, which has no pull request' });
const open = (branch: string): R =>
  ({ branch, state: 'open', startability: 'start-work', note: '' });

describe('sliceRowReading', () => {
  it('reads a held waiting slice as waiting, with the branch note, tone time, no dispatch', () => {
    expect(sliceRowReading('eligible', [waiting('feature/a')])).toEqual({
      held: true, word: 'waiting', note: 'waits for feature/first', tone: 'time', dispatch: false,
    });
  });

  it('reads a held blocked slice as waiting, tone you, with the no-pull-request note', () => {
    const r = sliceRowReading('eligible', [blocked('feature/a')]);
    expect(r.word).toBe('waiting');
    expect(r.note.endsWith('which has no pull request')).toBe(true);
    expect(r.tone).toBe('you');
    expect(r.dispatch).toBe(false);
  });

  it('holds a multi-branch slice and joins the notes with "; "', () => {
    const r = sliceRowReading('eligible', [waiting('feature/a', 'waits for x'), waiting('feature/b', 'waits for y')]);
    expect(r.held).toBe(true);
    expect(r.note).toBe('waits for x; waits for y');
  });

  it('lets a blocked branch outrank a waiting one for tone only', () => {
    const r = sliceRowReading('eligible', [waiting('feature/a'), blocked('feature/b')]);
    expect(r.word).toBe('waiting');
    expect(r.tone).toBe('you');
  });

  it('does not hold an open + waiting slice: it stays eligible with a dispatch', () => {
    expect(sliceRowReading('eligible', [open('feature/a'), waiting('feature/b')])).toEqual({
      held: false, word: null, note: 'approved — nobody has taken it', tone: 'you', dispatch: true,
    });
  });

  it('leaves the blocked verdict unchanged', () => {
    expect(sliceRowReading('blocked', [waiting('feature/a')])).toEqual({
      held: false, word: null, note: 'an earlier slice has to land first', tone: 'time', dispatch: false,
    });
  });

  it('leaves the unapproved verdict unchanged', () => {
    expect(sliceRowReading('unapproved', [waiting('feature/a')])).toEqual({
      held: false, word: null, note: 'the plan needs approving first', tone: 'you', dispatch: false,
    });
  });
});
