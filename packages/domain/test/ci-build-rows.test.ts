import { describe, expect, it } from 'vitest';

import { overlayCiRows, type CiBuildReader } from '../src/adapters/host/ci-overlay.js';
import type { PrListingRow } from '../src/ports/host.js';
import { ciBuildFields, type CiBuildReading } from '../src/rules/ci-build-rows.js';

const green = { color: 'blue', checks: 'green' as const, job: 'j/b' };
const reading = (over: Partial<CiBuildReading> = {}): CiBuildReading => ({ status: 'ok', map: { b: green }, bound: null, named: [], ...over });
const row = { head: 'b', headSha: 'abc', open: true };

describe('ciBuildFields', () => {
  it('binds a named row to the answer of its commit', () => {
    const bound = { b: { checks: 'failing', job: 'j/b', checksSha: 'abc' } };
    expect(ciBuildFields(row, reading({ bound, named: ['b'] }), 'broken-lookup')).toEqual({ checks: 'failing', checksSha: 'abc', failing_checks: ['j/b'] });
  });

  it('reads a named open row with no answer as unknown and broken on the Bitbucket arm', () => {
    expect(ciBuildFields(row, reading({ named: ['b'] }), 'broken-lookup')).toEqual({ checks: 'unknown', checksSha: '', failing_checks: [], checksLookup: 'broken' });
  });

  it('lets the colour stand for a named row with no answer on the GitHub arm', () => {
    expect(ciBuildFields(row, reading({ named: ['b'] }), 'colour-stands')).toEqual({ checks: 'green', checksSha: '', failing_checks: [] });
  });

  it('reads an ambiguous row past the cap as unknown and skipped', () => {
    expect(ciBuildFields(row, reading(), 'broken-lookup')).toEqual({ checks: 'unknown', checksSha: '', failing_checks: [], checksLookup: 'skipped' });
  });

  it('reads a closed row by its colour on the Bitbucket arm', () => {
    expect(ciBuildFields({ ...row, open: false }, reading(), 'broken-lookup').checks).toBe('green');
  });

  it('reads an unmatched row as none, never as unknown', () => {
    expect(ciBuildFields({ head: 'other', headSha: 'abc', open: true }, reading(), 'colour-stands').checks).toBe('none');
  });

  it('reads every row unknown where the map did not answer', () => {
    expect(ciBuildFields(row, reading({ status: 'failed', map: {} }), 'colour-stands')).toEqual({ checks: 'unknown', checksSha: '', failing_checks: [] });
  });
});

describe('overlayCiRows', () => {
  const rows: PrListingRow[] = [{ number: 1, state: 'OPEN', head: 'b', headSha: 'abc', updatedAt: '2026-11-01T00:00:00Z', ciChecks: [], plotReview: 'x' } as unknown as PrListingRow];

  it('refuses the pass where the colour read refuses, and reads no row as empty', async () => {
    const reader: CiBuildReader = { colours: async () => ({ ok: false, said: 'no instance' }), runs: async () => null };
    expect(await overlayCiRows(rows, reader, 'broken-lookup', undefined)).toEqual({ ok: false, said: 'no instance' });
  });

  it('ends the pass at the first lookup that cannot ask, and drops the rollup fields', async () => {
    const asked: string[] = [];
    const reader: CiBuildReader = {
      colours: async () => ({ ok: true, reading: { status: 'ok', map: { b: green } } }),
      runs: async (branch) => {
        asked.push(branch);
        return null;
      },
    };
    const done = await overlayCiRows(rows, reader, 'broken-lookup', undefined);
    expect(asked).toEqual(['b']);
    expect(done.ok && done.rows[0]).toMatchObject({ checks: 'unknown', checksLookup: 'broken' });
    expect(done.ok && 'ciChecks' in (done.rows[0] ?? {})).toBe(false);
    expect(done.ok && 'plotReview' in (done.rows[0] ?? {})).toBe(false);
  });
});
