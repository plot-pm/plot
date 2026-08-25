// The header NO LONGER names the branch the server serves — in a real browser,
// `server.branch` is NEVER drawn, regardless of whether the server reports one.
//
// The earlier contract (this file until 2026-08-25) asserted the opposite: a
// non-empty `server.branch` appeared in the header. That was withdrawn by
// feature/the-header-names-the-master-agent, because the chip answered the
// wrong question. An operator on `bug/a-head-counts-its-own-waves` read the
// header, saw `main`, and asked why — the chip named the SERVER's checkout,
// not the operator's, but an unlabelled branch name in a header reads as
// "where am I". Two branch names in one header is worse than either alone.
//
// The new answer is `fleet.masterAgentBranch`, rendered on the Agents tab by
// `AgentList.tsx`, naming the MAIN CHECKOUT — where the operator actually
// works. The server's own checkout (`server.branch`) remains in the payload
// and simply has NO render sites: `UnreachableOverlay` reads only
// `restartCommand` and `port`.
//
// `/api/board` is stubbed at the network boundary so `server.branch` is a
// known input. That the SERVER reads its branch from its worktree is pinned
// by `test/unit/branch-served.test.ts` — this test pins the RENDER.
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

describe('server.branch is never rendered in the header', () => {
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

  // The locator that USED to find the branch chip — same selector, now expected
  // to match nothing.
  const branchChip = (page: Page) =>
    page.locator('header span[title="The branch this board is serving from"]');

  it('does NOT show server.branch in the header, even when the server reports one', async () => {
    // Previously this case asserted the chip WAS shown. The contract is
    // reversed: the chip is withdrawn entirely, and the question "which branch
    // is the operator on" is answered by fleet.masterAgentBranch on the Agents
    // tab, not by server.branch in the header.
    const page = await open('feature/the-board-says-which-branch-it-serves');
    try {
      // The heading has rendered (open() waited on it), so a count of 0 is the
      // element genuinely absent, not the page not yet drawn.
      await expect
        .poll(() => branchChip(page).count(), { timeout: 10_000 })
        .toBe(0);
    } finally {
      await page.close();
    }
  });

  it('renders NO branch element when the server reports empty — same absence either way', async () => {
    // Previously the empty case asserted absence too — but for a different
    // reason (detached HEAD). Now both cases assert absence because
    // server.branch is not drawn at all.
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
