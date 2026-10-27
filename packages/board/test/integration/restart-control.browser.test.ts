// The Restart control, in a real browser against the shipped artifact.
//
// Which worker states offer it is the domain's answer (`restartOffered`,
// asserted in `packages/domain/test/restart-offer.test.ts`). This file proves
// the answer is SEEN: the button shows for a dead worker, posts the branch to
// `/api/restart`, and does not show for a running one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, type Catalogue } from '../catalogue/index.js';
import type { AgentRow, Fleet } from '../../src/contract/schema.js';
import { expandAgentFolds } from '../helpers.mjs';

const BRANCH = 'feature/talks';

const row = (): AgentRow => ({
  repo: 'plot', branch: BRANCH, plan: 'a-plan',
  planFile: '2026-08-16-a-plan.md', wave: 'Log', state: 'wip', phase: null,
  group: 'working', ageMinutes: 3, note: 'claimed', pr: null, branchUrl: '',
  waitingDays: null, localDirty: false, localLocked: false, localAhead: 0,
  waitingOn: null, blockedBy: null, stuck: null,
}) as AgentRow;

const fleet = (): Fleet => ({
  generatedAt: new Date().toISOString(),
  ageSeconds: 1, readRef: 'abc', readRefAge: 1, localHead: 'abc',
  ready: true, error: null, shrink: null, rows: [row()],
  agents: [{
    session: `s-${BRANCH}`, branch: BRANCH, worktree: '/tmp/wt',
    command: '', startedAt: '', pid: '', previousPid: '', relaunches: 0,
    state: 'running' as const,
  }],
  summary: { plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0 },
  stuck: null, prAgeSeconds: null, prNextInSeconds: 0,
  scanNextInSeconds: 5, prError: null,
}) as unknown as Fleet;

describe('the Restart control on a worker log panel', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  /** The panel for a worker in the given state; every payload is stubbed at the network boundary. */
  const open = async (worker: string, posted: unknown[] = []): Promise<Page> => {
    const page = await cat.browser.newPage();
    await page.route('**/api/fleet', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.route('**/api/board*', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(buildBoard({ restart: { available: true, reason: '' } })),
      }));
    await page.route('**/api/worker-log*', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true, branch: BRANCH, path: '/tmp/wt/.plot-worker.log', text: 'it stopped\n',
          bytes: 11, truncated: false, modifiedAt: new Date().toISOString(),
        }),
      }));
    // The panel's `worker` word is what the offer reads; the log reply carries none.
    await page.route('**/api/agent-panel*', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true, branch: BRANCH, worktree: '/tmp/wt', plan: 'a-plan', wave: 'Log', worker,
          pid: '', uptimeSeconds: null, command: '',
        }),
      }));
    await page.route('**/api/restart', (r) => {
      posted.push(r.request().postDataJSON());
      return r.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, branch: BRANCH, pid: '5150', previousPid: '4242', log: '/tmp/wt/.plot-worker.log' }),
      });
    });
    await page.goto(`${cat.mock.baseURL}?tab=agents`);
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    await page.locator('[data-row-actions]').first().click();
    await page.locator('[data-worker-log-open]').first().click();
    await page.locator('[data-worker-log]').waitFor({ timeout: 5_000 });
    await expect
      .poll(() => page.locator('[data-log-body]').innerText(), { timeout: 5_000 })
      .not.toMatch(/^Loading…$/);
    return page;
  };

  it('shows Restart for a failed worker and posts the branch', async () => {
    const posted: unknown[] = [];
    const page = await open('failed', posted);
    try {
      const button = page.locator('[data-restart-send]');
      await button.waitFor({ timeout: 5_000 });
      await button.click();
      await page.locator('[data-restart-started]').waitFor({ timeout: 5_000 });
      expect(await page.locator('[data-restart-started]').innerText()).toContain('pid 5150');
      expect(posted).toEqual([{ branch: BRANCH }]);
    } finally {
      await page.close();
    }
  });

  it('shows no Restart for a running worker', async () => {
    const page = await open('running');
    try {
      expect(await page.locator('[data-restart]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
