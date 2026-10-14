import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, scenario, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * THE BOARD ROW for a spec run — `the-board-shows-the-spec-run`.
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
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  const group = (page: Page, label: string) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: new RegExp(label) }),
    });

  it('shows a going spec run in Working and a failed one in Waiting on you, with its restart command', async () => {
    const page = await openAgents(fleet({
      design: {
        halted: false,
        running: ['beans'],
        refusals: {},
        rows: [{
          // The domain also writes an empty row for a going plan.
          kind: 'spec', plan: 'beans', reason: '', log: '', restart: '', stopped: false, halted: false,
        }, {
          kind: 'spec',
          plan: 'plant-tomatoes',
          reason: 'the spec run failed 3 times; the fleet stopped retrying this plan',
          log: '/r/.plot/logs/plot-design-plant-tomatoes.log',
          restart: 'plot-design.mjs restart plant-tomatoes',
          stopped: true,
          halted: false,
        }],
      },
    }));
    try {
      const working = group(page, 'Working');
      const runningRow = working.locator('[data-plan-level-row="beans"]');
      await expect.poll(() => runningRow.count()).toBe(1);
      expect(await runningRow.locator('[data-plan-level-reason]').textContent())
        .toBe('spec run running');
      expect(await runningRow.locator('[data-plan-level-restart]').count()).toBe(0);

      const waiting = group(page, 'Waiting on you');
      expect(await waiting.locator('[data-plan-level-row="beans"]').count()).toBe(0);
      const failedRow = waiting.locator('[data-plan-level-row="plant-tomatoes"]');
      await expect.poll(() => failedRow.count()).toBe(1);
      expect(await failedRow.locator('[data-plan-level-restart]').textContent())
        .toBe('plot-design.mjs restart plant-tomatoes');
      expect(await failedRow.locator('[data-plan-level-log]').textContent())
        .toBe('/r/.plot/logs/plot-design-plant-tomatoes.log');
    } finally {
      await page.close();
    }
  });
});
