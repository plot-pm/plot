import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';

// @needs-real-board: the second click's POST leaves the browser and runs the configured `Approve command`, and the card asserts that script's own sentence
//
// The declaration above is READ BY THE GATE
// (`stubbed-tests-start-no-board.test.ts`) and then VERIFIED against this
// file's structure: it earns the exception by referencing `/api/approve`
// without a `page.route` over it — the only file in the suite where a write
// reaches a script, measured 2026-08-31. The reason is here because no
// predicate could infer it; the entitlement is structural because no comment
// should be trusted for it.

// UI layer: a real browser against the shipped artifact.
//
// Four of these assertions exist because a WEAKER implementation passes
// everything else:
//
//   - a single-click Approve passes every test that only checks the end state,
//     so one test asserts that the first click makes NO request and only
//     changes the label;
//   - an implementation that hid the button on a not-yet-ready PR would look
//     correct against the one Draft plan that has a PR, so the PR-less Draft
//     card is asserted explicitly;
//   - an implementation that posted to the git host directly would satisfy "the
//     approval happened", so the request URL is asserted;
//   - an implementation that rendered "failed" would satisfy "an error is
//     shown", so the SCRIPT'S OWN sentence is asserted on the card.
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const VIEWPORT = { width: 1280, height: 900 };

/**
 * A copy of the garden, OUTSIDE this repository.
 *
 * `plot-config.sh` locates configuration by `git rev-parse --show-toplevel`,
 * so a fixture nested inside the plot checkout has its own `CLAUDE.md` shadowed
 * by plot's — every key the garden declares is in fact read from the outer
 * repo, which has gone unnoticed because the two agree on the keys that existed
 * before now. `Approve command` is the first key where they differ, and reading
 * plot's own config would make this suite assert against the wrong repo.
 *
 * Copying to a temp directory is the smallest fix that keeps the assertions
 * honest. It is deliberately NOT a change to `plot-config.sh` or to the shared
 * fixture — the shadowing is a real finding and belongs in its own change,
 * where whatever else depends on it can be examined.
 */
function detachedGarden(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-garden-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

/** The fixture's two Draft plans — with a plan PR, and without one. */
const DRAFT_WITH_PR = 'Plant heirloom tomatoes';
const DRAFT_WITHOUT_PR = 'Start a pumpkin patch';
/** Approved, Delivered and Released cards, one each — none may offer Approve. */
const NOT_DRAFT = ['Fix the leaky soaker hose', 'Deal with the zucchini glut', 'Harvest the first apple crop'];

describe('approve: a Draft card can act, behind one confirmation', () => {
  let server: { port: number; kill: () => void };
  let browser: Browser;
  let baseURL: string;
  let garden: string;

  beforeAll(async () => {
    garden = detachedGarden();
    server = await startServer(garden);
    baseURL = `http://localhost:${server.port}/`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.kill();
    if (garden) fs.rmSync(garden, { recursive: true, force: true });
  });

  async function openBoard(): Promise<Page> {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(baseURL);
    await page.getByText(DRAFT_WITH_PR).waitFor({ timeout: 10_000 });
    return page;
  }

  const cardFor = (page: Page, title: string) => page.locator('article', { hasText: title });

  /**
   * Every POST the page makes to the approve route, recorded from the network
   * rather than from a spy the test installed. A click that reaches the git
   * host instead would be invisible to a mock and is visible here.
   */
  function recordApprovePosts(page: Page): string[] {
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });
    return posts;
  }

  it('shows Approve on a Draft card', async () => {
    const page = await openBoard();
    try {
      const button = cardFor(page, DRAFT_WITH_PR).getByRole('button', { name: 'Approve' });
      await button.waitFor({ timeout: 10_000 });
      // A real <button>, never an anchor: it has no URL and must never be
      // openable in a new tab, prefetched or bookmarked. Same rule Start work
      // states for itself.
      expect(await button.evaluate((el) => el.tagName)).toBe('BUTTON');
    } finally {
      await page.close();
    }
  });

  it('shows Approve on a Draft card whose PR is NOT yet ready', async () => {
    const page = await openBoard();
    try {
      // The assertion the plan names explicitly. `pumpkin-patch` names no plan
      // PR at all — the same class of state as a PR still in draft, and the one
      // that occurred repeatedly in one evening. An implementation that hid the
      // button here has quietly copied Approve's preconditions into the board,
      // and would pass every other test in this file.
      const button = cardFor(page, DRAFT_WITHOUT_PR).getByRole('button', { name: 'Approve' });
      await button.waitFor({ timeout: 10_000 });
      expect(await button.count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers Approve on NO card outside Discovery', async () => {
    const page = await openBoard();
    try {
      // An approved plan has nothing to approve, and offering it would invite a
      // second approval whose one effect is a confusing error. Asserted across
      // Design/Testing/Released rather than on one card, so a rule keyed on the
      // wrong column would show up.
      for (const title of NOT_DRAFT) {
        const card = cardFor(page, title);
        await card.first().waitFor({ timeout: 10_000 });
        expect(await card.getByRole('button', { name: /^Approve/ }).count())
          .toBe(0);
      }
      // …and the board really does hold both kinds, so this is an absence
      // rather than an empty board.
      expect(await page.getByRole('button', { name: 'Approve' }).count()).toBe(2);
    } finally {
      await page.close();
    }
  });

  it('the FIRST click does not approve — it changes the label and posts nothing', async () => {
    const page = await openBoard();
    const posts = recordApprovePosts(page);
    try {
      const card = cardFor(page, DRAFT_WITH_PR);
      await card.getByRole('button', { name: 'Approve' }).click();

      // The armed label names the CONSEQUENCE rather than repeating the verb —
      // the part a reader needs before committing to it.
      await card.getByRole('button', { name: 'Approve — merges PR #146?' })
        .waitFor({ timeout: 5_000 });

      // THE assertion. A single-click implementation passes every test that
      // only checks the end result, and fails exactly here.
      await page.waitForTimeout(500);
      expect(posts).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a Draft plan with no PR arms with a label that names the plan instead', async () => {
    const page = await openBoard();
    try {
      // Not an error case: `Review: in-session` approvals merge nothing at all,
      // so the label says what is still true rather than inventing a number.
      const card = cardFor(page, DRAFT_WITHOUT_PR);
      await card.getByRole('button', { name: 'Approve' }).click();
      await card.getByRole('button', { name: 'Approve — approves pumpkin-patch?' })
        .waitFor({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  it('a click ELSEWHERE cancels the armed state', async () => {
    const page = await openBoard();
    const posts = recordApprovePosts(page);
    try {
      const card = cardFor(page, DRAFT_WITH_PR);
      await card.getByRole('button', { name: 'Approve' }).click();
      await card.getByRole('button', { name: /merges PR #146/ }).waitFor({ timeout: 5_000 });

      // The way out, and the reason no dialog was needed: clicking anywhere
      // else is what a reader does when they change their mind.
      await page.locator('header').first().click({ position: { x: 5, y: 5 } });
      await card.getByRole('button', { name: 'Approve' }).waitFor({ timeout: 5_000 });
      expect(await card.getByRole('button', { name: /merges PR/ }).count()).toBe(0);
      expect(posts).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the SECOND click posts to /api/approve — not to the git host', async () => {
    const page = await openBoard();
    const posts = recordApprovePosts(page);
    try {
      const card = cardFor(page, DRAFT_WITH_PR);
      await card.getByRole('button', { name: 'Approve' }).click();
      await card.getByRole('button', { name: /merges PR #146/ }).click();

      await expect.poll(() => posts.length, { timeout: 10_000 }).toBe(1);
      // The approval rules stay in the skill. A board that merged the PR itself
      // would satisfy "the approval happened" and would be the second place
      // those rules lived.
      expect(new URL(posts[0]).pathname).toBe('/api/approve');
    } finally {
      await page.close();
    }
  });

  it('a failing approval shows the COMMAND\'S OWN message on the card', async () => {
    const page = await openBoard();
    try {
      // The fixture's approve command refuses with the exact sentence
      // /plot-approve writes for a plan PR still in draft. That text has to
      // travel: process → log → GET /api/approve/<slug> → card. Asserting it
      // verbatim is what distinguishes this from an implementation that renders
      // "failed" — and a reason-less failure sends the reader to a terminal, at
      // which point the command could have been typed there in the first place.
      const card = cardFor(page, DRAFT_WITH_PR);
      await card.getByRole('button', { name: 'Approve' }).click();
      await card.getByRole('button', { name: /merges PR #146/ }).click();

      await card.getByText('Plan is still a draft. Mark it ready for review first.')
        .waitFor({ timeout: 20_000 });
      // Named negatively too: a card that ALSO said "failed" somewhere would
      // pass the wait above while still having replaced the reason.
      expect(await card.getByText(/^failed$/).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('a failed attempt re-arms rather than re-running', async () => {
    const page = await openBoard();
    const posts = recordApprovePosts(page);
    try {
      const card = cardFor(page, DRAFT_WITH_PR);
      await card.getByRole('button', { name: 'Approve' }).click();
      await card.getByRole('button', { name: /merges PR #146/ }).click();
      await card.getByText('Plan is still a draft. Mark it ready for review first.')
        .waitFor({ timeout: 20_000 });

      // The reason has just been read, so the next click should be as
      // deliberate as the first was — one confirmation every time, not one ever.
      await card.getByRole('button', { name: 'Approve' }).click();
      await card.getByRole('button', { name: /merges PR #146/ }).waitFor({ timeout: 5_000 });
      await page.waitForTimeout(500);
      expect(posts).toHaveLength(1);
    } finally {
      await page.close();
    }
  });
});

describe('approve: a board that cannot approve says so instead of offering', () => {
  let server: { port: number; kill: () => void };
  let browser: Browser;
  let garden: string;

  beforeAll(async () => {
    // Bound to 0.0.0.0, the way the fleet user test reaches the board over
    // Tailscale. Whoever reaches localhost owns the worktrees; over a network
    // that stops being true, and the route refuses rather than inventing auth.
    //
    // The garden here DOES declare an `Approve command`, so the reason the
    // button is disabled can only be the binding — the assertion would pass for
    // the wrong reason against an unconfigured project.
    garden = detachedGarden();
    server = await startServer(garden, { HOST: '0.0.0.0' });
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.kill();
    if (garden) fs.rmSync(garden, { recursive: true, force: true });
  });

  it('renders Approve disabled, carrying the binding\'s own reason', async () => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(`http://localhost:${server.port}/`);
      const button = page
        .locator('article', { hasText: DRAFT_WITH_PR })
        .getByRole('button', { name: 'Approve' });
      await button.waitFor({ timeout: 10_000 });
      // Disabled and EXPLAINED. A control that looks live and 403s on click is
      // a worse answer than one that says up front what it cannot do; a
      // disabled button with no explanation reads as a bug.
      //
      // And this refusal is CORRECT rather than a gap: approving merges a PR
      // and writes to the default branch, and a Tailscale address is
      // deliberately not localhost. The phone reads the board; it does not
      // approve from it. `Start work` behaves identically for the same reason.
      expect(await button.isDisabled()).toBe(true);
      expect(await button.getAttribute('title')).toMatch(/localhost/);
    } finally {
      await page.close();
    }
  });

  it('stays FOCUSABLE — `aria-disabled`, never the native attribute', async () => {
    // A natively disabled button leaves the tab order and takes its `title`
    // explanation with it, out of reach of exactly the reader who cannot see
    // that it is dimmed. #160 settled this for `Start work`; the two were built
    // in parallel and this one did not see that decision.
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(`http://localhost:${server.port}/`);
      const button = page
        .locator('article', { hasText: DRAFT_WITH_PR })
        .getByRole('button', { name: 'Approve' });
      await button.waitFor({ timeout: 10_000 });
      expect(await button.getAttribute('aria-disabled')).toBe('true');
      expect(await button.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);
      // Reachable by keyboard, which is the whole point of the attribute.
      await button.focus();
      expect(await button.evaluate((el) => el === document.activeElement)).toBe(true);
      // And the reason travels with it, for a reader with no pointer to hover.
      expect(await button.textContent()).toMatch(/localhost/);
    } finally {
      await page.close();
    }
  });

  it('and a click on it still does nothing', async () => {
    // `aria-disabled` does not stop a click the way `disabled` does, so the
    // refusal is stated in the handler as well — and that is what this asserts.
    const page = await browser.newPage({ viewport: VIEWPORT });
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST') posts.push(r.url());
    });
    try {
      await page.goto(`http://localhost:${server.port}/`);
      const button = page
        .locator('article', { hasText: DRAFT_WITH_PR })
        .getByRole('button', { name: 'Approve' });
      await button.waitFor({ timeout: 10_000 });
      await button.click({ force: true });
      await button.click({ force: true });
      await page.waitForTimeout(400);
      expect(posts).toHaveLength(0);
      // Not even armed: an inert control that changed its label would be
      // claiming a next click will act.
      expect(await button.textContent()).not.toMatch(/merges PR/);
    } finally {
      await page.close();
    }
  });
});
