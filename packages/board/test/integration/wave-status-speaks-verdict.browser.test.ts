import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { type AgentRow, type Fleet, type Wave } from '../../src/contract/schema.js';

/**
 * A WAVE ROW SPEAKS ITS OWN VERDICT — the STATUS slot uses the verdict word.
 *
 * Before this fix, a multi-branch wave in DONE showed `6 delivered` because
 * `groupedWord` was chosen by section (`done` → `delivered`). But the wave's
 * own verdict is `complete`, and using a section-chosen word meant different
 * sections used different words for the same verdict.
 *
 * The fix: `groupedWord` now reads from `wg.verdict`, so a multi-branch wave
 * shows `6 complete` — the verdict itself, consistent across all sections.
 *
 * Branch rows (item 6) still show `delivered` for merged refs — that comes from
 * `stateStatus`, which is unchanged. Single-branch waves inherit their branch's
 * status via `soleStatus`, per the #323 fix.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'merged', phase: 'Approved', group: 'done', ageMinutes: 10,
  waitingOn: null, note: '', pr: null, branchUrl: '', waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, repair: null,
  ...over,
});

const wave = (over: Partial<Wave> = {}): Wave => ({
  plan: 'a-plan', name: 'w', section: 'done',
  ...over,
});

function fleet(): Fleet {
  // A DONE wave with two merged branches — verdict `complete`.
  // The status slot must show `2 complete`, not `2 delivered`.
  const rows: AgentRow[] = [
    row({
      plan: 'six-waves', planFile: '2026-08-24-six-waves.md',
      branch: 'feature/done-one', wave: 'Complete', verdict: 'complete',
      branchUrl: `${GH}feature/done-one`,
    }),
    row({
      plan: 'six-waves', planFile: '2026-08-24-six-waves.md',
      branch: 'feature/done-two', wave: 'Complete', verdict: 'complete',
      branchUrl: `${GH}feature/done-two`,
    }),
  ];
  const waves: Wave[] = [
    wave({ plan: 'six-waves', name: 'Complete', section: 'done' }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows, waves,
    summary: { plans: 1, waves: 1, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as Fleet;
}

describe('a wave row speaks its own verdict in the status slot', () => {
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

  async function open(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Done').first().waitFor({ timeout: 10_000 });
    // DONE is folded by default — unfold it to see the wave rows.
    const doneToggle = page.locator('[data-group-toggle]').filter({ hasText: 'Done' });
    if ((await doneToggle.getAttribute('aria-expanded')) === 'false') {
      await doneToggle.click();
    }
    return page;
  }

  /** The status cell of a wave row. */
  const waveStatus = (page: Page, wave: string) =>
    page.locator(`[data-wave-row="${wave}"]`).locator('[data-tuple-status]');

  it('a multi-branch wave in DONE shows "complete", not "delivered"', async () => {
    const page = await open();
    try {
      const status = waveStatus(page, 'Complete');
      await status.waitFor({ timeout: 5_000 });
      // The verdict word: `complete`, not `delivered`.
      // `2 complete` is the shape — count + word.
      const text = await status.textContent();
      expect(text).toContain('complete');
      expect(text).not.toContain('delivered');
      // Asserted directly by name: item 5 says no row reads `delivered` while
      // its siblings read `complete`.
      expect(text).toMatch(/2\s+complete/);
    } finally {
      await page.close();
    }
  });
});
