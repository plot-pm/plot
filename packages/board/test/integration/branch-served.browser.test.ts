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
// The state is SERVED BY NAME rather than read from a repo, so `server.branch`
// is a stated input and no board process starts. That the SERVER reads its
// branch from its worktree is pinned by `test/unit/branch-served.test.ts` —
// this test pins the RENDER.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from 'playwright';
import { openCatalogue, board, type Catalogue } from '../catalogue/index.js';

describe('server.branch is never rendered in the header', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  /**
   * An empty board whose ONLY interesting field is `server.branch`.
   *
   * `an-empty-estate` carries no cards, which is what this subject wants: the
   * claim is about the HEADER, and cards would only add rows nothing here
   * reads. The override is one field deep — the catalogue's `board()` states
   * the rest of `server` the way a real one does.
   */
  const open = async (branch: string): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      over: { board: board({ server: { restartCommand: 'pnpm board', port: 4711, branch, repo: 'garden' } }) },
    });
    // The header's own title is always present; waiting on it means the header
    // has rendered before either assertion reads it.
    await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
    return page;
  };

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
