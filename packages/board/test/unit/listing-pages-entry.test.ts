import { describe, expect, it } from 'vitest';
import { run } from '../../src/server/entry/listing-pages.js';

/**
 * THE ENTRY IS AN ADAPTER AND THESE TEST THE ADAPTATION.
 *
 * `githubExtraPages` is asserted in the domain. What can only fail here is the
 * wire: a count as an argument or a JSON array on stdin in, one number and an
 * exit code out.
 */
const ask = (argv: string[], stdin = ''): { code: number; out: string } => {
  let out = '';
  const code = run(argv, () => stdin, (s) => { out += s; });
  return { code, out };
};

describe('plot-listing-pages', () => {
  it.each([['0', '0'], ['100', '0'], ['101', '1'], ['250', '2'], ['500', '4']])('%s rows answer %s extra requests', (rows, extra) => {
    expect(ask([rows])).toEqual({ code: 0, out: `${extra}\n` });
  });

  it('reads the row count from a JSON array on stdin', () => {
    expect(ask([], JSON.stringify(Array.from({ length: 250 }, (_, i) => ({ i }))))).toEqual({ code: 0, out: '2\n' });
  });

  it.each([['abc'], ['-1'], ['1.5']])('prints nothing and exits 3 for the count %s', (rows) => {
    expect(ask([rows])).toEqual({ code: 3, out: '' });
  });

  it('prints nothing and exits 3 for stdin that is not a JSON array', () => {
    expect(ask([], '{"a":1}')).toEqual({ code: 3, out: '' });
    expect(ask([], '')).toEqual({ code: 3, out: '' });
  });
});
