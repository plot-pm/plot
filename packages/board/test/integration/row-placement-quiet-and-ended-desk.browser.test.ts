import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, scenario, row as buildRow, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import { type AgentEntry, type Fleet } from '../../src/contract/schema.js';

/**
 * TWO PLACEMENTS, SEEN. The deciding is in the domain (`quietPlacement`,
 * `endedDeskPlacement`) and unit-tested there; these tests state the input the
 * rule produced and read the screen:
 *
 * - a `quiet` row appears under Quiet and not under Waiting on you (#1758);
 * - a stopped agent whose desk owes nothing is absent from Waiting on you,
 *   while the same agent without the ending reading stays (#1743).
 */
describe('row placement (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const envelope = () => {
    const { agents: _a, summary: _s, rows: _r, ...rest } = scenario('ten-rows-one-kind-each').fleet;
    return rest;
  };

  const group = (page: Page, label: string) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: new RegExp(label) }),
    });

  const open = async (over: Partial<Fleet>): Promise<Page> => {
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: buildFleet({ ...envelope(), ...over }) as Fleet },
    });
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    const toggle = page.locator('[data-group-toggle="quiet"]');
    if (await toggle.count()) {
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
    return page;
  };

  it('shows a quiet-kind row under Quiet, not under Waiting on you', async () => {
    const page = await open({
      rows: [
        buildRow({
          branch: 'feature/nobody-here', plan: 'garden', wave: 'nobody-slice', state: 'wip', group: 'quiet',
          ageMinutes: 60 * 24 * 40, note: 'nobody is on it — last commit 40 days ago', quietKind: 'quiet',
        }),
        buildRow({
          branch: 'feature/left-behind', plan: 'garden', wave: 'left-behind-slice', state: 'wip', group: 'waiting-on-you',
          ageMinutes: 60 * 24 * 126, note: 'commits, no PR ever opened — last commit 126 days ago',
          quietKind: 'abandoned',
        }),
      ],
    });
    try {
      await expect.poll(() => group(page, 'Quiet').locator('[data-branch="feature/nobody-here"]').count()).toBe(1);
      expect(await group(page, 'Waiting on you').locator('[data-branch="feature/nobody-here"]').count()).toBe(0);
      expect(await group(page, 'Waiting on you').locator('[data-branch="feature/left-behind"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  const stopped = (over: Partial<AgentEntry> = {}): AgentEntry => ({
    session: 'sess0001', identity: 'manifest', branch: '', checkout: 'bug/done-slice',
    worktree: '/wt/free-ended', command: '', startedAt: '', pid: '', previousPid: '',
    relaunches: 0, state: 'stalled', ...over,
  });

  it('keeps a stopped agent in Waiting on you when no ending was read', async () => {
    const page = await open({ rows: [], agents: [stopped()] });
    try {
      await expect.poll(() => group(page, 'Waiting on you').locator('[data-agent-row]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('removes a stopped agent whose desk owes nothing from Waiting on you', async () => {
    const page = await open({
      rows: [],
      agents: [stopped({ ended: { owesPerson: false, note: 'ended after 8 h with no slice offered — reaped on the next pass' } })],
    });
    try {
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      expect(await group(page, 'Waiting on you').locator('[data-agent-row]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
