import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from 'playwright';
import { openCatalogue, board, card, column, type Catalogue } from '../catalogue/index.js';
import type { PlanSource } from '../../src/contract/schema.js';

/**
 * THE BOARD SAYS WHERE ITS PLANS CAME FROM, and marks the ones the ref has not
 * seen.
 *
 * Driven through a RENDERED PAGE rather than the payload, which is why this file
 * exists beside `plan-source.test.mjs`. A payload assertion proves the server
 * SENT the marker and says nothing about whether anything drew it; only a page
 * settles that, and `Done when` item 9 asks for exactly this.
 *
 * WHERE THE SCHEMA IS ENFORCED, precisely — because the mechanism is easy to
 * state wrongly. This client CASTS the board payload (`as Board`) rather than
 * parsing it, and a cast is erased at runtime: an undeclared field still
 * ARRIVES in the JSON. What a missing `CardSchema` entry breaks is the
 * COMPILE — `card.notPushed` does not exist on the inferred type, and
 * `pnpm run typecheck` fails in CI. So the schema declaration is guarded by
 * tsc, and this file guards the rendering. Both are needed and neither
 * substitutes for the other.
 *
 * The other half is item 14. `readRef` and `readRefAge` sat in the fleet pulse
 * and were rendered NOWHERE, which is precisely why a `2 rounds` badge on the
 * wrong phase and a Deliver button refusing a finished plan were mysteries
 * rather than diagnoses on 2026-08-27: nothing on screen said the plan estate
 * had been read from a commit sixteen behind.
 *
 * ## Two shapes of input, and the reason there are two
 *
 * Seven cases state a `planSource` and get it SERVED BY NAME — `board()` parses
 * through Zod, so a field this file spells wrongly fails at build time rather
 * than rendering blank.
 *
 * The remaining two are about a payload the schema CANNOT PRODUCE: a field that
 * is genuinely absent at runtime. `BoardSchema` defaults `planSource` and
 * `behind`, so anything `board()` returns HAS them — a parsed payload is the
 * opposite of the older server's these two tests are about, and serving one
 * would silently turn *absent* into `{ ref: '', resolved: false }`, whose render
 * is the `unresolved` line rather than the silence the test asserts.
 *
 * So those two layer `page.route` over the served baseline and delete the field
 * from the JSON — the interception-over-baseline pattern
 * `unreachable-overlay.browser.test.ts` demonstrates for a board that cannot
 * answer, applied to a board that answers with LESS than the schema describes.
 * The absence is the subject, so the test states it where a reader can see it.
 */
const CARD_PATH = (slug: string) => `docs/plans/2026-08-27-${slug}.md`;

/** One Development card, built through the catalogue's parsing builder. */
const planCard = (slug: string, over: Parameters<typeof card>[0] = {}) =>
  card({
    slug, title: slug, type: 'bug', phase: 'Development',
    path: CARD_PATH(slug), phaseDate: '2026-08-27', ...over,
  });

describe('the board names the source of its plans', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  /**
   * Open the BOARD tab over a stated `planSource` and a stated set of cards.
   *
   * `an-empty-estate` is the baseline rather than `a-board-of-plans`: every
   * assertion here reads the provenance LINE and the cards this test names, so
   * a scenario supplying five phases of its own cards would add articles the
   * `not pushed` assertions then have to exclude. The override is the whole
   * subject, which is what makes it visible at the call site.
   */
  const open = async (planSource: PlanSource, cards: ReturnType<typeof card>[]): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      over: {
        board: board({
          planSource,
          columns: [column({ phase: 'Development', cards })],
        }),
      },
    });
    // Waits on the HEADER, not on the source line: one case here deliberately
    // has no source line at all, and waiting on it would turn that test's
    // subject into its timeout.
    await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
    return page;
  };

  /**
   * Open the board over a payload with `field` DELETED — an older server's.
   *
   * The route is installed before `goto` and answers a payload built from the
   * same scenario the mock serves, minus one key. Synchronous by design: the
   * board polls on a timer, and an awaited `route.fetch()` can still be in
   * flight when the page closes.
   */
  const openWithout = async (
    field: 'planSource' | 'behind',
    planSource: PlanSource,
    cards: ReturnType<typeof card>[],
  ): Promise<Page> => {
    const built = board({
      planSource,
      columns: [column({ phase: 'Development', cards })],
    });
    const payload = JSON.parse(JSON.stringify(built)) as Record<string, unknown> & {
      planSource?: Record<string, unknown>;
    };
    if (field === 'planSource') delete payload.planSource;
    else delete payload.planSource?.behind;
    const body = JSON.stringify(payload);

    const context = await cat.browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await page.route('**/api/board', (route) =>
      route.fulfill({ contentType: 'application/json', body }));
    // The fleet still comes from the mock, so only the board's shape is stated
    // here — the state under test is one missing field, not a missing server.
    cat.mock.serve('an-empty-estate');
    await page.goto(cat.mock.baseURL);
    await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
    return page;
  };

  const sourceLine = (page: Page) => page.locator('[data-plan-source]').first();

  it('names the ref the plans were read from', async () => {
    // Item 14. The ref reaches the SCREEN — its absence is what made two wrong
    // renders undiagnosable.
    const page = await open(
      { ref: 'origin/main', resolved: true, localOnly: 0, behind: null },
      [planCard('a-plan')],
    );
    try {
      expect(await sourceLine(page).getAttribute('data-plan-source')).toBe('ref');
      expect(await sourceLine(page).textContent()).toContain('origin/main');
    } finally { await page.close(); }
  });

  it('marks a plan the ref has not seen, on the rendered card', async () => {
    // ITEM 9. The marker has to reach a CARD, not merely the payload — a
    // server field nothing draws is indistinguishable from no feature. The
    // `CardSchema` declaration it depends on is enforced separately, by tsc
    // (see the header).
    const page = await open(
      { ref: 'origin/main', resolved: true, localOnly: 1, behind: null },
      [planCard('written-here', { notPushed: true }), planCard('on-the-ref')],
    );
    try {
      const local = page.locator('article', { hasText: 'written-here' }).first();
      await expect.poll(() => local.count(), { timeout: 10_000 }).toBe(1);
      expect(await local.textContent()).toContain('not pushed');
      // AND THE OTHER HALF, in the same breath: a plan the ref carries must NOT
      // be marked. Without this a change that marked every card would pass the
      // assertion above and make the label meaningless.
      const shared = page.locator('article', { hasText: 'on-the-ref' }).first();
      expect(await shared.textContent()).not.toContain('not pushed');
      expect(await sourceLine(page).textContent()).toContain('1 not pushed');
    } finally { await page.close(); }
  });

  it('marks nothing where every plan is on the ref', async () => {
    // ITEM 13, the dedicated-deployment case — measured at zero local-only
    // plans in the board's own checkout, because nobody authors there.
    //
    // THE MARKER IS EXPECTED TO LOOK UNUSED THERE, and this pins the silence so
    // a later change cannot start marking every card. The feature serves an
    // AUTHORING checkout, where `pnpm board` is also legitimately run; both are
    // real deployments, which is why the absence is asserted rather than
    // assumed.
    const page = await open(
      { ref: 'origin/main', resolved: true, localOnly: 0, behind: null },
      [planCard('one'), planCard('two'), planCard('three')],
    );
    try {
      const board = page.locator('main');
      expect(await board.textContent()).not.toContain('not pushed');
    } finally { await page.close(); }
  });

  it('renders the rest of the board when the payload has no planSource at all', async () => {
    // AN OLDER SERVER'S PAYLOAD, and the reason this test exists is that the
    // absence is REAL at runtime rather than merely typed.
    //
    // `BoardSchema` gives `planSource` a default, and that default never runs:
    // the client casts the payload instead of parsing it, so the property is
    // genuinely `undefined` here. A component that dereferenced it took the
    // WHOLE PAGE down — header, columns and all — and it did, on four existing
    // browser tests whose hand-written payloads predate this field.
    //
    // The failure is silent in the worst way: not a missing line, a blank page.
    //
    // SERVED WITH THE KEY DELETED rather than built by the catalogue, because a
    // parsed payload always HAS the field — see the header. This is the one
    // input `board()` cannot express, so the test states it directly.
    const page = await openWithout(
      'planSource',
      { ref: 'origin/main', resolved: true, localOnly: 0, behind: null },
      [planCard('a-plan')],
    );
    try {
      // The header is proof the app mounted rather than crashed on render.
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
      const board = page.locator('main');
      expect(await board.textContent()).toContain('a-plan');
      // And no provenance line, because the payload stated no provenance. The
      // honest answer is silence, never a claim nobody made.
      expect(await page.locator('[data-plan-source]').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('says so where the ref could not be resolved', async () => {
    // Item 10's render half. A repo with no remote is a legitimate deployment,
    // so the line REPORTS rather than alarms — and it must never let the
    // checkout quietly wear the ref's authority, which is the substitution the
    // whole plan forbids.
    const page = await open(
      { ref: 'origin/main', resolved: false, localOnly: 2, behind: null },
      [planCard('orphan', { notPushed: true })],
    );
    try {
      expect(await sourceLine(page).getAttribute('data-plan-source')).toBe('unresolved');
      const text = await sourceLine(page).textContent();
      expect(text).toContain('origin/main');
      expect(text).toMatch(/could not be read/i);
    } finally { await page.close(); }
  });

  it('says how far behind the checkout is, with the number', async () => {
    // ITEM 1's RENDER HALF. The count has to reach the SCREEN — a payload field
    // nothing draws is indistinguishable from no feature, and invisibility is
    // this whole wave's subject: the drift was 16 commits and the hour it cost
    // was spent because nothing said so.
    const page = await open(
      { ref: 'origin/main', resolved: true, localOnly: 0, behind: 16 },
      [planCard('a-plan')],
    );
    try {
      const text = await sourceLine(page).textContent();
      expect(text).toContain('16 behind');
      // The ref stays named beside it: the distance annotates the provenance,
      // it does not replace it.
      expect(text).toContain('origin/main');
    } finally { await page.close(); }
  });

  it('says nothing at all about a checkout level with the ref', async () => {
    // ITEM 2, and it is an ASSERTION OF SILENCE rather than an omission.
    //
    // A current checkout is the normal state, so a permanent indicator here
    // would be green on nearly every board — and an indicator that is almost
    // always green teaches a reader to stop reading it, which is precisely how
    // the next 16-commit drift goes unnoticed. The signal must be the
    // exception. Same rule the `not pushed` count already follows at zero.
    const page = await open(
      { ref: 'origin/main', resolved: true, localOnly: 0, behind: 0 },
      [planCard('a-plan')],
    );
    try {
      const board = page.locator('main');
      expect(await board.textContent()).not.toContain('behind');
      // The provenance line itself must survive: silence about the distance is
      // not silence about the source.
      expect(await sourceLine(page).textContent()).toContain('origin/main');
    } finally { await page.close(); }
  });

  it('says nothing where the distance cannot be measured', async () => {
    // ITEM 3's render half. `null` is *cannot say* — a detached HEAD, whose
    // `rev-list HEAD..origin/main` answers 0 while having no upstream at all.
    //
    // It renders as silence rather than as a claim, and the sharp point is what
    // it must NOT render: `0 behind`, or any word suggesting the checkout is
    // current. Absent is not false. A renderer coercing null with `?? 0` would
    // turn the least knowable state into the most reassuring one, and this is
    // the assertion that catches it.
    const page = await open(
      { ref: 'origin/main', resolved: true, localOnly: 0, behind: null },
      [planCard('a-plan')],
    );
    try {
      const board = page.locator('main');
      expect(await board.textContent()).not.toContain('behind');
      expect(await page.locator('[data-checkout-behind]').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('renders the board when the payload states no distance at all', async () => {
    // An older server's payload, the runtime-absence case this file already
    // guards for `planSource` itself. The client CASTS rather than parses, so
    // the schema default never runs and `behind` is genuinely `undefined` —
    // which is neither a number nor null. It must read as *cannot say* too,
    // and above all must not take the page down.
    //
    // The key is DELETED from the served payload for the same reason as the
    // `planSource` case above: `board()` parses, and a parsed `behind` is
    // `null` rather than missing. Those render alike and mean different things,
    // and this test is about the one the schema cannot emit.
    const page = await openWithout(
      'behind',
      { ref: 'origin/main', resolved: true, localOnly: 0, behind: null },
      [planCard('a-plan')],
    );
    try {
      expect(await sourceLine(page).textContent()).toContain('origin/main');
      expect(await page.locator('[data-checkout-behind]').count()).toBe(0);
    } finally { await page.close(); }
  });
});
