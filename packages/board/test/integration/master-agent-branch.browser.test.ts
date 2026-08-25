// The Agents tab names the branch the MAIN CHECKOUT is on — not the server's
// checkout, which is what the header chip used to name.
//
// This test stubs `/api/fleet` to control `masterAgentBranch` and
// `branchUrlBase`, then asserts:
//
// 1. The row appears on the Agents tab with the stubbed branch name.
// 2. The row is ABSENT on the Board tab — it is not part of the header.
// 3. An empty `masterAgentBranch` renders NO row, not a placeholder.
// 4. The row follows a branch switch across two polls.
// 5. The branch is a link when `branchUrlBase` is non-empty.
//
// The server-side derivation (that `masterAgentBranch` names the main checkout,
// not the server's worktree) is tested in unit tests. This test pins the
// RENDER.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

/** A minimal board payload — needed because the Board tab fetches /api/board. */
function boardBody(): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    columns: [], checklist: [], sprints: [], stories: [],
    dispatch: { available: false, reason: '' },
    approve: { available: false, reason: '' },
    continue: { available: false, reason: '' },
    idea: { available: false, reason: '' },
    commission: { available: false, reason: '' },
    server: { restartCommand: '', port: 0, branch: 'main' },
  });
}

/** A minimal fleet payload with the fields the Master Agent row needs. */
function fleetBody(masterAgentBranch: string, branchUrlBase = ''): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    ageSeconds: 0,
    ready: true,
    complete: true,
    error: null,
    shrink: null,
    rows: [],
    waves: [],
    summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: null,
    prError: null,
    issues: [],
    issueAnswer: 'unsupported',
    agents: [],
    sprints: [],
    estateTotals: { total: 0, open: 0, wip: 0, done: 0 },
    masterAgentBranch,
    branchUrlBase,
  });
}

describe('the Agents tab names the master agent branch', () => {
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

  /** The locator for the Master Agent row's container. */
  const masterAgentRow = (page: Page) => page.locator('[data-master-agent]');

  it('shows the master agent branch on the Agents tab', async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    try {
      await page.route('**/api/board', (route) =>
        route.fulfill({ contentType: 'application/json', body: boardBody() }));
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: fleetBody('bug/a-head-counts-its-own-waves') }));

      // Go to the Agents tab directly.
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });

      // The Master Agent row should be visible.
      await expect
        .poll(() => masterAgentRow(page).count(), { timeout: 10_000 })
        .toBe(1);

      // And it should name the branch.
      expect(await masterAgentRow(page).textContent())
        .toContain('bug/a-head-counts-its-own-waves');
    } finally {
      await page.close();
    }
  });

  it('does NOT show the master agent row on the Board tab', async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    try {
      await page.route('**/api/board', (route) =>
        route.fulfill({ contentType: 'application/json', body: boardBody() }));
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: fleetBody('bug/a-head-counts-its-own-waves') }));

      // Start on the Board tab (the default).
      await page.goto(baseURL);
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });

      // Wait a moment for the board to render fully.
      await page.waitForTimeout(500);

      // The Master Agent row should NOT be present on the Board tab.
      expect(await masterAgentRow(page).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('renders NO row when masterAgentBranch is empty', async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    try {
      // Empty string means detached HEAD, unreadable repo, or no main checkout.
      await page.route('**/api/board', (route) =>
        route.fulfill({ contentType: 'application/json', body: boardBody() }));
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: fleetBody('') }));

      await page.goto(`${baseURL}?tab=agents`);
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });

      // Wait a moment for the fleet to render.
      await page.waitForTimeout(500);

      // No row, not a placeholder.
      expect(await masterAgentRow(page).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('follows a branch switch across two polls', async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    try {
      let branchName = 'feature/first-branch';

      await page.route('**/api/board', (route) =>
        route.fulfill({ contentType: 'application/json', body: boardBody() }));
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: fleetBody(branchName) }));

      await page.goto(`${baseURL}?tab=agents`);
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });

      // First poll: should show first-branch.
      await expect
        .poll(() => masterAgentRow(page).textContent(), { timeout: 10_000 })
        .toContain('feature/first-branch');

      // Simulate a branch switch by changing what the route returns.
      branchName = 'feature/second-branch';
      await page.unroute('**/api/fleet');
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: fleetBody(branchName) }));

      // The fleet polls every 4 seconds. Wait and check the row updated.
      await expect
        .poll(() => masterAgentRow(page).textContent(), { timeout: 10_000 })
        .toContain('feature/second-branch');
    } finally {
      await page.close();
    }
  });

  it('renders the branch as a link when branchUrlBase is provided', async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    try {
      const urlBase = 'https://github.com/plot-pm/plot/tree/';
      const branch = 'feature/linked-branch';

      await page.route('**/api/board', (route) =>
        route.fulfill({ contentType: 'application/json', body: boardBody() }));
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: fleetBody(branch, urlBase) }));

      await page.goto(`${baseURL}?tab=agents`);
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });

      // The row should be visible.
      await expect
        .poll(() => masterAgentRow(page).count(), { timeout: 10_000 })
        .toBe(1);

      // The branch should be a link.
      const link = masterAgentRow(page).locator('a');
      expect(await link.count()).toBe(1);
      expect(await link.getAttribute('href'))
        .toBe(`${urlBase}${encodeURIComponent(branch)}`);
      expect(await link.textContent()).toBe(branch);
    } finally {
      await page.close();
    }
  });

  it('renders the branch as plain text when branchUrlBase is empty', async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    try {
      const branch = 'feature/unlinked-branch';

      await page.route('**/api/board', (route) =>
        route.fulfill({ contentType: 'application/json', body: boardBody() }));
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: fleetBody(branch, '') }));

      await page.goto(`${baseURL}?tab=agents`);
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });

      // The row should be visible.
      await expect
        .poll(() => masterAgentRow(page).count(), { timeout: 10_000 })
        .toBe(1);

      // No link — the branch is plain text.
      const link = masterAgentRow(page).locator('a');
      expect(await link.count()).toBe(0);

      // But the branch name is still rendered.
      expect(await masterAgentRow(page).textContent()).toContain(branch);
    } finally {
      await page.close();
    }
  });
});
