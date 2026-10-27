import { describe, expect, it } from 'vitest';
import { carriedWorkOf, holdFromClaimOnly } from '../src/index.js';
import type { Host, Refs } from '../src/index.js';

const ports = (sha: { ok: boolean; value?: string }, files: { ok: boolean; value?: string[] }) =>
  ({
    host: { prMergeCommit: async () => sha } as unknown as Host,
    refs: { commitFiles: async () => files } as unknown as Refs,
  });

describe('carriedWorkOf', () => {
  it('is false when the merge commit lists no file', async () => {
    expect(await carriedWorkOf(ports({ ok: true, value: 'abc' }, { ok: true, value: [] }), 'b')).toBe(false);
  });
  it('is false when only a PLOT-BLOCKED marker changed', async () => {
    expect(await carriedWorkOf(ports({ ok: true, value: 'abc' }, { ok: true, value: ['PLOT-BLOCKED.md'] }), 'b')).toBe(false);
  });
  it('is true for a source file and for docs alone', async () => {
    expect(await carriedWorkOf(ports({ ok: true, value: 'abc' }, { ok: true, value: ['src/a.ts'] }), 'b')).toBe(true);
    expect(await carriedWorkOf(ports({ ok: true, value: 'abc' }, { ok: true, value: ['docs/notes.md'] }), 'b')).toBe(true);
  });
  it('is unknown for a failed host, an empty sha and a failed file read', async () => {
    expect(await carriedWorkOf(ports({ ok: false }, { ok: true, value: ['a'] }), 'b')).toBe('unknown');
    expect(await carriedWorkOf(ports({ ok: true, value: '' }, { ok: true, value: ['a'] }), 'b')).toBe('unknown');
    expect(await carriedWorkOf(ports({ ok: true, value: 'abc' }, { ok: false }), 'b')).toBe('unknown');
  });
});

describe('holdFromClaimOnly', () => {
  it('names the first claim-only branch, then unknown, else null', () => {
    expect(holdFromClaimOnly([['a', true], ['b', false], ['c', 'unknown']])).toBe('claim-only b');
    expect(holdFromClaimOnly([['a', true], ['c', 'unknown']])).toBe('unknown');
    expect(holdFromClaimOnly([['a', true]])).toBeNull();
  });
});
