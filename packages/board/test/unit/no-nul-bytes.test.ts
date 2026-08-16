import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No source file may contain a literal NUL byte.
 *
 * `fleet.ts` held one for weeks as a cache-key separator — the CHOICE is right,
 * since NUL cannot occur in a path and so can never be ambiguous. Writing it as
 * a raw byte instead of the `\0` escape is what cost: every line-oriented tool
 * classifies the file as binary and then ANSWERS NOTHING. `grep` reports no
 * matches without saying why; only `rg` names the reason. It cost three
 * searches in one session that read as "not there" for constants present all
 * along — and the obvious next move is to add code that already exists.
 *
 * Diffs and review views are blinded the same way, which is the part that
 * matters for a repo whose Definition of Done gates on a reviewable artifact.
 */
describe('source files stay line-readable', () => {
  const roots = ['src', 'test'];
  const exts = ['.ts', '.tsx', '.mjs', '.js'];

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) yield* walk(path);
      else if (exts.some((e) => path.endsWith(e))) yield path;
    }
  }

  it('contain no literal NUL byte — use the \\0 escape instead', () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const buf = readFileSync(file);
        const at = buf.indexOf(0);
        if (at !== -1) offenders.push(`${file} (offset ${at})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
