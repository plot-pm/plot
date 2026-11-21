import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, row, type Catalogue } from '../catalogue/index.js';
import { type AgentEntry, type Fleet } from '../../src/contract/schema.js';
import { roleChip } from '@plot-pm/domain';

/**
 * A FLEET ROW SHOWS ITS ROLE CHIP — the page shows what the domain computed.
 *
 * The chip's label, colour key and accessible name are asserted in
 * `packages/domain/test/agent-roles.test.ts`; this file proves only that a
 * registry agent's row and a state-file agent's row each print the chip.
 * The fixer's wording is decided in `delivery-row-form.ts` and asserted in
 * `packages/domain/test/delivery-row-form.test.ts`; this file proves a conflict
 * run on a green, review-clean PR prints it.
 */
const agent = (over: Partial<AgentEntry> = {}): AgentEntry => ({
  session: 'sess0000', branch: '', worktree: '/wt/plot-wt-x',
  command: '', startedAt: '', pid: '', previousPid: '', relaunches: 0,
  state: 'running', checkout: '', ...over,
});

const fleet = (agents: AgentEntry[]): Fleet => ({
  agents,
  roleRuns: [
    { id: 'agent:reviewer:7:abcdef1', role: 'reviewer', pr: 7, startedAt: 1 },
    { id: 'agent:fixer:8', role: 'fixer', pr: 8, startedAt: 1, attempt: 1, finding: 'conflict' },
  ],
  generatedAt: new Date().toISOString(),
  ageSeconds: 1,
  ready: true,
  error: null,
  rows: [row({
    branch: 'feature/conflicting', plan: 'conflict-plan', wave: 'Conflict', group: 'waiting-on-you',
    pr: { number: 8, url: 'https://github.com/tiny/garden/pull/8', draft: false, state: 'green', ciChecks: 'green', plotReview: 'success' },
  })],
  summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  prAgeSeconds: 1,
  prNextInSeconds: 59,
  scanNextInSeconds: 4,
  prError: null,
}) as unknown as Fleet;

describe('a Fleet row shows its role chip (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;
  let page: Page;

  beforeAll(async () => {
    cat = await openCatalogue();
    page = await cat.open('an-empty-estate', {
      tab: 'agents',
      route: {
        '**/api/fleet': (route) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet([agent()])) }),
      },
    });
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    const free = page.locator('[data-group-toggle="free"]');
    if (await free.count() > 0 && (await free.getAttribute('aria-expanded')) === 'false') await free.click();
  }, 60_000);
  afterAll(async () => {
    await page?.close();
    await cat?.close();
  });

  it('shows the loop chip on a registry agent row', async () => {
    const chip = page.locator('[data-agent-row] [data-role-chip="loop"]');
    await expect.poll(() => chip.count()).toBe(1);
    expect(await chip.textContent()).toBe(roleChip('loop').label);
  });

  it('shows the reviewer chip on a row read from a state file', async () => {
    const chip = page.locator('[data-role-run="reviewer"] [data-role-chip="reviewer"]');
    await expect.poll(() => chip.count()).toBe(1);
    expect(await chip.getAttribute('aria-label')).toBe(roleChip('reviewer').name);
  });

  it('names a conflict fixer\'s finding on a green, review-clean PR', async () => {
    const doing = page.locator('[data-role-run="fixer"] [data-agent-cell="doing"]');
    await expect.poll(() => doing.count()).toBe(1);
    expect(await doing.textContent()).toContain('fixing conflict ✗ · attempt 1 of 2');
  });
});
