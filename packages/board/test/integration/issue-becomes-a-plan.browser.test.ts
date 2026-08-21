import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer, expandAgentFolds } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet, type IssueRow } from '../../src/contract/schema.js';

/**
 * An issue becomes a plan — what only a rendered page can settle.
 *
 * Wave 1 gave the row its shape and left the actions cell empty, saying why:
 * an empty menu is better than one offering something that does not work yet.
 * This wave fills it, and these are the assertions about the FILLED cell:
 *
 *   - the action exists, and its confirmation names *Draft*
 *   - a tracker that cannot be asked offers nothing that would 409
 *   - a failed lookup offers nothing either, and does not read as "no issues"
 *   - one POST per click, never two, and the body carries only a number
 *
 * **Nothing here waits on a spawned agent.** The route is intercepted, so the
 * page's own state machine is what is under test — no child process, no budget
 * to guess, and the teardown has nothing to race.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you', ageMinutes: 30,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, repair: null,
  ...over,
});

const issue = (over: Partial<IssueRow> = {}): IssueRow => ({
  number: 228, title: 'Fleet scan asks the host once per branch', url: '', ageMinutes: 120,
  ...over,
});

function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    row({
      plan: 'reviewed-plan', planFile: '2026-08-15-reviewed-plan.md',
      branch: 'feature/needs-review', note: 'PR #116 green',
      branchUrl: `${GH}feature/needs-review`,
      pr: { number: 116, url: 'https://github.com/tiny/garden/pull/116', draft: false, state: 'green' },
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 1, waves: 1, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [
      issue({ number: 228, url: 'https://github.com/tiny/garden/issues/228' }),
    ],
    issueAnswer: 'answered',
    issueError: null,
    ...over,
  } as Fleet;
}

describe('the issue row has one action, and it creates a Draft', () => {
  let browser: Browser;
  let server: { kill: () => void; port: number };
  let baseURL: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  /**
   * Open the board with a chosen fleet and a chosen `idea` capability.
   *
   * `/api/board` is intercepted for the flag alone — the rest of the real
   * server's payload is passed through, so this test is not maintaining a
   * second copy of a Board fixture that would drift from the schema.
   */
  async function open(
    payload: Fleet = fleet(),
    idea: { available: boolean; reason: string } = { available: true, reason: '' },
  ): Promise<{ page: Page; posts: unknown[] }> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    const posts: unknown[] = [];
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    // SYNCHRONOUS, and that is the point rather than a style choice. The board
    // polls this route on a timer, so a callback that awaited `route.fetch()`
    // could still be in flight when the page closes — rejecting on a disposed
    // context and failing a test that had already made its assertion. Measured
    // here on the first run. Nothing in this file needs the real payload: the
    // control reads `board.idea`, and the contract defaults the rest.
    await page.route('**/api/board', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          columns: [], checklist: [], sprints: [], stories: [],
          dispatch: { available: false, reason: '' },
          approve: { available: false, reason: '' },
          continue: { available: false, reason: '' },
          server: { restartCommand: '', port: 0 },
          idea,
        }),
      }));
    // The route the click reaches. Recorded, never forwarded — no agent starts.
    await page.route('**/api/idea', (route) => {
      posts.push(JSON.parse(route.request().postData() ?? '{}'));
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, number: 228 }),
      });
    });
    // The status poll the button issues while a click is outstanding.
    await page.route('**/api/idea/*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ state: 'running', message: '', log: '' }),
      }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return { page, posts };
  }

  const section = (page: Page) => page.locator('ul[role="grid"][aria-label^="Waiting on you"]');
  const issueRow = (page: Page, n: number) => section(page).locator(`li[data-issue-row="${n}"]`);
  const button = (page: Page, n: number) => issueRow(page, n).locator(`[data-create-plan="${n}"]`);
  // THE `⋯` MENU the action now lives behind — `every-action-is-in-the-menu`.
  // *Create plan* is no longer inline in the row; it hangs in the issue row's
  // menu with the same `data-create-plan` hook, so every assertion below reaches
  // the same control once the menu is open.
  const menuButton = (page: Page, n: number) =>
    issueRow(page, n).locator(`[data-issue-actions="${n}"]`);
  const openMenu = async (page: Page, n: number) => {
    await menuButton(page, n).click();
    await button(page, n).waitFor({ timeout: 10_000 });
  };

  /**
   * Click a control that announces itself as disabled.
   *
   * `locator.click()` waits for actionability and would hang for its full
   * timeout here — which is the wrong failure, since the assertion is that the
   * click DOES NOTHING rather than that it cannot be delivered. `aria-disabled`
   * is deliberately not the native `disabled` attribute (the #160 decision:
   * a natively disabled button leaves the tab order, taking its own explanation
   * out of reach of the reader who most needs it), so the browser really does
   * deliver this event and the handler really must refuse it.
   */
  const clickAnyway = (page: Page, n: number) =>
    button(page, n).dispatchEvent('click');

  it('offers Create plan from the issue row menu', async () => {
    const { page } = await open();
    try {
      // The action is behind the `⋯` now: absent until the menu opens, which is
      // the whole point — the row says what IS, the menu says what you can DO.
      await expect.poll(() => menuButton(page, 228).count()).toBe(1);
      await expect.poll(() => button(page, 228).count()).toBe(0);
      await openMenu(page, 228);
      await expect.poll(() => button(page, 228).count()).toBe(1);
      await expect.poll(() => button(page, 228).textContent()).toContain('Create plan');
      await expect.poll(() => button(page, 228).getAttribute('aria-disabled')).toBe(null);
    } finally {
      await page.close();
    }
  });

  it('offers Create story beside it, refused with its reason', async () => {
    // The other half of the ticket's decision. It is OFFERED — a reader weighing
    // an unplanned issue is choosing between a plan and a story — and it refuses,
    // because a story is a person's decision (where it lives, whether it is
    // wanted yet), not a board write. The reason is on the control.
    const { page } = await open();
    try {
      await openMenu(page, 228);
      const story = issueRow(page, 228).locator('[data-create-story="228"]');
      await expect.poll(() => story.count()).toBe(1);
      await expect.poll(() => story.getAttribute('aria-disabled')).toBe('true');
      await expect.poll(() => story.textContent()).toContain('Create story');
    } finally {
      await page.close();
    }
  });

  it('offers Open on host in the same menu', async () => {
    const { page } = await open();
    try {
      await openMenu(page, 228);
      const openLink = issueRow(page, 228).locator('a[data-issue-open]');
      await expect.poll(() => openLink.count()).toBe(1);
      await expect.poll(() => openLink.getAttribute('href'))
        .toBe('https://github.com/tiny/garden/issues/228');
    } finally {
      await page.close();
    }
  });

  it('names DRAFT in the confirmation, because that is the boundary', async () => {
    const { page } = await open();
    try {
      await openMenu(page, 228);
      // Arm — the first click confirms, the second acts. The armed label names
      // the CONSEQUENCE, and the consequence here is as much the boundary as
      // the act: a plan will exist, and nothing has been decided about it.
      await button(page, 228).click();
      await expect.poll(() => button(page, 228).textContent()).toContain('Draft');
      await expect.poll(() => button(page, 228).getAttribute('aria-pressed')).toBe('true');
    } finally {
      await page.close();
    }
  });

  it('posts only after the confirmation, and posts only a number', async () => {
    const { page, posts } = await open();
    try {
      await openMenu(page, 228);
      await button(page, 228).click();
      // Armed, not acted: one click must never spawn an agent.
      expect(posts).toEqual([]);
      await button(page, 228).click();
      await expect.poll(() => posts.length).toBe(1);
      // THE NUMBER, AND NOTHING ELSE. The server reads the issue's title and
      // body from the host, so no text this page holds can become the problem
      // statement an agent acts on.
      expect(posts[0]).toEqual({ number: 228, type: 'feature' });
    } finally {
      await page.close();
    }
  });

  it('Escape cancels an armed control rather than trapping it', async () => {
    const { page, posts } = await open();
    try {
      await openMenu(page, 228);
      await button(page, 228).click();
      await page.keyboard.press('Escape');
      // Escape backs out of BOTH the armed state and the menu — the button and
      // its menu each listen for it, and there is no reading in which Escape
      // should leave one of them behind. So re-open and prove the control came
      // back UNARMED: the arm was cancelled, not merely hidden.
      await openMenu(page, 228);
      await expect.poll(() => button(page, 228).textContent()).toContain('Create plan');
      await expect.poll(() => button(page, 228).getAttribute('aria-pressed')).toBe('false');
      expect(posts).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a double click on the armed control sends ONE request, not two', async () => {
    // The defect `ApproveButton` measured: `setState` lands a render late, so
    // two clicks in one tick both read `armed`. There it is a second merge
    // attempt; here it is two /plot-idea agents racing to write two plans for
    // one signal — the row's own failure mode, caused by the row's own action.
    const { page, posts } = await open();
    try {
      await openMenu(page, 228);
      await button(page, 228).click();
      await button(page, 228).dblclick();
      await expect.poll(() => posts.length).toBe(1);
      // And stays one — a late second POST would show up here.
      await page.waitForTimeout(300);
      expect(posts.length).toBe(1);
    } finally {
      await page.close();
    }
  });

  /**
   * A tracker that cannot be asked offers no action — and the guarantee is
   * STRUCTURAL, which is stronger than the one this wave set out to build.
   *
   * Wave 1 renders issue rows only where `issueAnswer === 'answered'`
   * (`AgentList.tsx`), so `unsupported` and `failed` produce no row at all —
   * and therefore no action, with nothing to click and nothing to dim. That is
   * a better answer than a disabled button, so this wave did not replace it.
   *
   * `refusalReason` in `CreatePlanButton` is then defence in depth rather than
   * the mechanism: it is what would refuse if a future change ever rendered a
   * row on a `failed` answer — which is a real possibility, because
   * `refreshIssues` KEEPS the last good list when a lookup fails. Its four
   * branches are asserted directly in `test/unit/create-plan-button.test.ts`;
   * these two assert the guarantee that holds today.
   */
  it('renders no issue row at all when the host has no issue read', async () => {
    const { page, posts } = await open(fleet({ issueAnswer: 'unsupported' }));
    try {
      // The branch row proves the section rendered; the issue row's absence is
      // then a fact rather than a page that had not loaded.
      await section(page).locator('[data-branch="feature/needs-review"]').first()
        .waitFor({ timeout: 10_000 });
      await expect.poll(() => issueRow(page, 228).count()).toBe(0);
      await expect.poll(() => button(page, 228).count()).toBe(0);
      expect(posts).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('renders no action on a failed lookup, and does not read as "no issues"', async () => {
    // The subject here is action-absence, so the failure is a plain OUTAGE: the
    // rate-limit case is a THIRD state with its own wording, pinned in
    // `unplanned-issues.browser.test.ts`.
    const { page, posts } = await open(fleet({
      issueAnswer: 'failed', issueError: 'gh: 503 Service Unavailable',
    }));
    try {
      // AN OUTAGE IS NOT AN ANSWER: no action, and no silence either. The
      // notice is what keeps a broken lookup from passing for an empty inbox.
      await expect.poll(() => section(page).locator('[data-issue-error]').count()).toBe(1);
      await expect.poll(() => button(page, 228).count()).toBe(0);
      expect(posts).toEqual([]);
      const notice = await section(page).locator('[data-issue-error]').textContent();
      expect(notice).toContain('could not be read');
    } finally {
      await page.close();
    }
  });

  it('offers NO action when this board cannot act, and says why', async () => {
    const { page, posts } = await open(fleet(), {
      available: false,
      reason: 'the board is bound to 0.0.0.0, not localhost',
    });
    try {
      // The `⋯` is always there — the row IS a thing you can act on, the board
      // just cannot act right now. Open it and the item inside refuses itself,
      // rather than the whole menu vanishing and reading as a healthy row.
      await openMenu(page, 228);
      await expect.poll(() => button(page, 228).getAttribute('aria-disabled')).toBe('true');
      await clickAnyway(page, 228);
      expect(posts).toEqual([]);
      // Announced, not merely dimmed: the reason must reach a reader who cannot
      // see the page has greyed. `aria-disabled` rather than `disabled` keeps
      // the control in the tab order so it can be heard at all.
      await expect.poll(() => issueRow(page, 228).textContent()).toContain('not localhost');
    } finally {
      await page.close();
    }
  });

  it('leaves what wave 1 renders untouched, and frees the age column', async () => {
    // #236 settled the row's shape, and its own tests assert it. This is the
    // one thing THIS wave could plausibly break: the action lives in the
    // seventh track, and a row that grew a cell would shift every other one.
    const { page } = await open();
    try {
      const name = issueRow(page, 228).locator('[data-issue-name]');
      await expect.poll(() => name.locator('a').count()).toBe(0);
      const cells = issueRow(page, 228).locator('[role="gridcell"]');
      // STILL SEVEN — the action did not grow a cell, it moved into the one that
      // was already there. The menu component owns the seventh track.
      await expect.poll(() => cells.count()).toBe(7);
      // Track 4 (0-indexed 3) is still the empty branch column.
      await expect.poll(() => cells.nth(3).textContent()).toBe('');
      await expect.poll(() => issueRow(page, 228).locator('a[data-issue-link]').count()).toBe(1);
      // THE AGE COLUMN RENDERS ALONE — the reported defect. Track 6 (0-indexed
      // 5) held `1d`/`Create plan` overlapping when the button sat one track
      // over and overflowed left; now it holds only the age.
      await expect.poll(() => cells.nth(5).textContent()).toBe('2h');
      // Track 7 (0-indexed 6) is the menu, and it holds the glyph — not the
      // words. The action is one click in, not spilling across the age.
      const menuCell = cells.nth(6);
      await expect.poll(() => menuCell.locator('[data-issue-actions="228"]').count()).toBe(1);
      await expect.poll(() => menuCell.textContent()).not.toContain('Create plan');
    } finally {
      await page.close();
    }
  });
});
