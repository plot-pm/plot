import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * THE DELIVERY TAB'S ROWS — seven columns, one line, links that lead somewhere.
 *
 * The cell values and link targets are asserted without a browser in
 * `packages/domain/test/delivery-row-form.test.ts` and
 * `test/unit/delivery-row-adapter.test.ts`. This file asserts what only a
 * browser shows: that a row is seen in seven cells, that a link scrolls to and
 * marks its target, that the details live behind the popover, and that a
 * 320 px viewport does not scroll sideways.
 */
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Design', group: 'not-started', ageMinutes: null,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, deferredReason: '',
  kind: 'branch' as const,
  ...over,
});

const fleet = (): Fleet => {
  const rows: AgentRow[] = [
    row({
      branch: 'feature/running', branchUrl: `${GH}feature/running`, group: 'working',
      state: 'wip', phase: 'Development', ageMinutes: 90, waitingDays: null,
      processes: [{ pid: '99253', kind: 'worker' }],
    } as Partial<AgentRow>),
    row({ branch: 'feature/queued', branchUrl: `${GH}feature/queued`, wave: 'second' }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    agents: [{
      session: 's-1', branch: 'feature/running', state: 'running', pid: '99253',
      identity: 'manifest', worktree: '/desks/running', relaunches: 0,
      startedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
    }],
    registry: { directory: '/reg', manifestCount: 4, synthesizedCount: 1 },
    issues: [], issueAnswer: 'answered', issueError: null,
    summary: { plans: 1, waves: 2, branches: rows.length, claimed: 1, eligible: 1, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
};

describe('the Delivery tab rows', () => {
  let cat: Catalogue;
  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (width = 1480): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents', over: { fleet: fleet() }, viewport: { width, height: 1200 },
    });
    await page.locator('li[data-delivery-row]').first().waitFor({ timeout: 15_000 });
    await expandAgentFolds(page);
    return page;
  };

  it('renders every row with the seven cells in order', async () => {
    const page = await open();
    try {
      const orders = await page.locator('li[data-delivery-row]').evaluateAll((els) =>
        els.map((e) => [...e.querySelectorAll(':scope > [data-row-cell]')].map((c) => c.getAttribute('data-row-cell'))));
      expect(orders.length).toBeGreaterThan(0);
      for (const o of orders) expect(o).toEqual(['kind', 'item', 'where', 'status', 'do', 'by', 'age']);
    } finally {
      await page.close();
    }
  });

  it('keeps pids and manifest counts inside the details popover', async () => {
    const page = await open();
    try {
      // The facts are on the page, so absence outside the popover is a claim.
      const inside = await page.locator('[data-row-details]').evaluateAll((els) => els.map((e) => e.textContent ?? '').join('\n'));
      expect(inside).toContain('pid 99253');
      expect(inside).toContain('4 manifests');
      const outside = await page.locator('body').evaluate((body) => {
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('[data-row-details]').forEach((n) => n.remove());
        return clone.textContent ?? '';
      });
      expect(outside).not.toContain('pid 99253');
      expect(outside).not.toContain('4 manifests');
    } finally {
      await page.close();
    }
  });

  it('scrolls to the row a link names and marks it', async () => {
    const page = await open();
    try {
      const link = page.locator('li[data-delivery-row] a[data-row-link][href^="#delivery-"]').first();
      await link.waitFor({ timeout: 10_000 });
      const target = (await link.getAttribute('href'))!.slice(1);
      await link.click();
      // The id sits on a zero-height anchor; the row after it is what the reader sees marked.
      await page.locator(`[id="${target}"] + [data-delivery-row][data-link-target]`).waitFor({ timeout: 2_000 });
    } finally {
      await page.close();
    }
  });

  it('does not scroll sideways at 320 px', async () => {
    const page = await open(320);
    try {
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    } finally {
      await page.close();
    }
  });
});
