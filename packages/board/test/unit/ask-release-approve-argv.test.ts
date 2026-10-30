// `plot-ask.mjs release-approve <pr> <sha>`: the argument check in front of `releaseApproveAt`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { run } from '../../src/server/entry/main.js';

const HEX40 = 'a'.repeat(40);

describe('plot-ask release-approve argv', () => {
  afterEach(() => vi.restoreAllMocks());

  const cases: [string, string[]][] = [
    ['no arguments', ['release-approve']],
    ['no sha', ['release-approve', '7']],
    ['a non-numeric pr', ['release-approve', 'abc', 'deadbeef']],
    ['a sha shorter than 7 hex characters', ['release-approve', '7', 'dead']],
    ['a 40-character sha that is not hex', ['release-approve', '7', 'z'.repeat(40)]],
    ['a numeric-looking pr with trailing text', ['release-approve', '7x', HEX40]],
  ];

  for (const [name, argv] of cases) {
    it(`exits 2 with the usage line for ${name}`, async () => {
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const out = vi.fn();
      expect(await run(argv, '/nonexistent', out)).toBe(2);
      expect(err).toHaveBeenCalledWith('usage: plot-ask.mjs release-approve <pr> <sha>\n');
      expect(out).not.toHaveBeenCalled();
    });
  }
});
