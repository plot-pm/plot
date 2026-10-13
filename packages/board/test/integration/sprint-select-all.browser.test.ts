import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, expandAgentFolds, type Catalogue } from '../catalogue/index.js';
import { type AgentRow, type Fleet, type FleetSprint } from '../../src/contract/schema.js';

/**
 * THE SELECT-ALL BUTTON PICKS EVERY ACTIVE SPRINT IN ONE STEP — D32 (story
 * Open Point 12), measured in a browser.
 *
 * `SprintFilter` already renders one checkbox per Active sprint, toggled one
 * at a time. With two or more Active sprints a reader had no one-step way to
 * select all of them. The fixture carries two sprints so a click's effect on
 * BOTH boxes is the thing under test, not a single-sprint no-op.
 */
const ME = 'gardener';
const SPRINT_A = 'sprint-a';
const SPRINT_B = 'sprint-b';
const PLAN_A = 'plan-a';
const PLAN_B = 'plan-b';
const ROW_A = 'bug/a';
const ROW_B = 'bug/b';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', kind: 'pr', branch: ROW_A, plan: PLAN_A, planFile: `2026-10-01-${PLAN_A}.md`,
  wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you', ageMinutes: 10,
  waitingOn: 'you', note: 'PR green', pr: null, branchUrl: '', waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, deferredReason: '',
  ...over,
} as unknown as AgentRow);

const pr = (number: number) =>
  ({ number, url: `https://github.com/tiny/garden/pull/${number}`, draft: false, state: 'green', author: ME });

/** A sprint whose membership list names exactly the given plan slugs. */
const sprint = (slug: string, title: string, members: string[]): FleetSprint => ({
  slug, title, release: '', timebox: 'none', timeboxLabel: '',
  counts: { total: members.length, open: 0, wip: members.length, done: 0, withdrawn: 0 },
  members: members.map((m) => ({ slug: m, text: '', tier: 'must', checked: false, known: true })),
} as unknown as FleetSprint);

const rowA = () =>
  row({ branch: ROW_A, plan: PLAN_A, planFile: `2026-10-01-${PLAN_A}.md`, pr: pr(11) } as Partial<AgentRow>);
const rowB = () =>
  row({ branch: ROW_B, plan: PLAN_B, planFile: `2026-10-01-${PLAN_B}.md`, pr: pr(12) } as Partial<AgentRow>);

const fleet = (sprints: FleetSprint[]): Fleet => {
  const rows = [rowA(), rowB()];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows, sprints,
    issues: [], issueAnswer: 'answered', issueError: null,
    summary: { plans: 2, waves: 2, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
};

const TWO_SPRINTS = () => fleet([sprint(SPRINT_A, 'Sprint A', [PLAN_A]), sprint(SPRINT_B, 'Sprint B', [PLAN_B])]);
const NO_SPRINTS = () => fleet([]);

describe('the Active sprint button selects every Active sprint', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(payload: Fleet): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: {
        fleet: payload,
        board: buildBoard({
          server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME },
        }),
      },
    });
    await page.getByText('Waiting on you').first().waitFor({ timeout: 15_000 });
    await expandAgentFolds(page);
    return page;
  }

  it('checks every sprint box in one click', async () => {
    const page = await open(TWO_SPRINTS());
    try {
      const button = page.locator('[data-select-all-sprints]');
      expect(await page.locator(`[data-sprint-toggle="${SPRINT_A}"]`).isChecked()).toBe(false);
      expect(await page.locator(`[data-sprint-toggle="${SPRINT_B}"]`).isChecked()).toBe(false);

      await button.click();

      await expect.poll(() => page.locator(`[data-sprint-toggle="${SPRINT_A}"]`).isChecked()).toBe(true);
      expect(await page.locator(`[data-sprint-toggle="${SPRINT_B}"]`).isChecked()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('is disabled and names the reason when no sprint is Active', async () => {
    const page = await open(NO_SPRINTS());
    try {
      const button = page.locator('[data-select-all-sprints]');
      expect(await button.isDisabled()).toBe(true);
      expect(await button.getAttribute('title')).toBe('No sprint is Active.');
    } finally {
      await page.close();
    }
  });
});
