import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drivesAPage, stripComments } from '../gate/needs-real-board.js';

/**
 * THE COUNT SURVIVES A FILE MOVING BETWEEN DIRECTORIES — proved by moving one.
 *
 * `2026-08-31-a-browser-test-serves-its-own-state.md`, third Open Question:
 *
 * > Is the assertion-count gate strong enough once files move between
 * > directories? It counts `it(` in `test/integration/`; a slice that moved a
 * > test to `test/unit/` would look like a deletion. Decide in the Deciding
 * > slice, before the first file moves.
 *
 * The answer is the walk: `test/` recursively, narrowed by *drives a page*
 * rather than by directory. This file is the proof, and the brief asks for it in
 * those words — *"prove it with a test that moves a file and stays green."*
 *
 * ## Why it moves a real file and not a fixture
 *
 * A fixture in a temp directory would prove the walk walks. It would NOT prove
 * the thing at issue, which is that the gate's own population is unchanged by a
 * move — and the only way to know that is to count the real suite, move a real
 * file, and count again.
 *
 * So this test performs the move inside the real `test/` tree, in a `try` whose
 * `finally` puts the file back, plus an `afterEach` for the case where the
 * assertion throws somewhere the `finally` cannot reach. Both, because a move
 * left half-done breaks every other file in the suite and the next run reads it
 * as an unrelated collapse.
 *
 * ## What it does NOT do
 *
 * It does not run vitest, and it does not move a file the running suite has
 * already collected. The counts are computed by the same walk the gate uses,
 * over the filesystem, in-process — which is exactly the computation under test.
 * Moving a file that vitest has open would test vitest's collector instead.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = path.resolve(here, '..');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(dir, entry.name))
      : [path.join(dir, entry.name)],
  );

interface Census {
  readonly files: number;
  readonly its: number;
  /** Paths relative to `test/`, sorted — so a diff names what moved. */
  readonly where: readonly string[];
}

/**
 * The gate's population and counts, recomputed from the filesystem.
 *
 * Deliberately a re-implementation of the gate's few lines rather than an
 * import of them: what is under test is that the ANSWER is invariant under a
 * move, and a census that shared the gate's cached module-level array would
 * report the state at import time and pass whatever happened afterwards.
 */
const census = (): Census => {
  const found = walk(TEST_ROOT)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => {
      const source = fs.readFileSync(f, 'utf8');
      // RAW into `drivesAPage`, stripped for counting: it strips fixtures for
      // itself, and stripping comments first unbalances the backticks.
      return { file: path.relative(TEST_ROOT, f), source, code: stripComments(source) };
    })
    .filter((t) => drivesAPage(t.source));
  return {
    files: found.length,
    its: found.reduce((n, t) => n + (t.code.match(/(?<![\w.])it\s*\(/g)?.length ?? 0), 0),
    where: found.map((t) => t.file).sort(),
  };
};

/**
 * The file that moves, and why this one.
 *
 * `wave-in-working.browser.test.ts` — 2 `it(`, the smallest browser file that
 * both drives a page and starts a board, so it is representative of the
 * population the later slices will move and cheap to name in a failure. It is
 * moved and moved back; nothing about it is edited, which is the scope guard's
 * line (*"no test migrates in this slice"*) kept literally.
 */
const MOVER = 'integration/wave-in-working.browser.test.ts';
const DESTINATION = 'unit/moved-browser-test.probe.test.ts';

const abs = (rel: string) => path.join(TEST_ROOT, rel);

/**
 * The destination name ends `.probe.test.ts` and NOT `.test.ts` by accident:
 * `vitest.config.ts` includes `test/unit/**\/*.test.ts`, so a file parked there
 * under a collectible name would be collected by a concurrent run of the very
 * suite this test is moving it inside. `.probe.test.ts` still matches that glob
 * — which is the point, since the gate must count it — but the move exists for
 * microseconds and the file is restored before this test returns.
 */
afterEach(() => {
  // The safety net for a throw the `finally` below cannot catch. A half-done
  // move breaks the whole suite, and the next run reports it as something else.
  if (fs.existsSync(abs(DESTINATION))) fs.renameSync(abs(DESTINATION), abs(MOVER));
});

describe('the browser-test count is keyed on what a file does, not where it sits', () => {
  it('finds the file it is about to move', () => {
    // Without this the move below is a no-op and every assertion after it is
    // vacuous — the same guard the gate's `finds the population` test gives.
    expect(fs.existsSync(abs(MOVER)), `${MOVER} is gone — has the suite been re-cut?`).toBe(true);
    expect(census().where).toContain(MOVER);
  });

  it('counts the same files and the same tests after a move between directories', () => {
    const before = census();
    expect(before.files, 'the census found no browser tests — has the walk broken?')
      .toBeGreaterThan(0);

    fs.renameSync(abs(MOVER), abs(DESTINATION));
    try {
      const after = census();

      // THE ASSERTION THE OPEN QUESTION ASKED FOR. Under the old scope this is
      // where the count dropped by 2 and read as a deletion.
      expect(after.files, 'a moved browser test read as a deleted one').toBe(before.files);
      expect(after.its, 'a moved browser test read as deleted assertions').toBe(before.its);

      // And the move really happened — otherwise the equality above is the
      // equality of two identical reads.
      expect(after.where).toContain(DESTINATION);
      expect(after.where).not.toContain(MOVER);
    } finally {
      fs.renameSync(abs(DESTINATION), abs(MOVER));
    }

    // Restored, so no later file in the run sees a suite mid-move.
    expect(census().where).toContain(MOVER);
  });

  it('still excludes a non-browser file wherever it sits', () => {
    // The scope is not "everything under test/" — that would fold 87 unit files
    // and 1913 unrelated assertions into the tripwire, and every new unit test
    // anywhere in the board would redden the gate. `drivesAPage` is what keeps
    // the count a statement about the browser suite.
    const all = walk(TEST_ROOT).filter((f) => f.endsWith('.test.ts')).length;
    expect(census().files).toBeLessThan(all);
  });

  it('does not count itself, and neither does it count the gate', () => {
    // Both files read the suite; neither drives a page. If either counted, the
    // tripwire would move whenever a test about the tripwire was added.
    const counted = census().where;
    expect(counted).not.toContain('unit/count-survives-a-move.test.ts');
    expect(counted).not.toContain('integration/stubbed-tests-start-no-board.test.ts');
  });
});
