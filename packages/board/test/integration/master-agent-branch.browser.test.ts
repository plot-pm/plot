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
import { type Page } from 'playwright';
import { type Fleet } from '../../src/contract/schema.js';
import { openCatalogue, board as buildBoard, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';


/** A minimal board payload — needed because the Board tab fetches /api/board. */
// THROUGH THE BUILDER, so the payload is one the schema admits. The literal
// this replaces listed every capability by hand; `board()` defaults them all to
// unavailable, which is what this suite wanted and never had to say.
function boardBody() {
  return buildBoard({ server: { restartCommand: '', port: 0, branch: 'main' } });
}

/** A minimal fleet payload with the fields the Master Agent row needs. */
function fleetBody(masterAgentBranch: string, branchUrlBase = '') {
  return buildFleet({ masterAgentBranch, branchUrlBase });
}

describe('the Agents tab names the master agent branch', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  /**
   * SERVED, NOT INTERCEPTED. Six tests each opened a context and pushed both
   * payloads in with `page.route`, so the board never saw the request and the
   * assertion could only say the client rendered a payload. Naming the state
   * here makes it the board's answer, which is the thing under test.
   */
  const openWith = (fleet: Fleet, tab?: 'agents'): Promise<Page> =>
    cat.open('an-empty-estate', {
      over: { board: boardBody(), fleet },
      ...(tab ? { tab } : {}),
      viewport: { width: 1400, height: 900 },
    });

  /** The locator for the Master Agent row's container. */
  const masterAgentRow = (page: Page) => page.locator('[data-master-agent]');

  it('shows the master agent branch on the Agents tab', async () => {
    const page = await openWith(fleetBody('bug/a-head-counts-its-own-waves'), 'agents');
    try {
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
    const page = await openWith(fleetBody('bug/a-head-counts-its-own-waves'));
    try {
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
    // Empty string means detached HEAD, unreadable repo, or no main checkout.
    const page = await openWith(fleetBody(''), 'agents');
    try {
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
    const page = await openWith(fleetBody('feature/first-branch'), 'agents');
    try {
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });

      // First poll: should show first-branch.
      await expect
        .poll(() => masterAgentRow(page).textContent(), { timeout: 10_000 })
        .toContain('feature/first-branch');

      // A branch switch is the SERVER answering differently, so the mock is
      // re-served rather than the stub re-routed. `unroute` changed what an
      // interceptor returned; this changes what the board says — which is the
      // state transition the test is about.
      cat.mock.serve('an-empty-estate', {
        board: boardBody(),
        fleet: fleetBody('feature/second-branch'),
      });

      // The fleet polls every 4 seconds. Wait and check the row updated.
      await expect
        .poll(() => masterAgentRow(page).textContent(), { timeout: 10_000 })
        .toContain('feature/second-branch');
    } finally {
      await page.close();
    }
  });

  it('renders the branch as a link when branchUrlBase is provided', async () => {
    const urlBase = 'https://github.com/plot-pm/plot/tree/';
    const branch = 'feature/linked-branch';
    const page = await openWith(fleetBody(branch, urlBase), 'agents');
    try {
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
    const branch = 'feature/unlinked-branch';
    const page = await openWith(fleetBody(branch, ''), 'agents');
    try {
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
