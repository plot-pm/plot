import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { type AgentEntry, type Fleet } from '../../src/contract/schema.js';
import { unnamedDeskLabel } from '@plot-pm/domain/rules/desk-manifest';

/**
 * A DESK WITH NO MANIFEST SAYS SO — `a-desk-and-its-manifest-name-each-other`,
 * slice 4, driven in a REAL browser against the shipped artifact.
 *
 * `#1101`: a synthesized entry carried `branch: wt.branch`, so its row read as
 * an agent WORKING that branch — the desk's checkout, not an assignment from
 * the registry. `synthesizeEntry` now sets `branch: ''` and `checkout:
 * wt.branch`, and the row prints `unnamedDeskLabel`'s words instead of naming
 * the checkout as if it were the agent's own branch.
 *
 * THE WORDS COME FROM THE RULE, SEEDED HERE RATHER THAN LITERAL, so a
 * reworded label does not break this test — `desk-manifest.test.ts` owns what
 * the words are, and this file owns only that the row prints them and keeps
 * the checkout out of the name, the link and the id.
 */
const agent = (over: Partial<AgentEntry> = {}): AgentEntry => ({
  session: 'sess0000', branch: 'feature/x', worktree: '/wt/plot-wt-x',
  command: '', startedAt: '', pid: '', previousPid: '', relaunches: 0,
  state: 'running', checkout: '', ...over,
});

function fleet(agents: AgentEntry[]): Fleet {
  return {
    agents,
    generatedAt: new Date().toISOString(),
    ageSeconds: 1,
    ready: true,
    error: null,
    rows: [],
    summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    prAgeSeconds: 1,
    prNextInSeconds: 59,
    scanNextInSeconds: 4,
    prError: null,
  } as Fleet;
}

describe('a desk no manifest names (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  async function open(payload: Fleet): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      route: {
        '**/api/fleet': (route) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }),
      },
    });
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    return page;
  }

  it('shows the label, keeps the checkout out of the name, link and id', async () => {
    const synthesized = agent({
      session: '', identity: 'synthesized', branch: '', checkout: 'bug/x',
      worktree: '/wt/plot-wt-bug-x', state: 'running',
    });
    const page = await open(fleet([synthesized]));
    try {
      const row = page.locator('[data-agent-row][data-agent-undeclared]');
      await expect.poll(() => row.count()).toBe(1);

      // THE LABEL IS THE RULE'S WORDS, seeded from the rule's own output.
      const label = unnamedDeskLabel({ checkout: 'bug/x', live: true });
      const note = row.locator('[data-row-note]');
      await expect.poll(() => note.count()).toBe(1);
      expect(await note.textContent()).toContain(label);

      // `bug/x` APPEARS ONLY INSIDE THAT DETAIL — never as the row's name, its
      // link, or its id. The row has no branch (synthesized entries never do),
      // so it carries no `agent-row-<branch>` id at all — the worktree names
      // it instead.
      expect(await row.getAttribute('id')).toBeNull();
      expect(await row.locator('[data-branch="bug/x"]').count()).toBe(0);
      expect(await row.locator('a[href*="bug/x"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('names the desk idle when its process is not live', async () => {
    const synthesized = agent({
      session: '', identity: 'synthesized', branch: '', checkout: 'bug/y',
      worktree: '/wt/plot-wt-bug-y', state: 'stalled',
    });
    const page = await open(fleet([synthesized]));
    try {
      const row = page.locator('[data-agent-row][data-agent-undeclared]');
      await expect.poll(() => row.count()).toBe(1);
      const label = unnamedDeskLabel({ checkout: 'bug/y', live: false });
      const note = row.locator('[data-row-note]');
      await expect.poll(() => note.count()).toBe(1);
      expect(await note.textContent()).toContain(label);
    } finally {
      await page.close();
    }
  });

  it('omits the checkout clause for a desk between slices, holding no branch', async () => {
    const synthesized = agent({
      session: '', identity: 'synthesized', branch: '', checkout: '',
      worktree: '/wt/plot-wt-bare', state: 'running',
    });
    const page = await open(fleet([synthesized]));
    try {
      const row = page.locator('[data-agent-row][data-agent-undeclared]');
      await expect.poll(() => row.count()).toBe(1);
      const label = unnamedDeskLabel({ checkout: '', live: true });
      const note = row.locator('[data-row-note]');
      await expect.poll(() => note.count()).toBe(1);
      expect(await note.textContent()).toBe(label);
    } finally {
      await page.close();
    }
  });

  it('a manifest-backed row never carries the label', async () => {
    const declared = agent({ session: 'declar01', branch: 'feature/working-a', identity: 'manifest' });
    const page = await open(fleet([declared]));
    try {
      const row = page.locator('[data-agent-row]').first();
      await expect.poll(() => row.count()).toBe(1);
      expect(await row.locator('[data-agent-undeclared]').count()).toBe(0);
      expect(await row.locator('[data-row-note]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
