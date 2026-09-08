import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import {
  openCatalogue, board as buildBoard, card as buildCard, column, type Catalogue,
} from '../catalogue/index.js';

/**
 * `none` AND `unknown` MUST NOT RENDER THE SAME — the one claim about two
 * rendered rows, which is the one thing the unit test cannot make.
 *
 * `packages/domain/test/checks-reading.test.ts` asserts the whole mapping: the
 * label, the sentence, the prominence and the show/hide, for all five states
 * against all three mergeabilities, without a browser. So this file does NOT
 * re-assert the mapping. It asserts the only thing left: that the two states a
 * reader could not tell apart before actually reach the screen as different
 * things.
 *
 * The defect it keeps shut, measured 2026-09-07: `CardPrSchema` carried
 * `number` and `url` alone, so a PR with no CI and a PR whose CI could not be
 * reached both rendered as a bare `#57`. On a Jenkins team, where the board
 * reaches `gh` alone, that is EVERY pull request — a fleet running CI every
 * hour showing a board that says it runs none.
 *
 * A REIMPLEMENTATION THAT CARRIES THE FIELD AND RENDERS ONE WORD FOR BOTH
 * PASSES EVERY OTHER TEST IN THIS REPOSITORY. That is what the second
 * assertion below is for.
 */

/** Four PRs, one per case the board must keep apart. */
const CARDS = [
  {
    slug: 'green-checks',
    // Nothing outstanding — and therefore NO annotation at all. A check that
    // passed is not a finding, the rule `checksShown` owns.
    prs: [{ number: 57, url: 'https://example.invalid/pull/57', checks: 'green' as const, mergeable: 'mergeable' as const }],
  },
  {
    slug: 'no-checks',
    // A fact about the repository: no workflow is configured, and the host was
    // able to say so.
    prs: [{ number: 58, url: 'https://example.invalid/pull/58', checks: 'none' as const, mergeable: 'mergeable' as const }],
  },
  {
    slug: 'not-asked',
    // A question about the board's own reach. NOT the same fact as the one
    // above, and the whole plan is that a reader can see the difference.
    prs: [{ number: 59, url: 'https://example.invalid/pull/59', checks: 'unknown' as const, mergeable: 'unknown' as const }],
  },
  {
    slug: 'no-checks-conflicting',
    // The same empty rollup as `no-checks`, with the reading that explains it.
    // GitHub started no run because the branch does not merge, so this is a
    // symptom rather than a fact — and it warns where the other is quiet.
    prs: [{ number: 60, url: 'https://example.invalid/pull/60', checks: 'none' as const, mergeable: 'conflicting' as const }],
  },
];

describe('a PR says what the board could not ask', () => {
  let cat: Catalogue;

  const boardWithCards = buildBoard({
    columns: [column({
      phase: 'Development',
      cards: CARDS.map((c) => buildCard({
        slug: c.slug, title: c.slug, type: 'bug', phase: 'Development',
        path: `docs/plans/2026-09-07-${c.slug}.md`, prs: c.prs, phaseDate: '2026-09-07',
      })),
    })],
  });

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  // THE PAYLOAD IS REPLACED, NOT STUBBED AT THE NETWORK BOUNDARY. `over`
  // makes the state simply what the server answers, so nothing races the
  // client's poll — the trap a `page.route` after navigation walks into.
  const open = (): Promise<Page> =>
    cat.open('an-empty-estate', {
      over: { board: boardWithCards },
      tab: 'board',
      viewport: { width: 1400, height: 1400 },
    });

  // `id="plan-<slug>"` is the card's own anchor — what `?plan=<slug>` scrolls
  // to — so the test keys on an attribute the page already needs rather than
  // one added for it.
  const note = (page: Page, slug: string) =>
    page.locator(`#plan-${slug} [data-pr-checks]`);

  it('says nothing at all about a PR whose checks are green', async () => {
    const page = await open();
    try {
      await expect.poll(() => page.locator('[data-pr-checks]').count(), { timeout: 10_000 })
        .toBeGreaterThan(0);
      // Silent when the news is good. A badge on every PR is a badge nobody
      // reads, which is the same outcome as not rendering it.
      expect(await note(page, 'green-checks').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('RENDERS `none` AND `unknown` DIFFERENTLY — the whole plan', async () => {
    const page = await open();
    try {
      await expect.poll(() => note(page, 'not-asked').count(), { timeout: 10_000 }).toBe(1);
      expect(await note(page, 'no-checks').count()).toBe(1);

      const noneText = (await note(page, 'no-checks').textContent())?.trim();
      const unknownText = (await note(page, 'not-asked').textContent())?.trim();

      // Both are SAID — an absent annotation would make them identical again by
      // the other route.
      expect(noneText).toBeTruthy();
      expect(unknownText).toBeTruthy();
      // And they are DIFFERENT. This is the assertion a version that carries
      // the field and renders one word for both would fail, and the only one
      // here that needs a rendered page to make.
      expect(noneText).not.toBe(unknownText);

      // The states travel as data, so a later reader can key on them without
      // parsing the sentence back apart.
      expect(await note(page, 'no-checks').getAttribute('data-pr-checks-state')).toBe('none');
      expect(await note(page, 'not-asked').getAttribute('data-pr-checks-state')).toBe('unknown');
    } finally { await page.close(); }
  });

  it('does not raise an alarm about its own inability to ask', async () => {
    const page = await open();
    try {
      await expect.poll(() => note(page, 'not-asked').count(), { timeout: 10_000 }).toBe(1);
      // `note`, never `warn`. A board that could not ask must render neither an
      // alarm nobody can act on nor an all-clear it cannot stand behind — the
      // supervisor badge's rule, applied to the capability a team reads most.
      expect(await note(page, 'not-asked').getAttribute('data-pr-checks-prominence')).toBe('note');
      // While a failing-adjacent state on the same board still does warn, so
      // the quiet above is a decision rather than the styling being absent.
      expect(await note(page, 'no-checks-conflicting').getAttribute('data-pr-checks-prominence'))
        .toBe('warn');
    } finally { await page.close(); }
  });

  it('says the connector could not be asked ONCE, not once per row', async () => {
    // Every PR unknown — a Jenkins team, where `runs()` reaches `gh` alone.
    const allUnknown = buildBoard({
      columns: [column({
        phase: 'Development',
        cards: CARDS.map((c) => buildCard({
          slug: c.slug, title: c.slug, type: 'bug', phase: 'Development',
          path: `docs/plans/2026-09-07-${c.slug}.md`, phaseDate: '2026-09-07',
          prs: c.prs.map((pr) => ({ ...pr, checks: 'unknown' as const, mergeable: 'unknown' as const })),
        })),
      })],
    });
    const page = await cat.open('an-empty-estate', {
      over: { board: allUnknown },
      tab: 'board',
      viewport: { width: 1400, height: 1400 },
    });
    try {
      await expect.poll(() => page.locator('[data-checks-unaskable]').count(), { timeout: 10_000 })
        .toBe(1);
      // ONE unreachable service is not four findings. The board says it once,
      // beside the other facts about what it could reach.
      expect(await page.locator('[data-checks-unaskable]').count()).toBe(1);
    } finally { await page.close(); }
  });

  it('does NOT claim the connector is unreachable when any PR answered', async () => {
    const page = await open();
    try {
      // The mixed board above holds a green PR, so the service demonstrably
      // answered. A per-row `unknown` there means THIS pull request, and the
      // board must not promote it to a claim about the stack.
      await expect.poll(() => note(page, 'not-asked').count(), { timeout: 10_000 }).toBe(1);
      expect(await page.locator('[data-checks-unaskable]').count()).toBe(0);
    } finally { await page.close(); }
  });
});
