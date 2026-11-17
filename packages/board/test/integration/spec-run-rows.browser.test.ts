import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, scenario, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * THE FLEET ROW of a design or verify run.
 *
 * `/api/fleet` has carried `design` since `the-fleet-reads-design-work` and
 * nothing under `packages/board/src/app` read it. This is the browser half of
 * the plan's Acceptance entry: a payload with one going and one failed spec
 * run shows the going row in *Working* and the failed row with its restart
 * command in *Waiting on you*. The unit half (`specRows` itself) is
 * `test/unit/spec-row.test.ts`.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const base = scenario('ten-rows-one-kind-each');
  const { agents: _a, summary: _s, rows: _r, ...envelope } = base.fleet;
  return buildFleet({ ...envelope, rows: base.fleet.rows, ...over } as Partial<Fleet>);
}

describe('tiny-garden: the board shows the spec run (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  async function openAgents(payload: Fleet): Promise<Page> {
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents', over: { fleet: payload },
    });
    await page.locator('[data-delivery-section="you"]').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  /** A design or verify run is a Fleet row with its role chip. */
  const runRow = (page: Page, role: string, plan: string) =>
    page.locator(`[data-role-run="${role}"]`).filter({ hasText: plan });

  it('shows a going design run, a failed one and a verify run once each in Fleet, with the restart command and log', async () => {
    const stopped = {
      reason: 'the spec run failed 3 times; the fleet stopped retrying this plan',
      restart: 'plot-design.mjs restart plant-tomatoes',
      log: '/r/.plot/logs/plot-design-plant-tomatoes.log',
    };
    const page = await openAgents(fleet({
      roleRuns: [
        { id: 'agent:design:beans', role: 'design', plan: 'beans', startedAt: null },
        { id: 'agent:design:plant-tomatoes', role: 'design', plan: 'plant-tomatoes', startedAt: null, stopped },
        { id: 'agent:verify:leeks', role: 'verify', plan: 'leeks', startedAt: null },
      ],
    }));
    try {
      await expect.poll(() => page.locator('[data-role-run="design"] [data-role-chip="design"]').count()).toBe(2);
      await expect.poll(() => page.locator('[data-role-run="verify"] [data-role-chip="verify"]').count()).toBe(1);

      const failedRow = page.locator('[data-role-run="design"]').filter({ has: page.locator('[data-plan-level-restart]') });
      expect(await failedRow.count()).toBe(1);
      expect(await failedRow.locator('[data-plan-level-restart]').textContent()).toBe(stopped.restart);
      expect(await failedRow.locator('[data-plan-level-log]').textContent()).toBe(stopped.log);

      // No Plan runs section and no plan-level row remain.
      expect(await page.locator('[data-plan-level-row]').count()).toBe(0);
      expect(await page.getByRole('heading', { level: 2, name: 'Plan runs' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('renders no Plan runs heading and no empty list where no run and no halted line exist', async () => {
    const page = await openAgents(fleet({ design: null, verification: null, roleRuns: [] }));
    try {
      expect(await page.getByRole('heading', { level: 2, name: 'Plan runs' }).count()).toBe(0);
      expect(await page.locator('section[data-outside-rule]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
