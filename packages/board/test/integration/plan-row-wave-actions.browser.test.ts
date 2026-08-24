import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer, expandAgentFolds } from '../helpers.mjs';
import { type AgentRow, type Fleet, type Wave } from '../../src/contract/schema.js';

/**
 * WHERE A WAVE ROW IS HIDDEN, ITS CONTROL IS NOT — the half a rendered page
 * settles for `the-plan-row-carries-wave-actions`.
 *
 * `one-wave-renders-as-its-plan` (PR #360) removed the wave row for a plan that
 * declares exactly one wave: the plan row now carries the wave's VERDICT. But a
 * wave row also carried an ACTION — *Start work*, the wave's own control,
 * dispatching that single wave. Hiding the row must not hide the control.
 *
 * So a one-wave ELIGIBLE plan's row offers *Start work* (the `WaveActions` `⋯`,
 * `data-wave-actions`), exactly as its hidden wave row would have. A MULTI-wave
 * plan's row does NOT — its wave rows still render and still carry their own,
 * and a plan-row control would have to guess which wave it meant.
 *
 * This is the ADDITIONAL half of the plan: the plan-level acts Approve and
 * Commission (`data-plan-actions`, from PR #313's boundary) are unaffected by
 * the wave count — they reach the plan row whatever it is. `Start work` is a
 * wave act that rides ALONGSIDE them where there is one wave to act on.
 *
 * `/api/fleet` and `/api/board` are stubbed at the network boundary, the sibling
 * suites' pattern. Route callbacks are SYNCHRONOUS: the board polls on a timer
 * and an awaited `route.fetch()` can still be in flight when the page closes.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'beans', planFile: 'p-beans.md',
  wave: 'w1', state: 'open', phase: 'Approved', group: 'not-started', ageMinutes: null,
  waitingOn: 'click', note: 'approved — nobody has taken it', pr: null,
  branchUrl: `${GH}/tree/feature/x`, waitingDays: 1, verdict: 'eligible',
  localDirty: false, localLocked: false, stuck: null, repair: null, ...over,
});

const wave = (over: Partial<Wave> = {}): Wave => ({
  plan: 'beans', name: 'w1', branches: [], verdict: 'eligible',
  section: 'not-started', complete: false, planWaveCount: 2, ...over,
});

/**
 * Two Approved plans in NOT STARTED:
 *   - `beans` declares ONE wave (`planWaveCount: 1`) — its wave row is hidden and
 *     the plan row carries the wave's verdict AND its *Start work*.
 *   - `peas` declares TWO waves — its wave rows render and carry their own
 *     controls, so the plan row must NOT offer *Start work*.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/beans-only', plan: 'beans', planFile: 'p-beans.md', wave: 'Solo' }),
    row({ branch: 'feature/peas-a', plan: 'peas', planFile: 'p-peas.md', wave: 'First',
      branchUrl: `${GH}/tree/feature/peas-a` }),
    row({ branch: 'feature/peas-b', plan: 'peas', planFile: 'p-peas.md', wave: 'Second',
      verdict: 'blocked', waitingOn: 'time', branchUrl: `${GH}/tree/feature/peas-b` }),
  ];
  const waves: Wave[] = [
    // ONE wave — the plan row must carry Start work.
    wave({ plan: 'beans', name: 'Solo', branches: ['feature/beans-only'], planWaveCount: 1 }),
    // TWO waves — the wave rows carry their own; the plan row must not.
    wave({ plan: 'peas', name: 'First', branches: ['feature/peas-a'], planWaveCount: 2 }),
    wave({ plan: 'peas', name: 'Second', branches: ['feature/peas-b'],
      verdict: 'blocked', planWaveCount: 2 }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows, waves,
    summary: { plans: 2, waves: 3, branches: rows.length, claimed: 0, eligible: 2, blocked: 1, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

/** An Approved card for a plan, matched to a fleet row by `path` basename. */
function approvedCard(slug: string, file: string) {
  return {
    slug, title: slug, type: 'feature', phase: 'Approved', path: file, prs: [],
  };
}

/**
 * The board a stub answers with. `dispatch` is available so a *Start work*
 * control is enabled; the cards are Approved (not Draft), so the plan head does
 * NOT offer Approve/Commission — this suite is about the WAVE act, and keeping
 * the draft acts off keeps the two questions apart.
 */
function board(over: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    columns: [{ phase: 'Approved', cards: [approvedCard('beans', 'p-beans.md'), approvedCard('peas', 'p-peas.md')] }],
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

describe('the plan row carries the sole wave’s actions', () => {
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
    payload: Fleet = fleet(),
    boardPayload: Record<string, unknown> = board(),
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

  const planRow = (page: Page, slug: string) =>
    page.locator(`li[data-plan-row="${slug}"]`);

  it('offers Start work on a one-wave plan’s row — the hidden wave row’s control', async () => {
    // `beans` declares one wave, so its wave row is gone and the plan row is the
    // only place its *Start work* can live. `WaveActions` marks itself with
    // `data-wave-actions`, so the control's presence ON the plan row is the claim.
    const page = await open();
    try {
      await expect.poll(() => planRow(page, 'beans').count(), { timeout: 10_000 }).toBe(1);
      // The wave row is hidden…
      expect(await page.locator('li[data-wave-row="Solo"]').count()).toBe(0);
      // …and its Start-work control rode onto the plan row.
      const control = planRow(page, 'beans').locator('[data-wave-actions]');
      await expect.poll(() => control.count()).toBe(1);
      await control.click();
      const menu = planRow(page, 'beans').locator('[role="menu"]');
      await expect.poll(() => menu.getByRole('button', { name: /Start work/ }).count())
        .toBeGreaterThanOrEqual(1);
    } finally {
      await page.close();
    }
  });

  it('does NOT offer Start work on a multi-wave plan’s row — its wave rows keep their own', async () => {
    // `peas` declares two waves, so its wave rows render and carry their own
    // controls. A plan-row *Start work* would have to guess which wave it meant,
    // so the plan row offers none.
    const page = await open();
    try {
      await expect.poll(() => planRow(page, 'peas').count(), { timeout: 10_000 }).toBe(1);
      // The wave rows are present…
      await expect.poll(() => page.locator('li[data-wave-row="First"]').count()).toBe(1);
      // …but the plan row carries no wave control.
      expect(await planRow(page, 'peas').locator('[data-wave-actions]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('leaves the eligible wave row’s own Start work in place where a wave row still renders', async () => {
    // `peas`'s first wave is eligible, so its wave row keeps its `WaveActions`
    // control — hiding a plan's sole-wave control must not touch a real wave row.
    const page = await open();
    try {
      const firstWave = page.locator('li[data-wave-row="First"]');
      await expect.poll(() => firstWave.locator('[data-wave-actions]').count(), { timeout: 10_000 })
        .toBe(1);
    } finally {
      await page.close();
    }
  });
});
