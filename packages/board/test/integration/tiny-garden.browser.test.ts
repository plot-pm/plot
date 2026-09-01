// @needs-real-board: one test opens the plan page in a new tab and asserts the server's own chrome — the `plan-back` titlebar `renderPlanPage` adds only when `embed` is false, which is the distinction being asserted and which no served document can decide
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { openCatalogue, scenario, board as buildBoard, type Catalogue } from '../catalogue/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

// UI layer: drive a REAL browser against the shipped artifact's served page, so
// pixel-level assertions (bug a: no horizontal page scroll) and inline-sprint
// filter behaviour (bug b) are validated on exactly what plot ships — not on
// recompiled components. Requires a freshly built artifact; `test:integration`
// rebuilds first so these bytes are never stale.
// A small phone viewport — the reported bug was horizontal scroll on mobile.
const MOBILE = { width: 390, height: 844 };
const LONG_SPRINT = 'the-great-heirloom-tomato-and-zucchini-overplanting-recovery-initiative';

// THE ESTATE IS SERVED, NOT WALKED. `a-whole-small-estate` states the eight
// cards and four sprints these tests count, and the counts are the reason: they
// are facts about a POPULATION, and a population read from a directory is one
// nobody stated. The scenario tabulates which card is there for which rule.
describe('tiny-garden: UI layer (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
    // The plan documents the modal embeds. Everything else 404s, which is the
    // board's own answer to a plan with no file.
    //
    // NO TITLEBAR, and that absence is asserted: the modal fetches with
    // `?embed=1` and the chrome belongs only on the full page. A served document
    // is what makes the distinction statable — the embed view gets a document
    // with no `plan-titlebar`, so a component that started rendering one would
    // fail here rather than pass on a server that happened to omit it.
    const planDoc = (title: string) => `<h1>${title}</h1>
<h2>Approach</h2>
<p>Start the seedlings indoors, then transplant.</p>`;
    cat.mock.serveDoc('/plan/2026-03-01-plant-tomatoes.md', planDoc('Plant heirloom tomatoes'));
    cat.mock.serveDoc('/plan/2026-03-05-fix-leaky-hose.md', planDoc('Fix the leaky soaker hose'));
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  /** Open the board at mobile width and wait for cards to render. */
  async function openBoard(): Promise<Page> {
    const page = await cat.open('a-whole-small-estate', { viewport: MOBILE });
    await page.getByText('Plant heirloom tomatoes').waitFor({ timeout: 10_000 });
    return page;
  }

  it('bug (a): a very long badge value does not force horizontal page scroll on mobile', async () => {
    const page = await openBoard();
    try {
      // The long sprint slug is present…
      await expect.poll(() => page.getByText(LONG_SPRINT).count()).toBeGreaterThan(0);
      // …yet the document is not wider than the viewport (no sideways scroll).
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      // And the badge itself stays within the viewport (it wraps, not overflows).
      const box = await page.getByText(LONG_SPRINT).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
    } finally {
      await page.close();
    }
  });

  it('offers a sprint that has a file under active/', async () => {
    const page = await openBoard();
    try {
      // The trigger carries aria-label="All sprints" (MultiSelect).
      //
      // THE FIXTURE GAINED A SPRINT FILE for this. It previously had none, and
      // the filter still listed `spring-planting` — derived from `card.sprint`
      // on the plans. That union is gone: a plan's `Sprint:` field is history
      // and does not clear when its sprint closes, so deriving options from it
      // offered closed sprints beside open ones with nothing to tell them apart.
      expect(await page.getByLabel('All sprints').isVisible()).toBe(true);
      await page.getByLabel('All sprints').click();
      expect(await page.getByRole('checkbox', { name: 'Spring planting' }).isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('shows per-option result counts in the sprint dropdown', async () => {
    const page = await openBoard();
    try {
      await page.getByLabel('All sprints').click();
      // Each option row ends with an aria-hidden count span. spring-planting is
      // on 2 plans (Draft + Approved); 3 plans carry no sprint at all.
      const countIn = (label: string) =>
        page.locator('label', { hasText: label }).locator('span[aria-hidden]').textContent();
      await expect.poll(() => countIn('Spring planting')).toBe('2');
      expect(await countIn('No sprint')).toBe('3');
    } finally {
      await page.close();
    }
  });

  it('selecting an active sprint filters the board', async () => {
    const page = await openBoard();
    try {
      expect(await page.locator('article').count()).toBe(8);

      await page.getByLabel('All sprints').click();
      // Options are Radix checkboxes named by their wrapping label — distinct
      // from the identically-worded sprint badges on cards.
      await page.getByRole('checkbox', { name: 'Spring planting' }).click();

      // Only plant-tomatoes (Draft) + fix-leaky-hose (Approved) carry it.
      await expect.poll(() => page.locator('article').count()).toBe(2);
    } finally {
      await page.close();
    }
  });

  // ── Plan viewer ───────────────────────────────────────────────────────────
  const PLAN_PATH = '/plan/2026-03-01-plant-tomatoes.md';
  const tomatoCard = (page: Page) =>
    page.locator('article', { hasText: 'Plant heirloom tomatoes' });

  it('the Open control is a real anchor to the plan route', async () => {
    const page = await openBoard();
    try {
      const open = tomatoCard(page).getByRole('link', { name: 'Open' });
      // A real href is what makes native cmd/ctrl/middle-click open a new tab.
      expect(await open.getAttribute('href')).toBe(PLAN_PATH);
    } finally {
      await page.close();
    }
  });

  it('a plain click opens the modal with the embedded plan, and Close closes it', async () => {
    const page = await openBoard();
    try {
      await tomatoCard(page).getByRole('link', { name: 'Open' }).click();

      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });

      // Modal chrome shows a static "Plan" label, not the plan's title.
      expect(await dialog.locator('header h2').textContent()).toBe('Plan');

      // "opens" = the iframe is present and its srcdoc was populated by the
      // fetch with the server-rendered plan HTML (no frame traversal needed).
      const iframe = page.locator('iframe[title="Plan: plant-tomatoes"]');
      await iframe.waitFor({ state: 'visible', timeout: 5_000 });
      await expect
        .poll(async () => ((await iframe.getAttribute('srcdoc')) ?? '').includes('<h2>Approach</h2>'))
        .toBe(true);
      // The embedded view is chrome-free: the modal fetched it with ?embed=1, so
      // no back-to-board titlebar element (that only belongs on the full page).
      expect((await iframe.getAttribute('srcdoc')) ?? '').not.toContain(
        '<header class="plan-titlebar">',
      );

      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('a meta-click does NOT open the modal (native new-tab is left alone)', async () => {
    const page = await openBoard();
    try {
      // A modified click may open a background tab; whatever the browser does,
      // our handler must not intercept it — so no modal appears.
      const popup = page.context().waitForEvent('page', { timeout: 2000 }).catch(() => null);
      await tomatoCard(page).getByRole('link', { name: 'Open' }).click({ modifiers: ['Meta'] });
      expect(await page.getByRole('dialog').count()).toBe(0);
      const p = await popup;
      if (p) await p.close();
    } finally {
      await page.close();
    }
  });

  // ── Start work ────────────────────────────────────────────────────────────
  //
  // Rendering only. No click: a click would run the real plot-dispatch.sh
  // against the fixture, and this suite must create no worktree and push
  // nothing. The route contract is pinned in test/dispatch.test.mjs with a stub.

  it('Start work is a real <button>, never an anchor', async () => {
    const page = await openBoard();
    try {
      // It has no URL and must never be openable in a new tab, prefetched, or
      // bookmarked — it is a state change, not a destination.
      const card = page.locator('article', { hasText: 'Fix the leaky soaker hose' });
      const control = card.getByRole('button', { name: 'Start work' });
      await control.waitFor({ timeout: 10_000 });
      expect(await control.evaluate((el) => el.tagName)).toBe('BUTTON');
      expect(await card.getByRole('link', { name: 'Start work' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('a Draft plan carries no Start work button', async () => {
    const page = await openBoard();
    try {
      // plot-dispatch.sh refuses every phase but approved — Draft exits 1 with
      // "Review it, then: /plot-approve" — so a button here could only fail.
      const draft = page.locator('article', { hasText: 'Plant heirloom tomatoes' });
      expect(await draft.getByRole('button', { name: 'Start work' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('the approved-but-unstarted card (now in Development) is the one that gets it', async () => {
    const page = await openBoard();
    try {
      // An approved plan nobody has begun renders under Development now — Design
      // is a phase of its own, not the approved-unstarted queue. The Start
      // button keys on the plan being approved-and-unstarted, NOT on the column,
      // which is exactly why moving the card between columns does not hide it
      // from the first-dispatch case it is most for.
      const card = page.locator('article', { hasText: 'Fix the leaky soaker hose' });
      await expect.poll(() => card.getByText('Ready').count()).toBe(1);
      expect(await card.getByRole('button', { name: 'Start work' }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  // ── Where this plan is checked out on THIS machine ────────────────────────
  //
  // The path comes from `git worktree list --porcelain`, which the fleet scan
  // parses anyway, and it answers a question the triage row cannot: *where is
  // this on my machine*. It belongs in the modal — once you have stopped
  // triaging and decided to go look.
  //
  // `/api/board` is stubbed here rather than a real worktree created, because
  // the claim is about what the MODAL renders for a card that carries the field
  // (and for one that does not). The server's half is pinned against the real
  // `worktreesFromPulse` in test/unit/wave-summary.test.ts, and the scan's half
  // against real worktrees in test/reconcile/fleet.test.mjs.

  /**
   * Open the board with the tomato card carrying `worktrees` — or, with none
   * given, exactly what the server sent.
   */
  async function openBoardWithWorktrees(
    worktrees?: { branch: string; path: string }[],
  ): Promise<Page> {
    if (!worktrees) return openBoard();
    // A FIELD ON A CARD, stated rather than patched into a fetched payload. The
    // helper this replaces intercepted `/api/board`, re-parsed the response and
    // wrote the field back in — the long way round to a value the scenario can
    // simply carry.
    const base = scenario('a-whole-small-estate').board;
    const page = await cat.open('a-whole-small-estate', {
      viewport: MOBILE,
      over: {
        board: buildBoard({
          ...base,
          columns: base.columns.map((col) => ({
            ...col,
            cards: col.cards.map((card) => (card.slug === 'plant-tomatoes'
              ? { ...card, worktrees }
              : card)),
          })),
        }),
      },
    });
    await page.getByText('Plant heirloom tomatoes').waitFor({ timeout: 10_000 });
    return page;
  }

  it('the modal shows the local worktree path, copyable and labelled as local', async () => {
    const page = await openBoardWithWorktrees([
      { branch: 'feature/tomatoes', path: '/Users/gardener/wt-tomatoes' },
    ]);
    try {
      await tomatoCard(page).getByRole('link', { name: 'Open' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });

      // Labelled as LOCAL. The path is true on this machine and meaningless on
      // any other, and a reader has to be able to tell that from the row.
      await dialog.getByText(/on this machine/i).waitFor({ timeout: 5_000 });
      // Selectable rather than a copy button: it works without the clipboard
      // permission and shows the value it would copy. The next thing anyone does
      // with it is `cd`.
      const field = dialog.getByLabel('Worktree path for feature/tomatoes');
      expect(await field.inputValue()).toBe('/Users/gardener/wt-tomatoes');
      expect(await field.getAttribute('readonly')).not.toBeNull();
      await expect.poll(() => dialog.getByText('feature/tomatoes').count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('shows NOTHING where this machine has no worktree for the plan', async () => {
    // The absent case, and the one that keeps the field honest: a path that does
    // not exist on the reader's machine is worse than no path. Every modal
    // opened on a teammate's laptop lands here — including this one, since the
    // fixture repo has no worktrees at all.
    const page = await openBoardWithWorktrees();
    try {
      await tomatoCard(page).getByRole('link', { name: 'Open' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });
      // The plan itself renders, so this is an absent section rather than an
      // unrendered modal.
      await page.locator('iframe[title="Plan: plant-tomatoes"]')
        .waitFor({ state: 'visible', timeout: 5_000 });
      expect(await dialog.getByText(/on this machine/i).count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

/**
 * THE SERVER'S OWN PAGE, which is the one thing a served document cannot be.
 *
 * `renderPlanPage` assembles the standalone plan page, and its `embed` option is
 * the whole distinction this asserts: the in-board modal fetches `?embed=1` and
 * gets a chrome-free document, the new tab gets a `plan-back` titlebar pointing
 * at `/`. A mock handed a document serves whatever it was handed, so it can fail
 * neither direction — the board is what decides, so the board is what runs.
 *
 * One test, and the twelve above it moved to a served state.
 */
describe('tiny-garden: the standalone plan page (the server assembles it)', () => {
  let server: { port: number; kill: () => void };
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  const PLAN_PATH = '/plan/2026-03-01-plant-tomatoes.md';

  async function openBoard(): Promise<Page> {
    const page = await browser.newPage({ viewport: MOBILE });
    await page.goto(baseURL);
    await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
    return page;
  }

  const tomatoCard = (page: Page) =>
    page.locator('article', { hasText: 'Plant heirloom tomatoes' });

  it('"Open in new tab" opens the full plan page with a working back-to-board link', async () => {
    const page = await openBoard();
    try {
      await tomatoCard(page).getByRole('link', { name: 'Open' }).click();
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5_000 });

      const [popup] = await Promise.all([
        page.context().waitForEvent('page'),
        page.getByRole('link', { name: 'Open in new tab' }).click(),
      ]);
      await popup.waitForLoadState('domcontentloaded');
      // Plain URL (no ?embed) — so the full page, with titlebar.
      expect(popup.url().endsWith(PLAN_PATH)).toBe(true);
      expect(await popup.locator('h1').textContent()).toBe('Plant heirloom tomatoes');

      // The titlebar's back link points at the board and actually navigates there.
      const back = popup.locator('a.plan-back');
      expect(await back.getAttribute('href')).toBe('/');
      await back.click();
      await popup.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
      await popup.close();
    } finally {
      await page.close();
    }
    // 60s, because this is the ONE test in the suite that waits on a real board
    // to answer `/api/board` from a git scan. Measured 2026-09-01: it passed in
    // 1.1s locally and timed out at the 30s default on a CI runner — the first
    // board request now lands after 400s of other tests rather than at the top
    // of a warm file, so the scan is cold and the runner is slower than a
    // laptop by more than the default's margin.
  }, 60_000);
});
