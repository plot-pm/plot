// `plot-ask.mjs merge <pr> <sha>`: the argument check in front of `mergeAt`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { run } from '../../src/server/entry/main.js';

const HEX40 = 'a'.repeat(40);

describe('plot-ask merge argv', () => {
  afterEach(() => vi.restoreAllMocks());

  const cases: [string, string[]][] = [
    ['no arguments', ['merge']],
    ['no sha', ['merge', '7']],
    ['a non-numeric pr', ['merge', 'abc', 'deadbeef']],
    ['a sha shorter than 40 hex characters', ['merge', '7', 'deadbeef']],
    ['a 40-character sha that is not hex', ['merge', '7', 'z'.repeat(40)]],
    ['a numeric-looking pr with trailing text', ['merge', '7x', HEX40]],
  ];

  for (const [name, argv] of cases) {
    it(`exits 2 with the usage line for ${name}`, async () => {
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const out = vi.fn();
      expect(await run(argv, '/nonexistent', out)).toBe(2);
      expect(err).toHaveBeenCalledWith('usage: plot-ask.mjs merge <pr> <sha>\n');
      expect(out).not.toHaveBeenCalled();
    });
  }
});
