import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, board as buildBoard, type Catalogue } from '../catalogue/index.js';
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
    registry: { directory: '/reg', manifestCount: 4, synthesizedCount: 1, checkoutCount: 0, unreadCount: 0 },
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
      for (const o of orders) expect(o).toEqual(['kind', 'item', 'where', 'status', 'by', 'age', 'do']);
    } finally {
      await page.close();
    }
  });

  it('keeps pids inside the details popover and states the registry as one fact', async () => {
    const page = await open();
    try {
      // The facts are on the page, so absence outside the popover is a claim.
      const inside = await page.locator('[data-row-details]').evaluateAll((els) => els.map((e) => e.textContent ?? '').join('\n'));
      expect(inside).toContain('pid 99253');
      expect(await page.locator('[data-fleet-registry-fact]').innerText()).toContain('1 of 5 agents has no registry file');
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
      // The id sits on a zero-height anchor; the row after it, a work item's or an agent's, is what the reader sees marked.
      await page.locator(`[id="${target}"] + [role="row"][data-link-target]`).waitFor({ timeout: 2_000 });
    } finally {
      await page.close();
    }
  });

  /** Opens the tab with `over` merged into the fleet, read by the host user `gardener`, and waits for a You row. */
  const openYou = async (over: Partial<Fleet>): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: {
        fleet: { ...fleet(), ...over } as Fleet,
        board: buildBoard({ server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: 'gardener', people: { gardener: 'gardener' } } }),
      },
      viewport: { width: 1480, height: 1200 },
    });
    await page.locator('[data-section="you"] li[data-delivery-row]').first().waitFor({ timeout: 15_000 });
    return page;
  };

  it('ends the You rows with a triage link to the tickets assigned to the reader that no plan names', async () => {
    const mine = (n: number) => ({
      kind: 'ticket', number: String(n), title: `Mine ${n}`, url: '', ageMinutes: n, status: 'open', statusCategory: 'To Do', assignees: ['gardener'],
    });
    const tickets = [mine(1), mine(2)];
    const page = await openYou({
      issueAnswer: 'answered', issues: tickets,
      waiting: { tickets, shown: 2, hidden: 0, unassigned: 0, assignedToOthers: 0, complete: true, notice: null, source: { service: 'github', match: 'host-login' } },
    } as unknown as Partial<Fleet>);
    try {
      const footer = page.locator('[data-section="you"] [data-you-footer="triage"]');
      await footer.waitFor({ timeout: 10_000 });
      expect(await footer.innerText()).toContain('2 tickets assigned to you have no plan');
      await footer.locator('button[data-you-triage]').click();
      await expect.poll(() => page.evaluate(() => {
        const t = document.getElementById('tickets')?.getBoundingClientRect().top ?? Infinity;
        return t >= -1 && t < window.innerHeight;
      })).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('states the unread tracker under the You rows while You still holds rows', async () => {
    const page = await openYou({ issueAnswer: 'failed', issues: [], issueError: 'gh: 503 Service Unavailable' } as unknown as Partial<Fleet>);
    try {
      const footer = page.locator('[data-section="you"] [data-you-footer="unread"]');
      await footer.waitFor({ timeout: 10_000 });
      expect(await footer.locator('[data-you-footer-sentence]').innerText()).toBe('The tracker gave no answer.');
      expect(await page.locator('[data-section="you"] li[data-delivery-row]').count()).toBeGreaterThan(0);
      expect(await page.locator('[data-you-footer="triage"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

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
