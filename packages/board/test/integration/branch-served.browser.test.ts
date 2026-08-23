// The header names the branch it serves — in a real browser, SHOWN when the
// server reports one and ABSENT when it does not.
//
// The server-side decision (a branch on HEAD is reported, a detached HEAD
// reports empty, the read is memoised off the request path) is pinned without a
// page in `test/unit/branch-served.test.ts` and `test/unit/no-network.test.ts`.
// What only a browser can show is the RENDER: that a non-empty branch appears
// in the header and that an empty one paints NO element — asserted as absence,
// because a happy-path-only test passes an implementation that shows a chip
// reading `unknown` (or a fabricated SHA) forever.
//
// `/api/board` is stubbed at the network boundary so the branch value under
// test is a known input rather than whatever worktree runs the suite — the
// fixture shares the parent repo's `.git`, so its real branch is the branch of
// whoever checked the suite out. That the SERVER reads the branch from its
// worktree is the unit test's assertion, not this one. Route callbacks are
// SYNCHRONOUS: an awaited callback fails tests that already passed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

/** A minimal board payload; only `server.branch` varies between cases. */
function boardBody(branch: string): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    columns: [], checklist: [], sprints: [], stories: [],
    dispatch: { available: false, reason: '' },
    approve: { available: false, reason: '' },
    continue: { available: false, reason: '' },
    idea: { available: false, reason: '' },
    commission: { available: false, reason: '' },
    server: { restartCommand: '', port: 0, branch },
  });
}

describe('the board header names the branch it serves', () => {
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

  async function open(branch: string): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await page.route('**/api/board', (route) =>
      route.fulfill({ contentType: 'application/json', body: boardBody(branch) }));
    await page.goto(baseURL);
    // The header's own title is always present; waiting on it means the header
    // has rendered before either assertion reads it.
    await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
    return page;
  }

  const branchChip = (page: Page) =>
    page.locator('header span[title="The branch this board is serving from"]');

  it('shows the reported branch in the header', async () => {
    const page = await open('feature/the-board-says-which-branch-it-serves');
    try {
      await expect
        .poll(() => branchChip(page).count(), { timeout: 10_000 })
        .toBe(1);
      expect(await branchChip(page).textContent())
        .toBe('feature/the-board-says-which-branch-it-serves');
    } finally {
      await page.close();
    }
  });

  it('renders NO branch element when the server reports empty — absence, not a placeholder', async () => {
    // The detached-HEAD case as the reader sees it. `''` means detached or
    // unreadable, and the header shows nothing rather than a word that reads as
    // a branch name. The heading has rendered (open() waited on it), so a count
    // of 0 is the element genuinely absent, not the page not yet drawn.
    const page = await open('');
    try {
      await expect
        .poll(() => branchChip(page).count(), { timeout: 10_000 })
        .toBe(0);
    } finally {
      await page.close();
    }
  });
});
