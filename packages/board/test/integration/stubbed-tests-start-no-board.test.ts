import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STARTS_A_BOARD,
  drivesAPage,
  judge,
  stripComments,
} from '../gate/needs-real-board.js';

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
 *
 * ## What the Deciding slice added, and where the decision lives
 *
 * `2026-08-31-a-browser-test-serves-its-own-state.md` adds declare-then-verify:
 * a file that legitimately starts a board carries
 * `// @needs-real-board: <reason>` **and** must match a structural entitlement,
 * so a test cannot join the exceptions by asserting that it belongs there.
 *
 * That decision is `test/gate/needs-real-board.ts` and not this file, because
 * both of its failure directions need a test and only one of them can be proved
 * from the live suite: demonstrating *"a declaration the structure does not
 * support fails"* needs a file somebody left broken on purpose. The predicate is
 * therefore a function of source TEXT, `test/unit/needs-real-board.test.ts`
 * hands it invented sources, and this file applies it to real ones. One
 * implementation, so the two cannot drift.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * THE BROWSER SUITE, FOUND BY WALKING AND NOT BY NAMING A DIRECTORY.
 *
 * The plan's third Open Question: the counts below used to read
 * `test/integration/` only, so a test moved to `test/unit/` read as a deletion —
 * and seven slices are about to move files. The plan's stated preference and the
 * Survey's recommendation agree: key on what a file DOES, not on where it sits.
 *
 * So the root is `test/` and the walk is recursive, narrowed by `drivesAPage` —
 * the measured form of *"launches Chromium"*, which the Survey reached from the
 * three `tiny-garden.{data,plan,story}` files that spawn the artifact, speak
 * HTTP, and are server-route tests sitting in the browser directory.
 *
 * `test/unit/count-survives-a-move.test.ts` proves it by moving a file.
 */
const TEST_ROOT = path.resolve(here, '..');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(dir, entry.name))
      : [path.join(dir, entry.name)],
  );

interface BrowserTest {
  /** Relative to `test/`, so a move between directories is visible in a failure. */
  readonly file: string;
  /** Raw source — `judge` strips internally, because the declaration IS a comment. */
  readonly source: string;
  readonly code: string;
}

const browserTests: readonly BrowserTest[] = walk(TEST_ROOT)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => {
    const source = fs.readFileSync(f, 'utf8');
    return { file: path.relative(TEST_ROOT, f), source, code: stripComments(source) };
  })
  // RAW source, not `t.code`: `drivesAPage` strips template literals for
  // itself, and comment-stripping first unbalances the backticks so the
  // literals stop being found. See the note in `parallel-project-takes-no-resource.test.ts`.
  .filter((t) => drivesAPage(t.source))
  .sort((a, b) => a.file.localeCompare(b.file));

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

describe('a browser test that stubs its own state starts no board', () => {
  it('finds the population it is meant to gate', () => {
    // A gate over an empty set passes and proves nothing. This is the guard
    // against a rename or a moved directory silently retiring the check.
    const stubbed = browserTests.filter((t) => isFullyStubbed(t.code));
    expect(stubbed.length, 'no fully-stubbed browser tests found — has the suite moved?')
      .toBeGreaterThan(0);
  });

  it('starts no board — the artifact least of all', () => {
    const offences: string[] = [];
    for (const t of browserTests) {
      if (!isFullyStubbed(t.code)) continue;
      for (const [pattern, what] of STARTS_A_BOARD) {
        if (pattern.test(t.code)) offences.push(`${t.file} ${what}`);
      }
    }
    expect(
      offences,
      'a test that supplies both payloads has nothing to start a board FOR — '
      + 'use `openCatalogue()` from test/catalogue and serve the state by name',
    ).toEqual([]);
  });

  /**
   * THE VERIFICATION ARM, applied to the live suite in the one direction it
   * can be.
   *
   * A file declaring `@needs-real-board` whose structure supports no
   * entitlement has claimed something measurable, and this refuses it. The
   * message names the arms rather than saying *invalid*, because a gate that
   * refuses without saying what would satisfy it is one the next author works
   * around instead of reading.
   *
   * **The other direction — a board-starting file that declares nothing — is
   * NOT applied to the whole suite here, and the reason is the plan's own
   * ordering.** 28 files start a board today; they are what the later slices
   * migrate, and the plan's Closing slice is where that ratchet turns. Turning
   * it now would redden 28 files this slice is explicitly forbidden to touch.
   * The rule itself is real and tested — `judge` returns `undeclared` for
   * exactly that shape, asserted in `test/unit/needs-real-board.test.ts` — and
   * it is applied below to the population that has already migrated.
   */
  it('refuses a declaration the file\'s structure does not support', () => {
    const unsupported = browserTests
      .filter((t) => judge(t.source).verdict === 'unsupported')
      .map((t) => t.file);
    expect(
      unsupported,
      'these files declare `@needs-real-board` and match no entitlement. A '
      + 'declaration is the REASON, not the permission — the file must also '
      + 'either reach a script through an un-intercepted write route, or accept '
      + 'a route and never answer it. If neither is true the state can be '
      + 'served: use `openCatalogue()` from test/catalogue',
    ).toEqual([]);
  });

  /**
   * A migrated file that starts a board again must declare why — the ratchet,
   * on the population it has already been earned against.
   *
   * This is `starts no board` said the other way round, and it is not
   * redundant: that test refuses the START, this one refuses an UNDECLARED
   * start, and the difference is what the Closing slice widens from the stubbed
   * set to the whole suite. Keeping both means the widening changes a
   * population and not a rule.
   */
  it('lets a migrated file start a board only with a declaration it can support', () => {
    const undeclared = browserTests
      .filter((t) => isFullyStubbed(t.code))
      .filter((t) => judge(t.source).verdict === 'undeclared')
      .map((t) => t.file);
    expect(
      undeclared,
      'these files serve their own state and start a board anyway, declaring '
      + 'nothing. Either drop the server, or say why with '
      + '`// @needs-real-board: <reason>` — which the gate then verifies '
      + 'structurally, so the comment alone will not do it',
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
   * **The scope is the browser SUITE, not a directory** — the plan's third Open
   * Question, settled in the Deciding slice and proved by
   * `test/unit/count-survives-a-move.test.ts`, which moves a file between
   * directories and asserts both figures hold. Before that, a slice moving a
   * test out of `test/integration/` read as a deletion here.
   */
  /**
   * What counts as a declared test, INCLUDING one carrying a modifier.
   *
   * The lookbehind rejects a preceding word character or dot, so `describe.it(`
   * and `unit(` do not count. The optional group is what admits `it.skipIf(…)(`
   * and its siblings: a guarded test still exists, still runs wherever its
   * guard allows, and must not read to this gate as a deletion.
   *
   * Measured 2026-08-31: adding one `it.skipIf(!!process.env.CI)(` dropped this
   * count from 479 to 478 and failed the gate — correctly, by its own rule,
   * since a bare `it(` had disappeared. But nothing was removed, and lowering
   * the constant would have recorded a deletion that did not happen. The
   * counter learns the spelling instead.
   */
  const IT_DECLARATION = /(?<![\w.])it\s*(?:\.\s*\w+\s*\([^)]*\)\s*)?\(/g;

  it('keeps every test it moved — a migration is not a deletion', () => {
    const its = browserTests.reduce(
      (total, t) => total + (t.code.match(IT_DECLARATION)?.length ?? 0),
      0,
    );
    expect(
      browserTests.length,
      'browser test FILES changed — a migration adds and removes none',
    ).toBe(EXPECTED_FILES);
    expect(its, 'browser test COUNT changed — assertions move, they do not disappear')
      .toBe(EXPECTED_TESTS);
  });
});

/**
 * The two counts, named so a diff that changes them says which one moved.
 *
 * `EXPECTED_FILES` counts the files under `test/` that drive a browser page;
 * `EXPECTED_TESTS` counts `it(` across them. Neither is a target — they are a
 * tripwire, and a legitimate new test updates them in the same commit that
 * adds it.
 *
 * **48 → 44 and 479 → 454 on 2026-08-31, and NOT because anything was deleted.**
 * The scope changed from `test/integration/*.test.ts` to *the files that drive a
 * page, wherever they sit*, which drops four files the old scope counted and
 * should not have: the three `tiny-garden.{data,plan,story}` server-route tests
 * (22 `it(` — they spawn the artifact and speak HTTP, so *"serve your own
 * state"* is not a thing they could do, per the Survey) and this gate file
 * itself (3 `it(`, now 5).
 *
 * Stated as the subtraction it was — 479 − 22 − 3 = 454 — so the change reads as
 * a re-scoping rather than as a loss. The tests this slice adds are all in files
 * the new scope does not count, which is why `EXPECTED_TESTS` moves by exactly
 * the 25 that left it.
 *
 * IT WENT 454 → 453 → 454 WHILE THIS SLICE WAS IN FLIGHT, and the round trip is
 * worth recording because neither move came from this branch. `0981d52a`
 * skipped the 375px wrap assertion as a flake, taking main 479 → 478; then
 * `91a89d95` taught the counter to read `it.skipIf(…)(` as a declaration, which
 * put it back. A guarded test is still a test, so the second fix is the right
 * one and this file now shares its `IT_DECLARATION`.
 *
 * The lesson the number itself teaches: this constant tracks a MEASUREMENT, so
 * it is re-derived against the main the branch sits on and never adjusted by
 * arithmetic on a stale one. Both times the tripwire fired it was correct to.
 */
const EXPECTED_FILES = 44;
/**
 * 454 → 457 → 461 ON 2026-09-01, and both raises added tests to the CATALOGUE.
 *
 * The Naming slice took the catalogue from 3 named scenarios to 8, and
 * `mock-board.browser.test.ts` gained one test per new shape it serves — which
 * is the deliverable rather than a side effect: a scenario nothing asserts
 * against is a payload nobody has shown the board can render.
 *
 * 457 → 461 is the same argument one layer down. The mock gained `served()` and
 * `fail()`, the two behaviours `agents-tab.browser.test.ts` needs that a static
 * payload cannot express, and four tests assert them: the count advances, a
 * swap lands on the next request, a refusal rejects while `/` still serves, and
 * a refused request is not counted. A capability the migration is about to
 * depend on across 111 tests is worth four of its own first.
 *
 * 461 → 462 is `serveDoc`, one test for one capability: a registered document
 * serves, an unregistered one 404s, and the page is untouched. The 404 is the
 * point — a plan with no file is a state `story-overlay` asserts on, and the
 * mock answering it means that file needs no fixture on disk.
 *
 * Raised deliberately, in the commit that adds them, which is the whole
 * mechanism this pair exists for.
 */
const EXPECTED_TESTS = 462;
