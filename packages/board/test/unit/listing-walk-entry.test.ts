import { describe, expect, it } from 'vitest';
import { ANSWERED, run } from '../../src/server/entry/listing-walk.js';

/**
 * THE ENTRY IS AN ADAPTER AND THESE TEST THE ADAPTATION.
 *
 * `walkStep`'s stop rule is asserted in the domain. What can only fail here is
 * the wire: one Bitbucket response per line in, the exit code, the trimmed rows
 * and the `next` reading out.
 */

/** One Bitbucket listing response with `rows` values, its `next` named or not. */
const page = (rows: number, next: boolean): string =>
  JSON.stringify({ values: Array.from({ length: rows }, (_, i) => ({ id: i + 1 })), page: 1, ...(next ? { next: 'https://api.bitbucket.org/2.0/p' } : {}) });

/** Runs the entry and collects what it wrote. */
const ask = (argv: string[], lines: string[]): { code: number; out: string; next: string | null } => {
  let out = '';
  let next: string | null = null;
  const code = run(argv, `${lines.join('\n')}\n`, (s) => { out += s; }, (_path, s) => { next = s; });
  return { code, out, next };
};

describe('plot-listing-walk', () => {
  it('exits 0 and writes nothing where the walk reads another page', () => {
    expect(ask(['1000', '50', 'f'], [page(50, true)])).toEqual({ code: 0, out: '', next: null });
  });

  it('prints every page\'s rows and reads 0 where the last page names no further page', () => {
    const { code, out, next } = ask(['1000', '50', 'f'], [page(50, true), page(3, false)]);
    expect(code).toBe(ANSWERED);
    expect(JSON.parse(out)).toHaveLength(53);
    expect(next).toBe('0\n');
  });

  it('trims to the limit and reads 1 where the trim drops a row', () => {
    const { code, out, next } = ask(['30', '50', 'f'], [page(50, true)]);
    expect(code).toBe(ANSWERED);
    expect(JSON.parse(out)).toHaveLength(30);
    expect(next).toBe('1\n');
  });

  it('reads empty for a page with no envelope, and writes no reading with no file named', () => {
    expect(ask(['1000', '50', 'f'], ['{"values":[{"id":1}]}']).next).toBe('\n');
    expect(ask(['1000', '50'], [page(1, false)])).toEqual({ code: ANSWERED, out: '[{"id":1}]\n', next: null });
  });

  it('stops where the last page names a further page the shell cannot follow', () => {
    expect(ask(['1000', '50', 'f'], ['{"values":[],"page":1,"next":null}']).code).toBe(ANSWERED);
  });

  it('exits 3 on a page that is not a JSON object, and on a bad limit', () => {
    expect(ask(['1000', '50'], ['[1]']).code).toBe(3);
    expect(ask(['1000', '50'], ['{']).code).toBe(3);
    expect(ask(['0', '50'], [page(1, false)]).code).toBe(3);
  });
});
