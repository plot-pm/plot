import { describe, expect, it } from 'vitest';

import type { AgentRunEnd } from '../src/ports/agent-run.js';
import { BOUND_CODE, boardHandBackKind, boardRunEnd } from '../src/rules/board-run-end.js';

const TREE = '/repo';
const read = (
  role: string,
  end: AgentRunEnd,
  runner: 'command' | 'sdk' = 'sdk',
  exists: (p: string) => boolean = () => true,
) => boardRunEnd({ role, runner, tree: TREE, end, exists });

describe('boardHandBackKind', () => {
  it('names outcome for approve, deliver and auto-deliver, and written for every other role', () => {
    expect(['approve', 'deliver', 'auto-deliver'].map(boardHandBackKind)).toEqual(['outcome', 'outcome', 'outcome']);
    expect(['idea', 'commission', 'reslice', 'story', 'brief', 'implement', 'interrogate'].map(boardHandBackKind)).toEqual(
      Array(7).fill('written'),
    );
  });
});

describe('boardRunEnd: a run that did not hand back', () => {
  it('records each non-ran end as a failure that names it', () => {
    expect(read('idea', { answer: 'unstarted', detail: 'the command exited with status 3' })).toEqual({
      code: 1,
      line: 'the idea run did not start: the command exited with status 3',
      outcome: null,
      written: null,
    });
    expect(read('idea', { answer: 'wait', resetEpoch: 0 }).line).toBe(
      "the idea run stopped at the account's usage limit, which resets at 1970-01-01T00:00:00.000Z",
    );
    expect(read('idea', { answer: 'end-limited', cause: 'no-reset' }).line).toBe(
      "the idea run stopped at the account's usage limit (no-reset)",
    );
    expect(read('idea', { answer: 'bound' })).toMatchObject({ code: BOUND_CODE, line: 'the idea run was ended at its time bound' });
    expect(read('idea', { answer: 'turn-limit' }).line).toBe('the idea run reached its turn limit');
    expect(read('idea', { answer: 'spend-limit' }).line).toBe('the idea run reached its spend limit');
    expect(read('idea', { answer: 'dropped', line: 'terminating.' })).toMatchObject({
      code: 1,
      line: 'the idea run ended with its background work dropped: terminating.',
    });
  });

  it('reads a command run with no hand-back as success, and an sdk run with none as a failure', () => {
    expect(read('idea', { answer: 'ran', handBack: null }, 'command')).toEqual({ code: 0, line: '', outcome: null, written: null });
    expect(read('idea', { answer: 'ran', handBack: null }, 'sdk')).toEqual({
      code: 1,
      line: 'the idea run ended with no hand-back',
      outcome: null,
      written: null,
    });
  });
});

describe('boardRunEnd: an outcome role', () => {
  it('records done as 0 and refused as 1 with the summary', () => {
    expect(read('approve', { answer: 'ran', handBack: { outcome: 'done', summary: 'approved' } })).toEqual({
      code: 0,
      line: 'approved',
      outcome: 'done',
      written: null,
    });
    expect(read('approve', { answer: 'ran', handBack: { outcome: 'refused', summary: 'still a draft' } })).toEqual({
      code: 1,
      line: 'the approve run refused: still a draft',
      outcome: 'refused',
      written: null,
    });
  });

  it('refuses a written or worker hand-back from an outcome role', () => {
    expect(read('deliver', { answer: 'ran', handBack: { written: 'a.md', summary: '' } }).line).toBe(
      'the deliver run ended with no outcome hand-back',
    );
    expect(read('deliver', { answer: 'ran', handBack: { next: 'done', summary: '' } }).code).toBe(1);
  });
});

describe('boardRunEnd: a written role', () => {
  it('answers the resolved path of an existing file inside the tree', () => {
    const seen: string[] = [];
    const record = read('idea', { answer: 'ran', handBack: { written: 'docs/plans/a.md', summary: 'wrote it' } }, 'sdk', (p) => {
      seen.push(p);
      return true;
    });
    expect(record).toEqual({ code: 0, line: 'wrote it', outcome: null, written: '/repo/docs/plans/a.md' });
    expect(seen).toEqual(['/repo/docs/plans/a.md']);
  });

  it('refuses a path outside the tree, relative or absolute', () => {
    for (const written of ['../../etc/passwd', '/etc/passwd']) {
      const record = read('idea', { answer: 'ran', handBack: { written, summary: '' } });
      expect(record.code).toBe(1);
      expect(record.line).toMatch(/^the idea run's written path was refused: .* resolves outside the repository/);
    }
  });

  it('refuses a path that does not exist', () => {
    expect(read('idea', { answer: 'ran', handBack: { written: 'docs/plans/gone.md', summary: '' } }, 'sdk', () => false)).toEqual({
      code: 1,
      line: "the idea run's written path does not exist: 'docs/plans/gone.md'",
      outcome: null,
      written: null,
    });
  });

  it('refuses an outcome hand-back from a written role', () => {
    expect(read('idea', { answer: 'ran', handBack: { outcome: 'done', summary: '' } }).line).toBe(
      'the idea run ended with no written hand-back',
    );
  });
});
