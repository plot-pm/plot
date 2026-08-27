// ITEM 7, and it is asserted by ABSENCE: `/plot-deliver` and the board reach
// ONE implementation, because the board writes no part of the transition.
//
// This is the rule the `plot-approve.sh` split established and the reason
// `Extracted` (#483) came before this wave: *board writes wrap scripts, or they
// are licensed repairs — the board never invents a lifecycle transition.* An
// implementer with no script to call would have rebuilt the phase flip, the
// `Delivered:` record and the symlink move in TypeScript, and the two
// implementations would then have drifted.
//
// An absence cannot be asserted by calling something, so this reads the source.
// It is deliberately a test rather than a review note: the rule survives exactly
// as long as something checks it, and the drift it prevents is invisible in a
// diff that merely adds a helpful-looking write.
//
// WHAT IT WOULD CATCH. A phase flip written here would be a line replacing
// `Phase: Approved` with `Phase: Delivered`, or filling a `Delivered:` record,
// in a file under `packages/board/src`. `plot-deliver.sh` does exactly that, and
// that is where it belongs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '../../src');

/** Every .ts file under packages/board/src, recursively. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * The file's code with comments stripped.
 *
 * Comments are where this rule is EXPLAINED — `auto-deliver.ts` says "nothing
 * here flips a phase" and `board.ts` says "no phase is flipped, no record
 * written" — so a naive grep would match the very prose stating the rule and
 * fail on a compliant tree. Only executable text is searched.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('ITEM 7: the board writes no lifecycle transition', () => {
  const files = sources(srcDir);

  it('finds board sources to check (the search itself must not silently pass)', () => {
    // A test that greps an empty file list passes vacuously and asserts nothing.
    expect(files.length).toBeGreaterThan(20);
  });

  it('writes no `Phase: Delivered` anywhere in packages/board/src', () => {
    const offenders = files.filter((f) => /Phase:\s*Delivered/i.test(code(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => path.relative(srcDir, f))).toEqual([]);
  });

  it('writes no plan FILE anywhere in packages/board/src', () => {
    // The `Delivered:` record is load-bearing rather than provenance: the fleet
    // scan reads its rolling window from `delivered_raw`, so a phase flip
    // without the record makes a plan INVISIBLE rather than delivered (measured
    // 2026-08-20). It is written by plot-deliver.sh, in the SAME commit as the
    // flip, and this asserts the board never opens a plan file to write one.
    //
    // The check is a WRITE reaching a plan path, not a mention of the record.
    // Its first form grepped for the string `Delivered:` and failed on
    // `deliver.ts:280` — a line of PROMPT TEXT instructing an agent to fill the
    // record. That is the board composing instructions, which is exactly the
    // shape this rule permits; the board says what must happen and something
    // else does it. A textual check that cannot tell a write from a description
    // of a write would have to be silenced on every honest comment, and a rule
    // whose test is routinely silenced stops being a rule.
    const offenders = files.filter((f) => {
      const src = code(fs.readFileSync(f, 'utf8'));
      return /(writeFileSync|appendFileSync|createWriteStream)\s*\([^;]{0,200}(planFile|planPath|plan\.file|PLAN_DIR|planDir)/i
        .test(src);
    });
    expect(offenders.map((f) => path.relative(srcDir, f))).toEqual([]);
  });

  it('the check can still SEE a plan write — it is not vacuously green', () => {
    // The regex above answers "no offenders" both when the rule holds and when
    // the pattern is wrong. Proving it fires on the thing it forbids is what
    // separates those two, and it is why the previous assertion is trustworthy.
    const wouldOffend = 'fs.writeFileSync(planFile, next, "utf8");';
    expect(
      /(writeFileSync|appendFileSync|createWriteStream)\s*\([^;]{0,200}(planFile|planPath|plan\.file|PLAN_DIR|planDir)/i
        .test(wouldOffend),
    ).toBe(true);
  });

  it('the auto-deliverer calls the script and never a phase write of its own', () => {
    const src = fs.readFileSync(path.join(srcDir, 'server/auto-deliver.ts'), 'utf8');
    // It names the script Plot ships…
    expect(src).toContain('plot-deliver.sh');
    // …and the reaper, rather than re-deriving merge state from ancestry. A
    // merged PR reports `state: CLOSED` and squash-merge leaves a branch
    // permanently ahead of main, so `plot-reap.sh` reading `mergedAt` is the
    // only thing that gets this right — this module must call it, not copy it.
    expect(src).toContain('plot-reap.sh');
    // …and writes no plan file itself.
    expect(code(src)).not.toMatch(/writeFileSync\([^)]*plan/i);
  });
});
