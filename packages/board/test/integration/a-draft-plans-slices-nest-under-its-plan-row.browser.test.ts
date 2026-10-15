import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { DRAFT_PLAN_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * A Draft plan with named slices renders as ONE plan row over its slices in
 * Waiting on you. The grouping shape is decided and unit-tested in
 * `planGroupShape`; this test proves the page draws it.
 */
const SLUG = 'a-draft-with-slices';
const FILE = 'p-a-draft-with-slices.md';
const SLICES = ['Retry', 'Pin', 'Identities'];

const row = (over: Partial<AgentRow>): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: SLUG, planFile: FILE,
  wave: 'w', state: 'deferred', phase: 'Discovery', group: 'waiting-on-you', ageMinutes: 400,
  waitingOn: 'you', note: DRAFT_PLAN_NOTE, pr: null, branchUrl: '', waitingDays: 2,
  localDirty: false, localLocked: false, stuck: null, verdict: 'eligible',
  ...over,
});

const fleet = (): Fleet => {
  const rows: AgentRow[] = [
    ...SLICES.map((wave) => row({ branch: `feature/${wave.toLowerCase()}`, wave, kind: 'wave' })),
    row({ branch: `idea/${SLUG}`, wave: '', kind: 'plan' }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 1, waves: 3, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 3 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    slices: SLICES.map((name) => ({
      plan: SLUG, name, branches: [`feature/${name.toLowerCase()}`], verdict: 'eligible',
      section: 'waiting-on-you', complete: false, planSliceCount: SLICES.length,
    })),
  } as unknown as Fleet;
};

describe('a Draft plan\'s slices nest under its plan row in Waiting on you', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  it('draws one plan row with a caret and the slices beneath it', async () => {
    const page: Page = await cat.open('an-empty-estate', {
      over: { fleet: fleet() },
      tab: 'agents',
      viewport: { width: 1400, height: 1200 },
    });
    try {
      const section = page.locator('ul[role="grid"][aria-label^="Waiting on you"]');
      await expect
        .poll(() => section.locator(`li[data-plan-row="${SLUG}"]`).count(), { timeout: 10_000 })
        .toBe(1);
      expect(await section.locator('li[data-tuple-kind="plan"]').count()).toBe(1);
      const caret = section.locator(`li[data-plan-row="${SLUG}"] [aria-expanded]`);
      expect(await caret.count()).toBeGreaterThan(0);
      await caret.first().click();
      await expect
        .poll(() => section.locator('[data-slice-row]').count(), { timeout: 10_000 })
        .toBe(SLICES.length);
    } finally {
      await page.close();
    }
  });
});
