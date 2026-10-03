import { describe, expect, it } from 'vitest';
import { EXIT, run } from '../../src/server/entry/empty-claim.js';

/**
 * The wire of `plot-empty-claim.mjs`: which lines reach a bash caller for the
 * `git log --boundary` lines it pipes in. The rule's own tests live beside
 * `rules/empty-claim.ts`.
 */

/** Runs the entry, capturing stdout rather than emitting it. */
const ask = (stdin: string) => {
  const out: string[] = [];
  const code = run(stdin, (s) => out.push(s));
  return { code, stdout: out.join('') };
};

/** One `git log --boundary` line, as the shell's format writes it. */
const line = (key: string, mark: string, sha: string, tree: string, parents: string, subject: string) =>
  [key, mark, sha, tree, parents, subject].join('\t');

describe('the empty-claim entry counts the real commits per key', () => {
  it('answers 0 for a branch carrying only an empty claim over its boundary', () => {
    const stdin = [
      line('feature/x', '>', 'c1', 'T0', 'b0', 'plot: claim feature/x'),
      line('feature/x', '-', 'b0', 'T0', 'a0', 'base'),
    ].join('\n');
    expect(ask(`${stdin}\n`)).toEqual({ code: EXIT.ok, stdout: 'feature/x\t0\n' });
  });

  it('counts a claim-titled commit that changes a file', () => {
    const stdin = [
      line('feature/x', '>', 'c1', 'T1', 'b0', 'plot: claim feature/x'),
      line('feature/x', '-', 'b0', 'T0', 'a0', 'base'),
    ].join('\n');
    expect(ask(stdin)).toEqual({ code: EXIT.ok, stdout: 'feature/x\t1\n' });
  });

  it('counts a commit whose parent tree is not on stdin', () => {
    expect(ask(line('HEAD', '>', 'c1', 'T0', 'b0', 'plot: claim x'))).toEqual({ code: EXIT.ok, stdout: 'HEAD\t1\n' });
  });

  it('answers each key in one call, in first-seen order, reading a merge by its first parent', () => {
    const stdin = [
      line('b', '>', 'm1', 'T0', 'b0 x9', 'plot: claim b'),
      line('a', '>', 'c2', 'T2', 'c1', 'work'),
      line('a', '>', 'c1', 'T0', 'b0', 'plot: claim a'),
      line('b', '-', 'b0', 'T0', 'a0', 'base'),
      line('a', '-', 'b0', 'T0', 'a0', 'base'),
    ].join('\n');
    expect(ask(stdin)).toEqual({ code: EXIT.ok, stdout: 'b\t0\na\t1\n' });
  });

  it('keeps a tab inside the subject', () => {
    const stdin = [
      line('k', '>', 'c1', 'T0', 'b0', 'plot: claim k\textra'),
      line('k', '-', 'b0', 'T0', '', 'root'),
    ].join('\n');
    expect(ask(stdin)).toEqual({ code: EXIT.ok, stdout: 'k\t0\n' });
  });

  it('answers nothing for no input and for a key with only boundary lines', () => {
    expect(ask('')).toEqual({ code: EXIT.ok, stdout: '' });
    expect(ask(line('k', '-', 'b0', 'T0', '', 'base'))).toEqual({ code: EXIT.ok, stdout: '' });
  });
});

describe('the empty-claim entry refuses a line it cannot read', () => {
  it.each([
    ['too few fields', 'k\t>\tc1\tT0\tb0'],
    ['an unknown mark', line('k', '<', 'c1', 'T0', 'b0', 's')],
    ['an empty key', line('', '>', 'c1', 'T0', 'b0', 's')],
    ['an empty commit id', line('k', '>', '', 'T0', 'b0', 's')],
  ])('exits 2 and prints nothing for %s', (_name, stdin) => {
    expect(ask(stdin)).toEqual({ code: EXIT.usage, stdout: '' });
  });
});
