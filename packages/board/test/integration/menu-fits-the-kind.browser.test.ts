import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer, expandAgentFolds } from '../helpers.mjs';
import { type AgentRow, type Fleet, type Stuck } from '../../src/contract/schema.js';

/**
 * THE MENU FITS THE KIND — what only a rendered page can settle.
 *
 * The unit suite (`test/unit/agent-list.test.ts`) owns the decisions: which
 * items a kind offers (`menuState`, `openTarget`, `runLinkLabel`,
 * `canCommissionDesign`, `storyRefusal`). This owns the half a page states:
 *
 *   - EVERY row in WAITING ON YOU has a `⋯` menu — the motivating defect was
 *     two rows of three with none.
 *   - a PR whose checks fail offers *Show failure* inside that menu.
 *   - a bare branch offers *Open*; a PR offers *Review*.
 *   - an action the server refuses stays in the menu, disabled, with its reason
 *     on the control.
 *
 * `/api/fleet` and `/api/board` are stubbed at the network boundary — the same
 * way the sibling suites do it — so every claim is about what the tab RENDERS
 * from a pulse, with no child process to race. Route callbacks are SYNCHRONOUS:
 * the board polls on a timer, and an awaited `route.fetch()` can still be in
 * flight when the page closes.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden';

const stuck = (over: Partial<Stuck> = {}): Stuck => ({
  state: 'ci-failing', conflicts: [], localAhead: 0, changedPaths: [],
  failingChecks: [], runHistory: [], ...over,
});

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you', ageMinutes: 30,
  waitingOn: null, note: '', pr: null, branchUrl: '', waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, repair: null, ...over,
});

/**
 * A WAITING ON YOU section with one row of each kind that used to render no
 * menu — a plain PR awaiting review, and a bare branch — plus a failing PR.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    // A PLAIN PR awaiting review — the row the old menu offered nothing on, so
    // it rendered no `⋯` at all. Now it offers Review.
    row({
      branch: 'feature/needs-review', note: 'PR #116 green',
      branchUrl: `${GH}/tree/feature/needs-review`,
      pr: { number: 116, url: `${GH}/pull/116`, draft: false, state: 'green' },
    }),
    // A PR WHOSE CHECKS FAIL — offers Show failure, pointing at the run.
    row({
      branch: 'feature/red-ci', note: 'PR #117 checks failing',
      branchUrl: `${GH}/tree/feature/red-ci`,
      pr: { number: 117, url: `${GH}/pull/117`, draft: false, state: 'failing' },
      stuck: stuck({
        state: 'ci-failing', failingChecks: ['validate'], changedPaths: ['a.ts'],
        runHistory: [{ workflow: 'validate', conclusion: 'failure', startedAt: '10:19', url: `${GH}/actions/runs/2` }],
      }),
    }),
    // A BARE BRANCH with no PR — offers Open.
    row({
      branch: 'feature/orphan', note: 'no PR', branchUrl: `${GH}/tree/feature/orphan`,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 1, waves: 1, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 1, artifact: 0, conflict: 0, unpushed: 0, ci: 1 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

describe('the menu fits the kind, and every row has one', () => {
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

  async function open(payload: Fleet = fleet()): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    // Only the flags this suite reads are stubbed; the contract defaults the
    // rest. Synchronous, for the reason the sibling suite records.
    await page.route('**/api/board', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          columns: [], checklist: [], sprints: [], stories: [],
          dispatch: { available: false, reason: '' },
          approve: { available: false, reason: '' },
          continue: { available: false, reason: '' },
          idea: { available: false, reason: '' },
          commission: { available: false, reason: '' },
          server: { restartCommand: '', port: 0 },
        }),
      }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  const rowFor = (page: Page, branch: string) =>
    page.locator('li[data-agent-row]').filter({ has: page.locator(`[data-branch="${branch}"]`) });
  const menuButton = (page: Page, branch: string) =>
    rowFor(page, branch).locator('[data-row-actions]');

  async function openMenu(page: Page, branch: string): Promise<void> {
    await menuButton(page, branch).waitFor({ timeout: 10_000 });
    await menuButton(page, branch).click();
  }

  it('gives EVERY row in the section a menu — the motivating defect', async () => {
    const page = await open();
    try {
      for (const branch of ['feature/needs-review', 'feature/red-ci', 'feature/orphan']) {
        await expect
          .poll(() => menuButton(page, branch).count(), { timeout: 10_000 })
          .toBe(1);
      }
    } finally {
      await page.close();
    }
  });

  it('offers Review on a PR row and Open on a bare branch', async () => {
    const page = await open();
    try {
      await openMenu(page, 'feature/needs-review');
      await expect
        .poll(() => rowFor(page, 'feature/needs-review').locator('a[data-open-link]').textContent())
        .toBe('Review');

      await openMenu(page, 'feature/orphan');
      await expect
        .poll(() => rowFor(page, 'feature/orphan').locator('a[data-open-link]').textContent())
        .toBe('Open');
    } finally {
      await page.close();
    }
  });

  it('offers Show failure on a PR whose checks fail, pointing at the run', async () => {
    const page = await open();
    try {
      await openMenu(page, 'feature/red-ci');
      const link = rowFor(page, 'feature/red-ci').locator('a[data-stuck-link]');
      await expect.poll(() => link.count()).toBe(1);
      await expect.poll(() => link.textContent()).toBe('Show failure');
      await expect.poll(() => link.getAttribute('href')).toBe(`${GH}/actions/runs/2`);
    } finally {
      await page.close();
    }
  });

  it('opens the menu on a plain PR whose only act is Review — it is not menuless', async () => {
    // The row that MEASURED the defect: green PR, nothing to dispatch, no stuck
    // state. Its menu is enabled (Review is navigation), so a click opens it.
    const page = await open();
    try {
      await openMenu(page, 'feature/needs-review');
      await expect
        .poll(() => rowFor(page, 'feature/needs-review').locator('[role="menu"]').count())
        .toBe(1);
    } finally {
      await page.close();
    }
  });

  it('gives a plain green PR its menu, enabled, though it has no acting item', async () => {
    // THE ROW THAT MEASURED THE DEFECT, in its purest form: a green PR awaiting
    // review, nothing to dispatch, no stuck state, no card. Its one affordance is
    // Review — navigation to the PR — so the menu is present AND enabled (a read
    // is never refused), and it opens. Before this feature the row was menuless.
    const page = await open();
    try {
      const menu = menuButton(page, 'feature/needs-review');
      await expect.poll(() => menu.count(), { timeout: 10_000 }).toBe(1);
      // Enabled: navigation is not an act the server refuses, so the dimmed
      // (aria-disabled) state a refused act would wear is absent here.
      expect(await menu.getAttribute('aria-disabled')).toBeNull();
      await menu.click();
      await expect
        .poll(() => rowFor(page, 'feature/needs-review').locator('[role="menu"]').count())
        .toBe(1);
    } finally {
      await page.close();
    }
  });
});
