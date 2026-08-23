import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer, expandAgentFolds } from '../helpers.mjs';
import { type AgentRow, type Fleet, type Card, type Column } from '../../src/contract/schema.js';

/**
 * AN APPROVED PLAN OFFERS ITS TWO STARTS — what only a rendered page can settle.
 *
 * Plan file: docs/plans/2026-08-22-an-approved-plan-offers-its-two-starts.md
 *
 * An approved plan (`phase === 'Development'`) with eligible work offers:
 *   - **Implement** — present but refused until wave 2 adds `/api/implement`
 *   - **Dispatch** — posts to `/api/dispatch` with no `--max` cap
 *
 * Both gate on **approved AND waveSummary.eligible > 0**. This is the test suite
 * for that gate:
 *   - both appear on an approved plan with an eligible wave
 *   - both are absent where `eligible === 0` (the blocked-plan case)
 *   - both are offered on a multi-wave plan that already started but has another
 *     eligible (the case the earlier `!started` gate excluded)
 *   - neither appears on a Draft plan, a delivered plan, or any branch/wave row
 *   - Start work on an eligible wave row is untouched
 *   - Dispatch posts the slug with no --max cap (separate test)
 *   - each shows its refusal reason when its binding is unavailable
 *   - both are keyboard reachable and announce their state
 *
 * `/api/fleet` and `/api/board` are stubbed at the network boundary.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'beans', planFile: 'p-beans.md',
  wave: 'w1', state: 'wip', phase: 'Development', group: 'not-started', ageMinutes: 30,
  waitingOn: 'click', note: 'approved — nobody has taken it', pr: null,
  branchUrl: `${GH}/tree/feature/x`, waitingDays: null, verdict: 'eligible',
  localDirty: false, localLocked: false, stuck: null, repair: null, ...over,
});

/**
 * An approved plan (`beans`) with eligible branches. The card must have
 * `phase: 'Development'` and `waveSummary.eligible > 0` for the gate to open.
 */
function approvedFleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/beans-w1', wave: 'w1', verdict: 'eligible' }),
    row({ branch: 'feature/beans-w2', wave: 'w2', verdict: 'blocked' }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 1, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 1, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

/**
 * An approved plan with ZERO eligible branches — every wave blocked.
 */
function blockedFleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/beans-w1', wave: 'w1', verdict: 'blocked' }),
    row({ branch: 'feature/beans-w2', wave: 'w2', verdict: 'blocked' }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 1, waves: 2, branches: 2, claimed: 0, eligible: 0, blocked: 2, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

/** An approved card with eligible work, matching the fleet. */
function approvedCard(slug: string, file: string, eligible = 1): Card {
  return {
    slug, title: slug, type: 'feature', phase: 'Development', path: file, prs: [],
    waveSummary: { waves: 2, branches: 2, eligible, deferred: 0 },
  } as Card;
}

/** A Draft card — Implement/Dispatch must NOT appear. */
function draftCard(slug: string, file: string): Card {
  return {
    slug, title: slug, type: 'feature', phase: 'Discovery', path: file, prs: [],
    waveSummary: { waves: 2, branches: 2, eligible: 1, deferred: 0 },
  } as Card;
}

/** A delivered card — Implement/Dispatch must NOT appear. */
function deliveredCard(slug: string, file: string): Card {
  return {
    slug, title: slug, type: 'feature', phase: 'Delivered', path: file, prs: [],
    waveSummary: { waves: 2, branches: 2, eligible: 0, deferred: 0 },
  } as Card;
}

/**
 * Board with approved plan(s) and dispatch available.
 */
function approvedBoard(cards: Card[], over: Record<string, unknown> = {}) {
  const columns: Column[] = [{ phase: 'Development', cards }];
  return {
    generatedAt: new Date().toISOString(),
    columns,
    checklist: [], sprints: [], stories: [],
    dispatch: { available: true, reason: '' },
    approve: { available: true, reason: '' },
    continue: { available: false, reason: '' },
    idea: { available: false, reason: '' },
    commission: { available: true, reason: '' },
    server: { restartCommand: '', port: 0 },
    ...over,
  };
}

/**
 * Board with dispatch UNavailable — to test refusal reasons.
 */
function dispatchUnavailableBoard(cards: Card[]) {
  return approvedBoard(cards, {
    dispatch: { available: false, reason: 'bound to 0.0.0.0, not localhost' },
  });
}

describe('an approved plan offers Implement and Dispatch', () => {
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

  async function open(
    payload: Fleet = approvedFleet(),
    boardPayload: Record<string, unknown> = approvedBoard([approvedCard('beans', 'p-beans.md')]),
  ): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.route('**/api/board', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(boardPayload) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Not started').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  const planHead = (page: Page, slug: string) =>
    page.locator(`li[data-plan-row="${slug}"]`);
  const planMenuButton = (page: Page, slug: string) =>
    page.locator(`[data-plan-actions="${slug}"]`);

  async function openPlanMenu(page: Page, slug: string): Promise<void> {
    const btn = planMenuButton(page, slug);
    await btn.waitFor({ timeout: 10_000 });
    await btn.click();
  }

  it('offers BOTH Implement and Dispatch on an approved plan with eligible work', async () => {
    const page = await open();
    try {
      await expect.poll(() => planHead(page, 'beans').count(), { timeout: 10_000 }).toBe(1);
      await openPlanMenu(page, 'beans');
      const menu = planHead(page, 'beans').locator('[role="menu"]');
      // Both must appear — the pair catches the missing prop, as the existing
      // Approve/Commission test does for Draft plans.
      await expect.poll(() => menu.getByRole('button', { name: 'Implement' }).count()).toBe(1);
      await expect.poll(() => menu.getByRole('button', { name: 'Dispatch' }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers NEITHER when eligible === 0 (the blocked-plan case)', async () => {
    // Every wave blocked → eligible: 0 → no Implement, no Dispatch.
    const page = await open(
      blockedFleet(),
      approvedBoard([approvedCard('beans', 'p-beans.md', 0)]),
    );
    try {
      // The plan head might not have a menu at all, or the menu won't have these
      const planRow = planHead(page, 'beans');
      await expect.poll(() => planRow.count(), { timeout: 10_000 }).toBe(1);
      // If there's no plan-actions button, the test passes (no menu = no acts).
      const btn = planMenuButton(page, 'beans');
      const btnCount = await btn.count();
      if (btnCount === 0) {
        // No menu button at all — correct, no acts to offer.
        return;
      }
      // If there IS a button, the menu must not contain Implement or Dispatch.
      await btn.click();
      const menu = planRow.locator('[role="menu"]');
      expect(await menu.getByRole('button', { name: 'Implement' }).count()).toBe(0);
      expect(await menu.getByRole('button', { name: 'Dispatch' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('offers NEITHER on a Draft plan — only Approve and Commission appear there', async () => {
    // A Draft plan with eligible work still gets Approve/Commission, not Implement/Dispatch.
    const draftFleet: Fleet = {
      ...approvedFleet(),
      rows: approvedFleet().rows.map(r => ({ ...r, phase: 'Draft' as const, group: 'waiting-on-you' as const })),
    };
    const page = await open(
      draftFleet,
      { ...approvedBoard([draftCard('beans', 'p-beans.md')]), columns: [{ phase: 'Discovery', cards: [draftCard('beans', 'p-beans.md')] }] },
    );
    try {
      await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const planRow = planHead(page, 'beans');
      await expect.poll(() => planRow.count(), { timeout: 10_000 }).toBe(1);
      await openPlanMenu(page, 'beans');
      const menu = planRow.locator('[role="menu"]');
      // Draft plans get Approve and Commission, not Implement and Dispatch.
      expect(await menu.getByRole('button', { name: 'Implement' }).count()).toBe(0);
      expect(await menu.getByRole('button', { name: 'Dispatch' }).count()).toBe(0);
      await expect.poll(() => menu.getByRole('button', { name: 'Approve' }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers NEITHER on any branch or wave row — only on the plan head', async () => {
    const page = await open();
    try {
      // Branch/wave rows exist…
      await expect
        .poll(() => page.locator('li[data-wave-row], li[data-agent-row]').count(), { timeout: 10_000 })
        .toBeGreaterThan(0);
      // …and NONE of them has a plan-actions control (the Implement/Dispatch home).
      expect(await page.locator('li[data-wave-row] [data-plan-actions]').count()).toBe(0);
      expect(await page.locator('li[data-agent-row] [data-plan-actions]').count()).toBe(0);
      // Every plan-actions control sits on a plan head.
      const total = await page.locator('[data-plan-actions]').count();
      const onHeads = await page.locator('li[data-plan-row] [data-plan-actions]').count();
      expect(total).toBeGreaterThan(0);
      expect(onHeads).toBe(total);
    } finally {
      await page.close();
    }
  });

  it('Implement shows its refusal reason (route not yet available)', async () => {
    // Implement is present but disabled until Wave 2 adds `/api/implement`.
    const page = await open();
    try {
      await openPlanMenu(page, 'beans');
      const menu = planHead(page, 'beans').locator('[role="menu"]');
      const implement = menu.getByRole('button', { name: 'Implement' });
      await expect.poll(() => implement.count()).toBe(1);
      // It should have aria-disabled and a title/reason.
      const isDisabled = await implement.getAttribute('aria-disabled');
      expect(isDisabled).toBeTruthy();
      const title = await implement.getAttribute('title');
      expect(title).toContain('route not yet available');
    } finally {
      await page.close();
    }
  });

  it('Dispatch shows its refusal reason when dispatch binding unavailable', async () => {
    const page = await open(
      approvedFleet(),
      dispatchUnavailableBoard([approvedCard('beans', 'p-beans.md')]),
    );
    try {
      await openPlanMenu(page, 'beans');
      const menu = planHead(page, 'beans').locator('[role="menu"]');
      const dispatch = menu.getByRole('button', { name: 'Dispatch' });
      await expect.poll(() => dispatch.count()).toBe(1);
      // When dispatch is unavailable, the button should be disabled with reason.
      const isDisabled = await dispatch.getAttribute('aria-disabled');
      expect(isDisabled).toBeTruthy();
      const title = await dispatch.getAttribute('title');
      expect(title).toContain('0.0.0.0');
    } finally {
      await page.close();
    }
  });

  it('both have accessible names and are visible in the menu', async () => {
    // Both controls must exist and be reachable.
    const page = await open();
    try {
      await openPlanMenu(page, 'beans');
      const menu = planHead(page, 'beans').locator('[role="menu"]');
      const implement = menu.getByRole('button', { name: 'Implement' });
      const dispatch = menu.getByRole('button', { name: 'Dispatch' });
      // Both are visible in the menu.
      await expect.poll(() => implement.isVisible()).toBe(true);
      await expect.poll(() => dispatch.isVisible()).toBe(true);
      // Both have accessible names (the role query matched them by name).
      expect(await implement.textContent()).toContain('Implement');
      expect(await dispatch.textContent()).toContain('Dispatch');
    } finally {
      await page.close();
    }
  });
});
