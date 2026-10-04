import { describe, expect, it } from 'vitest';
import { run } from '../../src/server/entry/claim-answer.js';

/**
 * The wire of `plot-claim-answer.mjs`: what arrives on stdin as JSON and what
 * goes out as a tab-separated line. The rule's own tests live beside
 * `rules/claim.ts`; this only checks the JSON parse and the raw log decode.
 */

/** Runs the entry, capturing stdout rather than emitting it. */
const ask = (stdin: string) => {
  const out: string[] = [];
  const code = run(stdin, (s) => out.push(s));
  return { code, stdout: out.join('') };
};

/** One `git log --boundary --format='%m|%H|%T|%P|%at|%s'` line. */
const line = (mark: string, sha: string, tree: string, parents: string, at: string, subject: string) =>
  [mark, sha, tree, parents, at, subject].join('|');

describe('the claim-answer entry answers from JSON readings', () => {
  it('answers held-by-agent, and names the holders, when holders is non-empty', () => {
    const stdin = JSON.stringify({ ref: 'present', log: '', holders: ['agent-a', 'agent-b'] });
    expect(ask(stdin)).toEqual({ code: 0, stdout: 'held-by-agent\tagent-a\tagent-b\n' });
  });

  it('answers absent for no ref and no holders', () => {
    const stdin = JSON.stringify({ ref: 'absent', log: null, holders: [] });
    expect(ask(stdin)).toEqual({ code: 0, stdout: 'absent\n' });
  });

  it('answers stale-claim where the raw log holds only an empty claim marker', () => {
    const stdin = JSON.stringify({
      ref: 'present',
      log: [
        line('>', 'c1', 'ab1', 'b0', '1700000000', 'plot: claim feature/x'),
        line('-', 'b0', 'ab1', '', '1699999999', 'base'),
      ].join('\n'),
      holders: [],
    });
    expect(ask(stdin)).toEqual({ code: 0, stdout: 'stale-claim\n' });
  });

  it('answers work-on-ref where the raw log carries a real commit', () => {
    const stdin = JSON.stringify({
      ref: 'present',
      log: [
        line('>', 'c1', 'ab2', 'b0', '1700000000', 'implement the thing'),
        line('-', 'b0', 'ab1', '', '1699999999', 'base'),
      ].join('\n'),
      holders: [],
    });
    expect(ask(stdin)).toEqual({ code: 0, stdout: 'work-on-ref\n' });
  });

  it('answers unknown where the log is null — the caller\'s own git call failed', () => {
    const stdin = JSON.stringify({ ref: 'present', log: null, holders: [] });
    expect(ask(stdin)).toEqual({ code: 0, stdout: 'unknown\n' });
  });

  it('ignores the log where ref is not present, never reading a stale value as a reading', () => {
    const stdin = JSON.stringify({ ref: 'unknown', log: 'garbage', holders: [] });
    expect(ask(stdin)).toEqual({ code: 0, stdout: 'unknown\n' });
  });

  it('exits 2 and prints nothing for unparseable JSON', () => {
    const out: string[] = [];
    const warnings: string[] = [];
    const code = run('not json', (s) => out.push(s), (s) => warnings.push(s));
    expect(code).toBe(2);
    expect(out.join('')).toBe('');
    expect(warnings.join('')).toMatch(/not JSON/);
  });
});
