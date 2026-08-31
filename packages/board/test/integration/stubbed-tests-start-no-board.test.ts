import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * NO FULLY-STUBBED BROWSER TEST STARTS A BOARD — the gate, not the claim.
 *
 * `Done when` item 1 of `2026-08-28-a-ui-test-needs-data-not-a-board.md`, and
 * the reason it is a gate rather than a line in a README: the migration it
 * guards is mechanical, so a later test written from the shape of its
 * neighbours would reintroduce the spawn without anyone reading a rule.
 *
 * ## What it refuses, and why it names the artifact
 *
 * The failure mode is NOT "forgot to mock". It is **"reused the real server,
 * pointed at a fixture"** — which passes a check for `startServer` alone,
 * because three files in this directory already spawn `board-server.mjs` by
 * hand rather than through the helper (`agent-panel-links`, `command-copy`,
 * `worker-log`, measured 2026-08-31). So all three spellings are named:
 * `startServer`, a bare `spawn(`, and the artifact path itself.
 *
 * ## Why the population is DERIVED and not listed
 *
 * A hard-coded list of file names is a second place to update, and it fails
 * open: a new stubbed test simply is not on it. The population is computed
 * from the property that defines it — a file that stubs `/api/board` or
 * `/api/fleet` is a file whose board state is its own, so it has nothing to
 * start a board for. The plan's count has already moved twice (35 → 39 → 38),
 * which is precisely why the number is not written down here.
 *
 * ## The vacuous pass this closes
 *
 * The grep above passes trivially if the migration DELETES tests instead of
 * moving them. `assertions are unchanged` (item 3) cannot be asserted from
 * inside the suite — a diff is not a runtime value — but its cheapest proxy
 * can: the number of test FILES and the number of `it(` in them. Both are
 * asserted below, so "mock everything by deleting it" fails here rather than
 * in a review that has to notice an absence.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

/** Source with comments removed — a comment explaining an absence must not fail the grep. */
const codeOf = (file: string): string =>
  fs.readFileSync(path.join(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const testFiles = fs.readdirSync(here).filter((f) => f.endsWith('.test.ts')).sort();

/**
 * A file is FULLY STUBBED when it supplies both payloads the board renders
 * from. Either alone leaves the other half coming from a live scan, which is
 * a different subject and a different slice.
 *
 * SUPPLYING IS NOT MERELY ROUTING, and the difference is not academic. A route
 * that calls `route.abort()` registers a handler and supplies NOTHING — the
 * page gets a failed request, which is the opposite of a stubbed payload.
 *
 * Measured 2026-08-31: `agents-tab.browser.test.ts` routes `/api/fleet` 13
 * times and `/api/board` exactly once, as
 * `route.abort('connectionrefused')` — a deliberate transport-failure test.
 * It reads the REAL board payload everywhere else, which is why its assertions
 * name a real tiny-garden card and why its own comment says *"real repo
 * /api/board takes seconds, so this is the ordinary case"*.
 *
 * Under the previous predicate that file counted as fully stubbed and the gate
 * demanded a migration that would have replaced a real dependency with a
 * fixture — 3999 lines and 114 tests, to satisfy a false positive.
 */
/**
 * Does this file SUPPLY a payload for `endpoint`?
 *
 * Splits on the route call and reads the handler that follows, so `abort` is
 * told from `fulfill`. Six lines of lookahead covers every handler shape in
 * this directory — the fulfills that fit on one line and the ones that spread
 * a JSON.stringify over several.
 */
const suppliesPayload = (code: string, endpoint: string): boolean =>
  code
    .split(new RegExp(`page\\.route\\(\\s*['"\`][^'"\`]*\\/api\\/${endpoint}`))
    .slice(1)
    .some((after) => !/^[^\n]*(\n[^\n]*){0,5}/.exec(after)?.[0]?.includes('route.abort'));

const isFullyStubbed = (code: string): boolean =>
  suppliesPayload(code, 'board') && suppliesPayload(code, 'fleet');

/** Every spelling of "start the real board", including the two that bypass the helper. */
const STARTS_A_BOARD: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bstartServer\b/, 'calls startServer'],
  [/\bspawn\s*\(/, 'spawns a process'],
  [/board-server\.mjs/, 'references the board artifact'],
];

describe('a browser test that stubs its own state starts no board', () => {
  it('finds the population it is meant to gate', () => {
    // A gate over an empty set passes and proves nothing. This is the guard
    // against a rename or a moved directory silently retiring the check.
    const stubbed = testFiles.filter((f) => isFullyStubbed(codeOf(f)));
    expect(stubbed.length, 'no fully-stubbed browser tests found — has the suite moved?')
      .toBeGreaterThan(0);
  });

  it('starts no board — the artifact least of all', () => {
    const offences: string[] = [];
    for (const file of testFiles) {
      const code = codeOf(file);
      if (!isFullyStubbed(code)) continue;
      for (const [pattern, what] of STARTS_A_BOARD) {
        if (pattern.test(code)) offences.push(`${file} ${what}`);
      }
    }
    expect(
      offences,
      'a test that supplies both payloads has nothing to start a board FOR — '
      + 'use `openCatalogue()` from test/catalogue and serve the state by name',
    ).toEqual([]);
  });

  /**
   * THE COUNTS, which is what stops the gate above passing by subtraction.
   *
   * Both numbers are written down deliberately, and that is the opposite of
   * the reasoning that left the population derived: this pair exists to fail
   * when it changes. Raising either is a decision about the suite's coverage,
   * and it should cost a line in a diff that says so.
   *
   * Measured 2026-08-31 on `main`, before the migration: 47 files, 477 tests
   * in the `serial` project. The migration moves where data comes from and
   * adds this file, so the expected end state is 48 files and 477 + this
   * file's own tests.
   */
  it('keeps every test it moved — a migration is not a deletion', () => {
    const its = testFiles.reduce(
      (total, file) => total + (codeOf(file).match(/(?<![\w.])it\s*\(/g)?.length ?? 0),
      0,
    );
    expect(testFiles.length, 'browser test FILES changed — a migration adds and removes none')
      .toBe(EXPECTED_FILES);
    expect(its, 'browser test COUNT changed — assertions move, they do not disappear')
      .toBe(EXPECTED_TESTS);
  });
});

/**
 * The two counts, named so a diff that changes them says which one moved.
 *
 * `EXPECTED_FILES` counts `test/integration/*.test.ts`; `EXPECTED_TESTS`
 * counts `it(` across them. Neither is a target — they are a tripwire, and a
 * legitimate new test updates them in the same commit that adds it.
 */
const EXPECTED_FILES = 48;
/**
 * 473 → 479 on 2026-08-31, and NOT because this branch moved anything.
 *
 * The tripwire fired the way it is supposed to: main added six browser tests
 * while this migration was in flight, so the branch's own count (473, measured
 * against the main it was cut from) was six behind the main it now sits on.
 * The migration itself still adds and removes none — `EXPECTED_FILES` did not
 * move, and the two gate assertions above still report an empty offence list.
 *
 * Raised to the real current number rather than by six, so the value stays a
 * measurement of the suite rather than an arithmetic on a stale one.
 */
const EXPECTED_TESTS = 479;
