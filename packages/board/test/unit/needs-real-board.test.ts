import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  declaredReason,
  drivesAPage,
  entitlementsHeld,
  judge,
  startsABoard,
} from '../gate/needs-real-board.js';

/**
 * BOTH FAILURE DIRECTIONS, WHICH IS WHY THE PREDICATE IS A MODULE.
 *
 * `2026-08-31-a-browser-test-serves-its-own-state.md`, the Deciding slice, and
 * its brief is explicit about why one test is not enough:
 *
 * > A file that starts a board with no marker must fail. A file that declares
 * > the marker while matching neither structural arm must ALSO fail — without
 * > that second test the verification arm is unproven, and you would have
 * > shipped a gate that can only ever check the comment.
 *
 * The second direction cannot be proved from the live suite. Demonstrating it
 * there needs a file someone wrote, marked, and left structurally unentitled —
 * a red test checked in on purpose. So the decision is a function of source
 * TEXT, and this file hands it invented sources.
 *
 * The sources below are the SHAPES, not the files. Each is the smallest thing
 * that carries the property under test, which is the point: a fixture that
 * copied a real test would prove the gate works on that test and leave the
 * predicate's edges unvisited.
 */

/** A file that serves its own state: both payloads stubbed, no server. */
const SERVES_ITS_OWN_STATE = `
import { openCatalogue } from '../catalogue/index.js';
const cat = await openCatalogue();
await page.route('**/api/board', (route) => route.fulfill({ json: board() }));
await page.route('**/api/fleet', (route) => route.fulfill({ json: fleet() }));
`;

/** The same file, with a server bolted back on and nothing said about it. */
const STARTS_A_BOARD_UNDECLARED = `
import { chromium } from 'playwright';
import { startServer } from '../helpers.mjs';
const server = await startServer(FIXTURE);
await page.route('**/api/board', (route) => route.fulfill({ json: board() }));
await page.route('**/api/fleet', (route) => route.fulfill({ json: fleet() }));
`;

/**
 * THE FILE THE BRIEF SAYS MUST FAIL: a declaration with nothing behind it.
 *
 * It starts a board, it says why in prose a reader would accept, and its
 * structure supports neither arm — every write it touches is intercepted, and
 * every route it registers answers. This is the shape a bare marker would have
 * waved through, one line at a time.
 */
const DECLARES_WITHOUT_SUPPORT = `
import { chromium } from 'playwright';
import { startServer } from '../helpers.mjs';
// @needs-real-board: the real board is easier than building a fixture
const server = await startServer(FIXTURE);
await page.route('**/api/dispatch', (route) => route.fulfill({ json: { ok: true } }));
await page.route('**/api/board', (route) => route.fulfill({ json: board() }));
`;

/** `approve.browser.test.ts`'s shape: a POST that reaches the configured script. */
const WRITE_REACHES_A_SCRIPT = `
import { chromium } from 'playwright';
import { startServer } from '../helpers.mjs';
// @needs-real-board: the POST runs the configured Approve command and the card shows its sentence
const server = await startServer(tempCopyOf(FIXTURE));
await page.getByRole('button', { name: 'Approve' }).click();
expect(new URL(posts[0]).pathname).toBe('/api/approve');
`;

/**
 * `stuck-rows`'s and `double-click`'s shape: a board bound to the network.
 *
 * The Closing slice's arm. Both files migrated their whole body onto the
 * catalogue and kept ONE server, because the subject is what the board refuses
 * when `sitting at this machine` stops being true. A mock has no binding.
 */
const BINDS_NON_LOCALHOST = `
import { chromium } from 'playwright';
import { startServer } from '../helpers.mjs';
// @needs-real-board: one test asserts what the board refuses over a non-localhost binding
const cat = await openCatalogue();
const tailscale = await startServer(FIXTURE, { HOST: '0.0.0.0' });
await page.route('**/api/fleet', (route) => route.fulfill({ json: fleet() }));
`;

/** The same shape with a LOCALHOST binding — a default said out loud earns nothing. */
const BINDS_LOCALHOST = `
import { chromium } from 'playwright';
import { startServer } from '../helpers.mjs';
// @needs-real-board: it is easier to start the real thing
const server = await startServer(FIXTURE, { HOST: '127.0.0.1' });
await page.route('**/api/board', (route) => route.fulfill({ json: board() }));
`;

/** `tiny-garden`'s shape: the page the SERVER assembles, opened in a new tab. */
const ASSERTS_PAGE_ASSEMBLY = `
import { chromium } from 'playwright';
import { startServer } from '../helpers.mjs';
// @needs-real-board: one test asserts the plan-back titlebar renderPlanPage adds only when embed is false
const server = await startServer(FIXTURE);
const [popup] = await Promise.all([
  page.context().waitForEvent('page'),
  page.getByRole('link', { name: 'Open in new tab' }).click(),
]);
const back = popup.locator('a.plan-back');
expect(await back.getAttribute('href')).toBe('/');
`;

/**
 * A SERVED document, asserted through `srcdoc` — and it must NOT entitle.
 *
 * `story-overlay.browser.test.ts`'s shape after `serveDoc`: it asserts the
 * attribute the modal fills from a fetched document, and starts no board. This
 * arm was first keyed on `srcdoc` for exactly the assertion below, on the
 * reasoning that `renderPlanPage` takes a `repoRoot`. A document is a `fetch`,
 * so the mock can answer it — and keying on the attribute would license a spawn
 * this file demonstrably does not need.
 */
const SERVES_A_DOCUMENT = `
import { openCatalogue } from '../catalogue/index.js';
const cat = await openCatalogue();
cat.mock.serveDoc('/story/berry-patch', '<h1>Pick the berry patch</h1>');
const iframe = page.locator('iframe');
await expect.poll(async () => ((await iframe.getAttribute('srcdoc')) ?? '').includes('berry-patch')).toBe(true);
`;

/**
 * A file that opens a POPUP and asserts nothing about its page shell.
 *
 * `tiny-garden`'s meta-click test: the tab exists to prove the modal did NOT
 * open. `waitForEvent('page')` alone therefore cannot be the signal.
 */
const OPENS_A_POPUP_ONLY = `
import { openCatalogue } from '../catalogue/index.js';
const [popup] = await Promise.all([
  page.context().waitForEvent('page'),
  page.getByRole('link', { name: 'Open' }).click({ modifiers: ['Meta'] }),
]);
expect(await page.getByRole('dialog').count()).toBe(0);
await popup.close();
`;

/**
 * A file that NAMES a document route and asserts only its href.
 *
 * `agents-tab.browser.test.ts`'s shape, and the measurement that keyed the arm
 * on the rendered content rather than on the path: it clicks through to a 404
 * on purpose, because the claim is the honest fallback for a plan with no card.
 */
const NAMES_A_DOCUMENT_ROUTE = `
import { openCatalogue } from '../catalogue/index.js';
// @needs-real-board: it links to a plan document
const link = page.getByRole('link', { name: 'ghost-plan' }).first();
expect(await link.getAttribute('href')).toBe('/plan/2099-01-01-ghost-plan.md');
await expect.poll(() => page.url()).toContain('/plan/2099-01-01-ghost-plan.md');
`;

/** `dead-fetch.browser.test.ts`'s shape: a route accepted and never answered. */
const ABANDONS_A_TRANSPORT = `
import { chromium } from 'playwright';
import { startServer } from '../helpers.mjs';
// @needs-real-board: reproduces a socket accepted and then abandoned, which route.abort cannot
const server = await startServer(FIXTURE);
await page.route(PLAN_DOC, () => {
  /* deliberately never fulfilled: this IS the defect's condition */
});
await expect(dialog.getByText('could not load')).toBeVisible();
`;

/** `tiny-garden`'s shape: the page the SERVER assembles, opened in a new tab. */
const ASSERTS_PAGE_ASSEMBLY = `
import { chromium } from 'playwright';
import { startServer } from '../helpers.mjs';
// @needs-real-board: one test asserts the plan-back titlebar renderPlanPage adds only when embed is false
const server = await startServer(FIXTURE);
const [popup] = await Promise.all([
  page.context().waitForEvent('page'),
  page.getByRole('link', { name: 'Open in new tab' }).click(),
]);
const back = popup.locator('a.plan-back');
expect(await back.getAttribute('href')).toBe('/');
`;

/**
 * A SERVED document, asserted through `srcdoc` — and it must NOT entitle.
 *
 * This arm was nearly keyed on `srcdoc`, on the reasoning that `renderPlanPage`
 * takes a `repoRoot`. A document is a `fetch`, so the mock can answer it, and
 * `story-overlay.browser.test.ts` asserts the attribute while starting no board.
 * Keying on it would license a spawn that file demonstrably does not need.
 */
const SERVES_A_DOCUMENT = `
import { openCatalogue } from '../catalogue/index.js';
const cat = await openCatalogue();
cat.mock.serveDoc('/story/berry-patch', '<h1>Pick the berry patch</h1>');
const iframe = page.locator('iframe');
await expect.poll(async () => ((await iframe.getAttribute('srcdoc')) ?? '').includes('berry-patch')).toBe(true);
`;

/**
 * A file that opens a POPUP and asserts nothing about its page shell.
 *
 * `tiny-garden`'s meta-click test: the tab exists to prove the modal did NOT
 * open. `waitForEvent('page')` alone therefore cannot be the signal.
 */
const OPENS_A_POPUP_ONLY = `
import { openCatalogue } from '../catalogue/index.js';
const [popup] = await Promise.all([
  page.context().waitForEvent('page'),
  page.getByRole('link', { name: 'Open' }).click({ modifiers: ['Meta'] }),
]);
expect(await page.getByRole('dialog').count()).toBe(0);
await popup.close();
`;

describe('the marker declares and the structure verifies', () => {
  describe('a board-starting file without a valid declaration fails', () => {
    it('refuses a start with no marker at all', () => {
      const j = judge(STARTS_A_BOARD_UNDECLARED);
      expect(j.verdict).toBe('undeclared');
      expect(j.reason).toBeNull();
      expect(j.starts).toContain('calls startServer');
    });

    it('refuses a marker with no reason after it', () => {
      // A bare `@needs-real-board` declares nothing a reader can act on, so it
      // reads as no declaration — which is what makes the file an offence
      // rather than an exception. The colon-and-reason is load-bearing.
      const bare = STARTS_A_BOARD_UNDECLARED.replace(
        'import { chromium }',
        '// @needs-real-board\nimport { chromium }',
      );
      expect(declaredReason(bare)).toBeNull();
      expect(judge(bare).verdict).toBe('undeclared');
    });

    it('names every spelling of starting a board, not just the helper', () => {
      // The measured failure mode is "reused the real server, pointed at a
      // fixture", which a check for `startServer` alone passes: three files in
      // test/integration spawn the artifact by hand.
      expect(startsABoard('const s = spawn("node", [ARTIFACT]);')).toBe(true);
      expect(startsABoard('const A = "skills/plot/scripts/board/board-server.mjs";')).toBe(true);
      expect(startsABoard('await startServer(FIXTURE);')).toBe(true);
    });

    it('says nothing about a file that starts no board', () => {
      const j = judge(SERVES_ITS_OWN_STATE);
      expect(j.verdict).toBe('serves-its-own-state');
      expect(j.starts).toEqual([]);
    });
  });

  describe('a declaration the structure does not support ALSO fails', () => {
    it('refuses the marker when neither arm holds', () => {
      const j = judge(DECLARES_WITHOUT_SUPPORT);
      expect(j.verdict).toBe('unsupported');
      // The reason is READ and carried, so the failure can quote the claim it
      // is refusing rather than only the file name.
      expect(j.reason).toBe('the real board is easier than building a fixture');
      expect(j.entitlements).toEqual([]);
    });

    it('is not satisfied by touching a write endpoint the file intercepts', () => {
      // The Survey's correction, and the reason the arm says UN-intercepted:
      // five files page.route every write they touch, so the write never leaves
      // the browser. Entitling on the mention would exempt all five.
      expect(entitlementsHeld(DECLARES_WITHOUT_SUPPORT)).toEqual([]);
    });
  });

  describe('the three arms that do hold, each with a file behind it', () => {
    it('entitles a write that reaches a script', () => {
      const j = judge(WRITE_REACHES_A_SCRIPT);
      expect(j.verdict).toBe('entitled');
      expect(j.entitlements).toContain(
        'a write reaches a script — an endpoint referenced and never intercepted',
      );
    });

    it('entitles a transport it can abandon', () => {
      const j = judge(ABANDONS_A_TRANSPORT);
      expect(j.verdict).toBe('entitled');
      expect(j.entitlements).toContain(
        'a real transport it can abandon — a route accepted and never answered',
      );
    });

    it('entitles a board bound to a network interface', () => {
      const j = judge(BINDS_NON_LOCALHOST);
      expect(j.verdict).toBe('entitled');
      expect(j.entitlements).toContain(
        'a non-localhost binding — a board reachable from the network, which no mock has',
      );
    });

    it('does not entitle a board that binds localhost out loud', () => {
      // The default, written down. It is what every other board-starting file
      // does implicitly, so entitling it would entitle the whole population.
      expect(judge(BINDS_LOCALHOST).verdict).toBe('unsupported');
    });

    it("entitles a file that asserts the server's own page assembly", () => {
      const j = judge(ASSERTS_PAGE_ASSEMBLY);
      expect(j.verdict).toBe('entitled');
      expect(j.entitlements).toContain(
        "the server's own page assembly — a popup opened AND its page shell read",
      );
    });

    it('does not entitle a file that asserts a SERVED document', () => {
      // What this arm was nearly keyed on. `serveDoc` answers the fetch, so the
      // file needs no board — and an entitlement that licenses an unnecessary
      // spawn is worse than none.
      expect(entitlementsHeld(SERVES_A_DOCUMENT)).toEqual([]);
    });

    it('does not entitle a popup nobody reads the page shell of', () => {
      // Both halves of the signal are required because this half is common: a
      // meta-click test opens a tab to prove a modal did NOT open.
      expect(entitlementsHeld(OPENS_A_POPUP_ONLY)).toEqual([]);
    });

      // The meta-click test opens a tab to prove a modal did NOT open. Both
      // halves of the signal are required because this half is common.
      expect(entitlementsHeld(OPENS_A_POPUP_ONLY)).toEqual([]);
    });

    it('does not entitle a file that only links to a document route', () => {
      // The click lands on a 404 and that IS the assertion, so nothing renders
      // and nothing needs a repo on disk.
      expect(judge(NAMES_A_DOCUMENT_ROUTE).verdict).toBe('unsupported');
    });

    it('does not read an answering route as an abandoned one', () => {
      // Every migrated file registers routes that fulfil. If a handler which
      // ANSWERS counted, the second arm would entitle the whole suite and the
      // gate would refuse nothing.
      expect(entitlementsHeld(SERVES_ITS_OWN_STATE)).toEqual([]);
    });
  });

  describe('the declaration survives comment stripping and a use does not', () => {
    it('reads the marker, which is itself a comment', () => {
      expect(declaredReason('// @needs-real-board: because\n')).toBe('because');
    });

    it('does not entitle a write endpoint that only appears in prose', () => {
      // MEASURED 2026-08-31, and the reason `entitlementsHeld` strips for
      // itself. `approved-plan-offers.browser.test.ts` names `/api/dispatch` in
      // exactly one place — a docblock listing the buttons it tests — while
      // page.routing every write it actually performs. Judged on raw text it
      // earned an entitlement it does not deserve, and the gate would have
      // handed it an exception for a sentence.
      const prose = `
// The Implement button posts to /api/dispatch, which wave 2 gave it.
import { chromium } from 'playwright';
import { startServer } from '../helpers.mjs';
// @needs-real-board: nothing here reaches a script
const server = await startServer(FIXTURE);
await page.route('**/api/implement', (route) => route.fulfill({ json: {} }));
`;
      expect(entitlementsHeld(prose)).toEqual([]);
      expect(judge(prose).verdict).toBe('unsupported');
    });

    it('ignores a start that only appears in prose', () => {
      // The sibling gate's rule, for its reason: a gate that fired on prose
      // pushes the next author to delete an explanation to go green.
      expect(startsABoard('')).toBe(false);
      expect(judge('// this test used to call startServer(FIXTURE)\n').verdict)
        .toBe('serves-its-own-state');
    });
  });

  /**
   * The predicate is applied to the real suite by the gate, and these two
   * assertions are the join: the shapes above are invented, and a shape nothing
   * matches is a predicate tuned to a fiction.
   */
  describe('the arms have a population in the real suite', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const INTEGRATION = path.resolve(here, '../integration');
    const sourceOf = (f: string) => fs.readFileSync(path.join(INTEGRATION, f), 'utf8');

    it('finds the write-reaches-a-script file, and only that one', () => {
      // approve.browser.test.ts, per the Survey's table: the one file in the
      // suite where a POST leaves the browser and lands in `Approve command`.
      const holders = fs
        .readdirSync(INTEGRATION)
        .filter((f) => f.endsWith('.test.ts'))
        .filter((f) =>
          entitlementsHeld(sourceOf(f)).includes(
            'a write reaches a script — an endpoint referenced and never intercepted',
          ));
      expect(holders).toEqual(['approve.browser.test.ts']);
    });

    it('finds the abandoned-transport file', () => {
      const holders = fs
        .readdirSync(INTEGRATION)
        .filter((f) => f.endsWith('.test.ts'))
        .filter((f) =>
          entitlementsHeld(sourceOf(f)).includes(
            'a real transport it can abandon — a route accepted and never answered',
          ));
      expect(holders).toContain('dead-fetch.browser.test.ts');
    });

    /**
     * The two arms the Closing slice added, each held against its measured
     * population. Both lists are exact rather than `toContain`, because both
     * arms were written from four files and an arm that quietly widened to a
     * fifth is the failure the entitlement mechanism exists to prevent.
     */
    it('finds exactly the two files that bind to the network', () => {
      const holders = fs
        .readdirSync(INTEGRATION)
        .filter((f) => f.endsWith('.test.ts'))
        .filter((f) =>
          entitlementsHeld(sourceOf(f)).includes(
            'a non-localhost binding — a board reachable from the network, which no mock has',
          ));
      // `approve` binds 0.0.0.0 too, and holds the write arm as well — an
      // entitlement is a property, so a file may hold more than one.
      expect(holders.sort()).toEqual([
        'approve.browser.test.ts',
        'double-click.browser.test.ts',
        'stuck-rows.browser.test.ts',
      ]);
    });

    it("finds exactly the one file that asserts the server's page assembly", () => {
      // ONE, which is what "the signal separates" means for this arm. It was two
      // when the arm was `a rendered document`; `serveDoc` retired the other.
      const holders = fs
        .readdirSync(INTEGRATION)
        .filter((f) => f.endsWith('.test.ts'))
        .filter((f) =>
          entitlementsHeld(sourceOf(f)).includes(
            "the server's own page assembly — a popup opened AND its page shell read",
          ));
      expect(holders.sort()).toEqual(['tiny-garden.browser.test.ts']);
    });
  });

  /**
   * `drivesAPage` is the population predicate, and its two measured edges are
   * the reason it keys on the import rather than on the word `chromium`.
   */
  describe('the population is the files that drive a page', () => {
    it('counts a file whose browser the catalogue launches', () => {
      // 14 of the 44 browser files name Chromium nowhere: openCatalogue() does
      // it for them. A grep for the word would miss every migrated file.
      expect(drivesAPage("import { openCatalogue } from '../catalogue/index.js';")).toBe(true);
    });

    it('counts a file that drives the browser itself', () => {
      expect(drivesAPage("import { chromium } from 'playwright';")).toBe(true);
    });

    it('does not count a gate that merely greps for the word', () => {
      // test/unit/parallel-project-takes-no-resource.test.ts's only mention of
      // chromium is the pattern IT greps for — a gate catching a gate.
      expect(drivesAPage('const offenders = sources.filter((s) => /chromium/i.test(s.code));'))
        .toBe(false);
    });

    it('does not count a server-route test that spawns the artifact', () => {
      // tiny-garden.{data,plan,story}: they speak HTTP to the real server, so
      // "serve your own state" is not a thing they could do.
      expect(drivesAPage("import { startServer, fetchBoard } from '../helpers.mjs';"))
        .toBe(false);
    });
  });
});
