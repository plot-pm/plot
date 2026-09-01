/**
 * THE DECLARE-THEN-VERIFY PREDICATE, as a module rather than as a closure.
 *
 * `2026-08-31-a-browser-test-serves-its-own-state.md`, the Deciding slice. The
 * gate that uses it lives in `test/integration/stubbed-tests-start-no-board.test.ts`;
 * the tests that prove it lives in `test/unit/needs-real-board.test.ts`.
 *
 * **Extracted for one reason: both failure directions need a test.** A file that
 * starts a board without a valid declaration must fail, and a file that declares
 * while matching no entitlement must ALSO fail — and the second direction is the
 * one that cannot be proved from the live suite, because a file which would
 * demonstrate it is a file somebody has to write and leave broken. So the
 * decision is a function of SOURCE TEXT and nothing else: no `fs`, no paths, no
 * suite. Its tests hand it strings.
 *
 * That is also what keeps the gate honest about its own scope. The gate reads
 * files and applies this; the unit tests apply this to invented sources. Neither
 * can drift from the other, because there is one implementation.
 *
 * This module is `test/gate/` and not `test/unit/`, because `vitest.config.ts`
 * includes `test/unit/**\/*.test.ts` — a non-test module beside them is a file
 * the include pattern skips, which reads as an oversight rather than a decision.
 */

/** Source with comments removed — a comment explaining an absence must not fail a grep. */
export const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * Every spelling of "start the real board", including the two that bypass the
 * helper.
 *
 * Three and not one, because the failure mode is NOT "forgot to mock" — it is
 * *"reused the real server, pointed at a fixture"*, which passes a check for
 * `startServer` alone. Three files in `test/integration` spawn
 * `board-server.mjs` by hand (`agent-panel-links`, `command-copy`, `worker-log`,
 * measured 2026-08-31).
 */
export const STARTS_A_BOARD: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bstartServer\b/, 'calls startServer'],
  [/\bspawn\s*\(/, 'spawns a process'],
  [/board-server\.mjs/, 'references the board artifact'],
];

/** Which spellings of "start a board" this source uses, by name. */
export const boardStartsIn = (code: string): string[] =>
  STARTS_A_BOARD.filter(([pattern]) => pattern.test(code)).map(([, what]) => what);

export const startsABoard = (code: string): boolean => boardStartsIn(code).length > 0;

/**
 * THE DECLARATION — and it is not the permission.
 *
 * The gate's own docblock already carries the argument against a list:
 *
 * > A hard-coded list of file names is a second place to update, and it fails
 * > open: a new stubbed test simply is not on it.
 *
 * A bare `// @needs-real-board` marker reintroduces exactly that failure one
 * line at a time — a test would join the exceptions by claiming to belong there,
 * and the claim would be the whole check.
 *
 * So the marker DECLARES and the structure VERIFIES. The division of labour is
 * the point: the marker supplies the **reason**, which no predicate can infer;
 * the structure supplies the **entitlement**, which no comment should be trusted
 * for.
 *
 * The reason is REQUIRED, hence the `:\s*(\S.*)`. A bare `// @needs-real-board`
 * with nothing after it declares nothing a reader can act on, and reads to this
 * predicate as no declaration at all — which makes a board-starting file
 * carrying it an offence, not an exception.
 */
const DECLARATION = /^[ \t]*\/\/[ \t]*@needs-real-board:[ \t]*(\S.*?)[ \t]*$/m;

/**
 * The declared reason, or `null` where the file does not declare one.
 *
 * Reads the RAW source, not the stripped source — the declaration IS a comment,
 * so `stripComments` removes it. That asymmetry is deliberate and is the reason
 * every other predicate here takes stripped code: a marker must survive
 * stripping to be read, and a USE must not survive it to be counted.
 */
export const declaredReason = (rawSource: string): string | null =>
  DECLARATION.exec(rawSource)?.[1] ?? null;

/** The write endpoints — the routes that leave the browser and can reach a script. */
export const WRITE_ENDPOINTS = [
  'approve', 'dispatch', 'dispatch-log', 'claim', 'transition', 'deliver',
  'reslice', 'continue', 'commission', 'idea', 'implement', 'fleet-controls',
] as const;

/** The write endpoints this source references at all. */
export const writesReferenced = (code: string): string[] =>
  WRITE_ENDPOINTS.filter((ep) => new RegExp(`/api/${ep}\\b`).test(code));

/** The endpoints handed to `page.route` — intercepted, so no script runs. */
export const endpointsIntercepted = (code: string): ReadonlySet<string> =>
  new Set(
    [...code.matchAll(/page\.route\(\s*['"`][^'"`]*\/api\/([a-z-]+)/g)]
      .map((m) => m[1] as string),
  );

/**
 * A `page.route` handler and the few lines that follow it.
 *
 * Bounded at eight lines for the reason `suppliesPayload` bounds itself at six:
 * a handler in this suite is a few lines, and an unbounded read would find the
 * NEXT test's `fulfill` and call this handler answered.
 */
const routeHandlers = (code: string): string[] =>
  code
    .split(/page\.route\(/)
    .slice(1)
    .map((after) => /^[^\n]*(\n[^\n]*){0,8}/.exec(after)?.[0] ?? '');

/**
 * THE ENTITLEMENTS — three arms in the plan, two with a population here.
 *
 * The Survey supplied one and corrected another, both by measurement:
 *
 * **A write route entitles only when it is UN-INTERCEPTED.** Six files touch a
 * write endpoint; five `page.route` every one they touch, so the write never
 * leaves the browser and a mock accepting it would assert the same thing.
 * `approve.browser.test.ts` is the only file where a POST reaches the configured
 * `Approve command` — it copies the fixture to a temp directory so the real
 * config is read, and asserts the script's own failure sentence on the card.
 * Entitling on *mentions a write endpoint* would hand an exception to five files
 * that do not need one.
 *
 * **`dead-fetch.browser.test.ts` asserts neither a write nor a process** and
 * would have been refused by the plan's two named arms. It needs a real
 * transport it can ABANDON: a route handler that accepts the connection and
 * never answers, which its own docstring records `route.abort()` cannot
 * reproduce because *"a test built on it passes against the bug."* That shape is
 * structural, so it is an entitlement rather than an exception.
 *
 * ## The arm that is absent, and the measurement that removed it
 *
 * *Asserts on process behaviour* was the plan's second arm, drawn from
 * `lifetime.test.mjs`'s 71 process-shaped references against 0 write-shaped.
 * **It has no population in this gate's scope.** `lifetime.test.mjs` and
 * `port.test.mjs` are node:test files at `test/*.test.mjs`; they launch no
 * Chromium, and the gate's population is the files that drive a page.
 *
 * Inside the browser suite the process-shaped signals do not separate, measured
 * 2026-08-31:
 *
 * - `pid` appears in 11 files and is FLEET PAYLOAD DATA in every one
 *   (`pid: '', previousPid: ''` in a row fixture; `note: 'worker running (pid
 *   12345)'` in an assertion).
 * - `.kill('SIGTERM')` appears in exactly the two hand-spawners, in `afterAll`.
 *   It is TEARDOWN — every board-starting file does it — so a predicate on it
 *   would entitle the whole population the gate exists to gate.
 *
 * A third arm goes in when a file needs it and the signal separates, which is
 * the standard these two were held to. Writing one now would mean a predicate
 * with no file behind it, and calling the absence of a counter-example proof.
 *
 * ## The third arm, added 2026-09-01 by that standard
 *
 * `tiny-garden.browser.test.ts` needed it and the signal separated. Twelve of
 * its thirteen tests migrated onto a served state; the thirteenth opens the plan
 * page in a NEW TAB and asserts the server's own chrome — a `plan-back` titlebar
 * pointing at `/` which then navigates back to a working board. The board
 * assembles that page in `renderPlanPage`, whose `embed` option IS the
 * distinction being asserted: the modal fetches with the parameter and must get
 * no titlebar, the tab fetches without and must get one. A mock serves whatever
 * document it was handed, so it can fail neither direction; the board is what
 * decides, so the board is what runs.
 *
 * **The signal is both halves, because neither separates alone.** Measured
 * across all 48 browser files: `waitForEvent('page')` also appears in a
 * meta-click test that opens a tab to prove a modal did NOT open and asserts
 * nothing about its contents, and reading an `h1` is what every embedded
 * document test does. Requiring the popup AND the page shell matches 1 file.
 *
 * A note for whoever writes the fourth: this arm was nearly `a rendered
 * document`, keyed on `srcdoc`, on the reasoning that `renderPlanPage` takes a
 * `repoRoot`. A document is a `fetch` — `DocModal` requests `<href>?embed=1`
 * and injects the body — so the mock can answer it, and `story-overlay` asserts
 * `srcdoc` while starting no board. That predicate would have licensed a spawn
 * nothing requires, which is worse than no arm at all.
 */
export const assertsServerPageAssembly = (code: string): boolean =>
  /waitForEvent\(\s*['"]page['"]\s*\)/.test(code)
  && /plan-titlebar|plan-back/.test(code);

export interface Entitlement {
  /** Named in the failure message, so a refusal says what would satisfy it. */
  readonly name: string;
  /** Holds where the STRUCTURE of `code` supports a claim on a real board. */
  readonly holds: (code: string) => boolean;
}

export const ENTITLEMENTS: readonly Entitlement[] = [
  {
    name: 'a write reaches a script — an endpoint referenced and never intercepted',
    holds: (code) => {
      const intercepted = endpointsIntercepted(code);
      return writesReferenced(code).some((ep) => !intercepted.has(ep));
    },
  },
  {
    name: 'a real transport it can abandon — a route accepted and never answered',
    holds: (code) =>
      routeHandlers(code).some(
        (handler) =>
          handler.includes('=>')
          && !/\b(fulfill|abort|continue|fallback)\s*\(/.test(handler),
      ),
  },
  {
    name: "the server's own page assembly — a popup opened AND its page shell read",
    holds: assertsServerPageAssembly,
  },
];

/**
 * Which entitlements this source holds, by name — from RAW source.
 *
 * **It strips first, and that is a correctness requirement rather than a
 * convenience.** Measured 2026-08-31 while writing this module:
 * `approved-plan-offers.browser.test.ts` mentions `/api/dispatch` in exactly one
 * place, a docblock listing the buttons the file is about. Judged on raw text it
 * read as *a write reaching a script* and earned an entitlement it does not
 * deserve — the file `page.route`s every write it actually performs.
 *
 * So an entitlement is a claim about USES, and a use inside a comment is prose.
 * The sibling gate in `test/unit` records the consequence of getting this
 * backwards: a gate that fires on prose pushes the next author to delete an
 * explanation to go green.
 *
 * The stripping lives here rather than at the call sites for the same reason:
 * two callers, and one of them getting it wrong is a false entitlement that
 * PASSES. `declaredReason` is the one predicate that must see raw text, because
 * the declaration is itself a comment.
 */
export const entitlementsHeld = (rawSource: string): string[] => {
  const code = stripComments(rawSource);
  return ENTITLEMENTS.filter((e) => e.holds(code)).map((e) => e.name);
};

/**
 * The gate's verdict on one file, and the ONE place the two failure directions
 * are decided.
 *
 * - `entitled` — declares a reason AND the structure supports it.
 * - `undeclared` — starts a board and declares nothing valid.
 * - `unsupported` — declares, and the structure supports nothing.
 * - `serves-its-own-state` — starts no board, so there is nothing to entitle.
 *
 * Both offending verdicts are returned rather than thrown, because the gate
 * reports every offence in one list: a gate that stops at the first tells an
 * author about one file and hides the rest.
 */
export type Verdict = 'entitled' | 'undeclared' | 'unsupported' | 'serves-its-own-state';

export interface Judgement {
  readonly verdict: Verdict;
  /** The declared reason, where one was declared. */
  readonly reason: string | null;
  /** How this file starts a board, by name; empty where it starts none. */
  readonly starts: readonly string[];
  /** The entitlements the structure supports, by name. */
  readonly entitlements: readonly string[];
}

/**
 * Judge one browser test file from its RAW source.
 *
 * Takes the raw text and strips internally, because the two halves of the
 * decision want opposite things from a comment: the declaration IS a comment and
 * must survive; a `startServer` inside a comment is prose about a use and must
 * not count. Handing this function pre-stripped source would silently lose every
 * declaration, which is the kind of failure that passes.
 */
export const judge = (rawSource: string): Judgement => {
  const code = stripComments(rawSource);
  const reason = declaredReason(rawSource);
  const starts = boardStartsIn(code);
  // Raw, because `entitlementsHeld` strips for itself — see its docblock for
  // the false entitlement that made the stripping its responsibility.
  const entitlements = entitlementsHeld(rawSource);

  if (reason !== null) {
    return {
      verdict: entitlements.length > 0 ? 'entitled' : 'unsupported',
      reason,
      starts,
      entitlements,
    };
  }
  return {
    verdict: starts.length > 0 ? 'undeclared' : 'serves-its-own-state',
    reason: null,
    starts,
    entitlements,
  };
};

/**
 * Does this file drive a browser page?
 *
 * Keyed on the IMPORT and not on the word `chromium`, for two measured reasons.
 *
 * A grep for `chromium` names `test/unit/parallel-project-takes-no-resource.test.ts`,
 * whose only mention of it is the pattern IT greps for — a gate catching a gate.
 * And it MISSES every migrated file, because `openCatalogue()` launches the
 * browser on the test's behalf: 14 of the 44 browser files name Chromium
 * nowhere.
 *
 * Two imports, therefore: `playwright` for a file that drives the browser
 * itself, and `test/catalogue` for one that has the catalogue drive it. The gate
 * file imports neither, so it excludes itself without the `!== SELF` its sibling
 * gate in `test/unit` needs — and the three `tiny-garden.{data,plan,story}`
 * server-route tests fall out of the same predicate rather than out of a second
 * list.
 */
/**
 * ## The fixture problem, and the two things that solve it
 *
 * Measured 2026-08-31, by this gate catching the test that tests it.
 * `test/unit/needs-real-board.test.ts` carries invented sources as template
 * literals, and those sources contain `import { chromium } from 'playwright'`
 * because that IS the shape under test. Read naively, the predicate saw an
 * import, counted a unit test as a browser test, and then reported its
 * fixtures' `startServer` as an offence.
 *
 * An anchor to the start of a line does not fix it: a fixture's import sits at
 * the start of its own line inside the literal. Nothing over raw text tells the
 * two apart without parsing.
 *
 * So the pattern below is deliberately LOOSE about where the import sits — it
 * has to be, because five browser files here wrap their import list across
 * lines, and a line-bounded pattern would drop any of them the moment its
 * formatting changed. The fixtures are excluded by two other means instead:
 *
 * 1. **`stripFixtures`** removes template literals before the predicate runs,
 *    so an invented source is not read as source at all.
 * 2. **`READS_THE_SUITE`** excludes a file that imports this module, because a
 *    file judging other files is a gate rather than a browser test.
 *
 * Both, because either alone fails a plausible next change: a fixture written
 * as a plain single-quoted string would slip past (1), and a gate assembling
 * its fixtures without importing this module would slip past (2). Neither is
 * hypothetical enough to leave to one check.
 */
export const DRIVES_A_PAGE =
  /\bfrom\s+['"`][^'"`]*(?:playwright|\/catalogue(?:\/[^'"`]*)?)['"`]/;

/**
 * Source with STRING LITERALS emptied — an invented source is not source.
 *
 * A gate's fixtures are the shapes it refuses, so they contain every marker it
 * greps for. All three quote forms, because a fixture is written in whichever
 * one is convenient: `needs-real-board.test.ts` carries multi-line sources in
 * backticks and one-line ones in single and double quotes, and stripping only
 * backticks left 4 `chromium` and 4 `startServer` matches behind — measured
 * 2026-08-31, by the sibling gate in `test/unit` reddening on a correct file.
 *
 * **Why emptying every string is sound for these predicates.** They ask *does
 * this file USE the thing?*, and a use is never a string: launching a browser is
 * `chromium.launch()`, starting a board is `startServer(FIXTURE)`, and an import
 * is `import … from '…'` where the marker is in the SPECIFIER. That last one is
 * why the quotes are kept and only their contents dropped — an import of
 * `'playwright'` must still be findable, so `DRIVES_A_PAGE` reads the source
 * before this runs.
 *
 * Non-greedy, and it does not attempt escapes, nesting, or `${}` interpolation.
 * A `\'` inside a single-quoted string ends the match early and leaves a
 * fragment; that is the safe direction — a fragment might carry a marker and
 * cost a false positive, where swallowing to the next quote could hide a real
 * use.
 */
export const stripFixtures = (source: string): string =>
  source
    .replace(/`[\s\S]*?`/g, '``')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""');

/**
 * Does this file READ the suite rather than run against it?
 *
 * A file importing this module is judging other files, so its own text is
 * fixtures and patterns rather than a test's behaviour. Two such files exist
 * (`stubbed-tests-start-no-board.test.ts`, `needs-real-board.test.ts`,
 * `count-survives-a-move.test.ts`) and each would otherwise be counted by
 * whichever predicate its own fixtures happened to satisfy.
 *
 * This is self-exclusion, and it is deliberately keyed on the import rather
 * than on a file name. A gate's population must be derived — the docblock in
 * `stubbed-tests-start-no-board.test.ts` explains at length why a list fails
 * open, and a list of the gate's own files fails the same way the moment a
 * fourth is added.
 */
/**
 * The specifier may span lines — a named-import list of five wraps, and
 * `needs-real-board.test.ts`'s does. So this one is NOT line-bounded, and it
 * does not need to be: no fixture in this suite imports the gate module, and if
 * one ever did it would be a fixture about the gate, which is the same
 * exclusion.
 */
export const READS_THE_SUITE = /\bfrom\s+['"`][^'"`]*needs-real-board\.js['"`]/;

/**
 * A fixture's own text, emptied — but the import specifiers left alone.
 *
 * `DRIVES_A_PAGE` reads a specifier, which IS a quoted string, so the full
 * `stripFixtures` would blind it to every import in the suite. What it needs
 * dropped is the multi-line invented source, which is always a template
 * literal: a fixture short enough to fit in single quotes cannot contain the
 * `import … from '…'` shape, because it would need a nested quote of its own.
 */
const stripTemplateFixtures = (source: string): string => source.replace(/`[\s\S]*?`/g, '``');

/**
 * Is this file part of the browser suite the gate counts and gates?
 *
 * Two conditions, and the stripping here is `stripTemplateFixtures` rather than
 * the full `stripFixtures` — see its note. The stripping is scoped to this
 * predicate ALONE and must not reach the entitlement or stubbing predicates: a
 * real browser test writes `page.route(\`**\/api/board\`, …)` in a template
 * literal, so emptying literals for those would make every such file look like
 * it routes nothing.
 */
export const drivesAPage = (source: string): boolean => {
  const withoutFixtures = stripTemplateFixtures(source);
  return DRIVES_A_PAGE.test(withoutFixtures) && !READS_THE_SUITE.test(withoutFixtures);
};
