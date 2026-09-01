import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import type { Fleet } from '../../src/contract/schema.js';

/**
 * A BUTTON THAT IS ACTING LOOKS DIFFERENT FROM ONE THAT WAS NEVER CLICKED.
 *
 * The reported half of the defect: *"Click on actions like 'Start work' or
 * 'Approve' don't have an activity indicator … User does not see that. Action
 * is going to be executed."* Measured, an indicator did exist — the label swaps
 * to `starting…` / `approving…` and `aria-busy` is set — and it is a word change
 * in a small text button, easy to miss on a control the reader is not looking
 * directly at, and indistinguishable at a glance from a button that did nothing.
 *
 * Every assertion here needs a REAL PAGE and could not be a predicate: computed
 * animation state under `prefers-reduced-motion`, what a screen reader is handed,
 * a rendered opacity, and whether two indicators are actually distinguishable in
 * the DOM. Anything that reduces to a predicate lives in
 * `test/unit/acting-spinner.test.ts` instead — this repo has no component-test
 * seat (vitest runs `environment: 'node'`), so the split is deliberate.
 *
 * NO REAL DISPATCH, NO REAL APPROVAL. Both POST routes are fulfilled at the
 * network boundary, so nothing creates a worktree, pushes a claim or merges
 * anything.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const VIEWPORT = { width: 1280, height: 900 };

/** The approved-but-unstarted card: the one that carries `Start work`. */
const STARTABLE = 'Fix the leaky soaker hose';
/** A Draft card with a plan PR: the one whose `Approve` names a number. */
const DRAFT_WITH_PR = 'Plant heirloom tomatoes';

/**
 * A copy of the garden outside this repository, for the reason
 * `approve.browser.test.ts` documents at length: `plot-config.sh` locates
 * configuration by `git rev-parse --show-toplevel`, so a fixture nested inside
 * the plot checkout reads plot's own `CLAUDE.md` instead of the garden's.
 */
function detachedGarden(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-garden-spin-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe('the acting buttons carry a spinner while they act', () => {
  // THE STATE IS SERVED. This copied the garden to a temp directory and
  // started a real board over it so the acting buttons would be available;
  // `a-board-that-can-act` says which board this is, and the write routes stay
  // intercepted below, which is where a click's effect belongs.
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  /**
   * A board whose acting routes answer without acting.
   *
   * `/api/dispatch` answers the way the real route does on success — 202 with a
   * slug and a log — so the button takes its normal in-flight path. The garden
   * is not a git repo, so no pulse ever confirms and the button STAYS in flight,
   * which is exactly the window every assertion here needs to observe.
   *
   * `reducedMotion` is a context option, so the still half of the suite gets its
   * own context rather than its own server.
   */
  async function openBoard(opts: { reducedMotion?: 'reduce' } = {}): Promise<Page> {
    const page = await cat.open('a-board-that-can-act', {
      viewport: VIEWPORT,
      ...(opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {}),
    });
    await page.route('**/api/dispatch', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ slug: 'fix-leaky-hose', log: 'stubbed' }),
      }));
    await page.route('**/api/approve', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ slug: 'plant-tomatoes' }),
      }));
    // The polled answer, so the running Approve button neither settles nor
    // fails while the assertion is being made.
    await page.route('**/api/approve/*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'running' }),
      }));
    await page.getByText(STARTABLE).waitFor({ timeout: 10_000 });
    return page;
  }

  const cardFor = (page: Page, title: string) => page.locator('article', { hasText: title });
  const spinnerIn = (page: Page, title: string) =>
    cardFor(page, title).locator('[data-acting-spinner]');

  /** Click `Start work` and wait until the button is genuinely in flight. */
  async function startWork(page: Page) {
    const card = cardFor(page, STARTABLE);
    await card.getByRole('button', { name: 'Start work' }).click();
    await card.getByRole('button', { name: /starting…/ }).waitFor({ timeout: 10_000 });
    return card;
  }

  /** Arm and run `Approve`, and wait until the button is genuinely in flight. */
  async function approve(page: Page) {
    const card = cardFor(page, DRAFT_WITH_PR);
    await card.getByRole('button', { name: 'Approve' }).click();
    await card.getByRole('button', { name: /merges PR #146/ }).click();
    await card.getByRole('button', { name: /approving…/ }).waitFor({ timeout: 10_000 });
    return card;
  }

  /** Whether an element is actually running an animation, per the browser. */
  const animating = (locator: ReturnType<typeof spinnerIn>) =>
    locator.evaluate((el) => {
      const name = getComputedStyle(el).animationName;
      return name !== 'none' && name !== '';
    });

  it('an IDLE button carries no spinner', async () => {
    // Trivial by construction and asserted so nobody later renders it
    // unconditionally — a spinner on every button says every button is acting,
    // which is the same lie as no spinner at all, told the other way round.
    const page = await openBoard();
    try {
      await cardFor(page, STARTABLE).getByRole('button', { name: 'Start work' })
        .waitFor({ timeout: 10_000 });
      expect(await spinnerIn(page, STARTABLE).count()).toBe(0);
      expect(await spinnerIn(page, DRAFT_WITH_PR).count()).toBe(0);
      // Nowhere on the board at all, before anything has been clicked.
      expect(await page.locator('[data-acting-spinner]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('Start work: an IN-FLIGHT button carries a spinner, and it moves', async () => {
    const page = await openBoard();
    try {
      await startWork(page);
      const spinner = spinnerIn(page, STARTABLE);
      await expect.poll(() => spinner.count()).toBe(1);
      // Present is not enough: a marker that never moves is a dot, and the
      // whole point of a spinner on a button is that it says an answer is
      // coming rather than that something is merely alive.
      expect(await animating(spinner)).toBe(true);
      const box = await spinner.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('Approve: an IN-FLIGHT button carries a spinner, and it moves', async () => {
    const page = await openBoard();
    try {
      await approve(page);
      const spinner = spinnerIn(page, DRAFT_WITH_PR);
      await expect.poll(() => spinner.count()).toBe(1);
      expect(await animating(spinner)).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('THE LABEL STILL CHANGES — the spinner is beside the word, never instead', async () => {
    // Motion must never be the only carrier of a fact. A screen reader is
    // handed the word; the spinner is hidden from it entirely, so removing the
    // label in favour of the marker would leave that reader with nothing.
    const page = await openBoard();
    try {
      const card = await startWork(page);
      expect(await card.getByRole('button', { name: /starting…/ }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('THE SPINNER IS ARIA-HIDDEN — the state is announced once, not three times', async () => {
    // Already announced twice: the label reads `starting…` and `aria-busy` is
    // set, both landed in earlier waves. A marker that announced itself would
    // say the same thing a third time.
    const page = await openBoard();
    try {
      const card = await startWork(page);
      const spinner = spinnerIn(page, STARTABLE);
      await expect.poll(() => spinner.count()).toBe(1);
      expect(await spinner.getAttribute('aria-hidden')).toBe('true');

      const button = card.getByRole('button', { name: /starting…/ });
      expect(await button.getAttribute('aria-busy')).toBe('true');
      // The accessible name is the WORD and nothing the marker contributed:
      // the spinner is an empty box, so it adds no text either way, and this
      // pins that a later implementation cannot slip a "loading" string in.
      expect((await button.textContent())?.trim()).toBe('starting…');
    } finally {
      await page.close();
    }
  });

  it('THE BUTTON DIMS while in flight, and comes back to full contrast', async () => {
    // Tied to the same state that drives the label, so the contrast returns
    // exactly when the click resolves — never on a timer of its own.
    const page = await openBoard();
    try {
      const card = cardFor(page, STARTABLE);
      const button = card.getByRole('button', { name: 'Start work' });
      await button.waitFor({ timeout: 10_000 });
      const idle = await button.evaluate((el) => Number(getComputedStyle(el).opacity));
      expect(idle).toBe(1);

      await button.click();
      const pending = card.getByRole('button', { name: /starting…/ });
      await pending.waitFor({ timeout: 10_000 });
      const dimmed = await pending.evaluate((el) => Number(getComputedStyle(el).opacity));
      expect(dimmed).toBeLessThan(1);
      // Still legible rather than nearly invisible — the button is dimmed, not
      // hidden, and the label on it is the thing a reader most needs.
      expect(dimmed).toBeGreaterThan(0.3);
    } finally {
      await page.close();
    }
  });

  it('and it RETURNS to full contrast when the click resolves', async () => {
    // The pairing for the assertion above: dimming that never lifts passes it
    // and leaves the board looking permanently disabled. `/api/dispatch` fails
    // here, which is the one resolution this fixture can produce on its own —
    // the garden is not a git repo, so no pulse ever confirms a success.
    const page = await openBoard();
    try {
      await page.unroute('**/api/dispatch');
      await page.route('**/api/dispatch', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'the dispatcher refused' }),
        }));
      const card = cardFor(page, STARTABLE);
      await card.getByRole('button', { name: 'Start work' }).click();
      // Back to the idle label, and with it the idle contrast and no marker.
      const button = card.getByRole('button', { name: 'Start work' });
      await expect.poll(() => button.count(), { timeout: 10_000 }).toBe(1);
      await expect.poll(() => spinnerIn(page, STARTABLE).count()).toBe(0);
      expect(await button.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('MOTION-REDUCE stops the animation and KEEPS the marker', async () => {
    // BOTH halves. Rendering nothing under `prefers-reduced-motion` would
    // satisfy "no motion" and take the marker along with it, leaving a reader
    // who prefers reduced motion with LESS information rather than the same
    // information held still — the rule `working-rows-show-motion` settled and
    // this inherits rather than re-decides.
    const page = await openBoard({ reducedMotion: 'reduce' });
    try {
      await startWork(page);
      const spinner = spinnerIn(page, STARTABLE);
      await expect.poll(() => spinner.count()).toBe(1);
      expect(await animating(spinner)).toBe(false);

      // Still DRAWN: a visible box, not a collapsed one.
      const box = await spinner.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);
      // And still at full opacity of its own, rather than frozen mid-spin at a
      // fraction — the BUTTON dims, the marker on it does not fade away.
      expect(await spinner.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('and the button is fully legible with the animation off', async () => {
    // The label and `aria-busy` carry the fact; the marker is decoration on top
    // of information, never the carrier of it. Suppressing motion must change
    // nothing a reader relies on.
    const page = await openBoard({ reducedMotion: 'reduce' });
    try {
      const card = await startWork(page);
      const button = card.getByRole('button', { name: /starting…/ });
      expect(await button.count()).toBe(1);
      expect(await button.getAttribute('aria-busy')).toBe('true');
    } finally {
      await page.close();
    }
  });

  it('THE REF LATCH STILL HOLDS — two clicks in one tick are still one request', async () => {
    // This wave edits the same files as #173 and adds only a visual layer. A
    // spinner that re-rendered the button in a way that reset the latch would
    // pass every assertion above and quietly restore the double-dispatch.
    const page = await openBoard();
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(new URL(req.url()).pathname);
    });
    try {
      await cardFor(page, STARTABLE).getByRole('button', { name: 'Start work' })
        .waitFor({ timeout: 10_000 });
      await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>('article button')]
          .find((n) => (n.textContent ?? '').includes('Start work'));
        if (!el) throw new Error('no Start work button');
        el.click();
        el.click();
      });
      await expect.poll(() => posts.filter((p) => p === '/api/dispatch').length,
        { timeout: 5_000 }).toBe(1);
      await page.waitForTimeout(500);
      expect(posts.filter((p) => p === '/api/dispatch')).toHaveLength(1);
      // And the spinner is on the ONE button that is acting.
      expect(await page.locator('[data-acting-spinner]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});

/**
 * THE REGRESSION THAT MATTERS: the WORKING rows still pulse.
 *
 * A change that unified the two indicators would pass every button assertion
 * above and quietly make every WORKING row promise a completion nothing
 * measures — `isLive` is just `group === 'working'`, so such a row can pulse for
 * hours with no known end. The dot must be untouched, and the two markers must
 * be TELLABLE APART.
 */
// `the rows keep their own indicator, and it is not this one` stood here and
// held one test: the WORKING dot — `[data-live-dot]`, a static emerald mark on
// every such row — was present, pulsing, and not the button's marker.
//
// That dot went on 2026-08-22. It sat a pixel from `ActivityMark`'s travelling
// dot, so a WORKING row showed two and read as one smudge, and what it said
// (*this row is in WORKING*) the section heading already says once.
//
// Its claim survives whole in `acting-spinner.test.ts`, which reads the source:
// the ROW's marker and the BUTTON's spinner must never be unified, because a
// click ends in seconds and a row does not — and `ActivityMark` measures no end
// either, so the argument transfers intact.
