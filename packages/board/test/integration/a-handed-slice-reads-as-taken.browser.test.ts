import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, expandAgentFolds, type Catalogue } from '../catalogue/index.js';
import type { AgentRow, Fleet } from '../../src/contract/schema.js';

/**
 * THE HAND-OVER NOTE AS A READER SEES IT — #1150, the rendering half only.
 *
 * **IT PROVES RENDERING AND NOTHING ELSE.** The server rule that moves the row
 * is `withHandOver`, pinned case by case in
 * `test/unit/a-handed-slice-reads-as-taken.test.ts` — five guards, each
 * mutation-tested. This suite serves a payload in which the row ALREADY carries
 * `group: 'working'` and the note, so a bug in that rule cannot reach it. What
 * only a page can settle is where the sentence lands: the moved row is not drawn
 * itself, because WORKING renders registry agents through `RegistryRow`, and the
 * note has to arrive in the agent's own row by the join.
 *
 * It asserts the session nowhere. The session already renders in WORKING today,
 * so such an assertion would pass against an unchanged board — which is why the
 * note names the state and not the agent.
 */
const BRANCH = 'bug/the-rule-names-a-usage-limit';
const OTHER = 'bug/a-closed-sprint-stops-filtering';
const HANDED = 'handed over — not taken up yet';
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', kind: 'branch', branch: BRANCH, plan: 'a-handed-slice-reads-as-taken',
  planFile: '2026-10-01-a-handed-slice-reads-as-taken.md', wave: 'The row',
  state: 'claimed', phase: 'Development', group: 'working', ageMinutes: 0,
  note: HANDED, pr: null, branchUrl: `${GH}${BRANCH}`, verdict: 'eligible',
  startability: 'someone-is-on-it',
  // THE SCAN HAS NOT SEEN THE WORKER YET — that is the whole case. No worktree
  // holds the branch until the agent reads its manifest, so the scan answers
  // `elsewhere` while the registry already names the agent.
  worker: 'elsewhere',
  waitingDays: null, localDirty: false, localLocked: false, localAhead: 0,
  stuck: null, deferredReason: '',
  ...over,
} as unknown as AgentRow);

/**
 * The payload: one handed row in WORKING, one untouched row in NOT STARTED.
 *
 * The second row is what makes the absence assertion mean anything. NOT STARTED
 * must still render — a section that is empty because the fixture gave it
 * nothing would pass the "no row for the branch" claim vacuously, which is the
 * trap `sprint-switch.browser.test.ts` records for `[data-agent-row]`.
 */
const fleet = (): Fleet => {
  const rows = [
    row(),
    row({
      branch: OTHER, plan: 'another-plan', planFile: '2026-10-01-another-plan.md',
      group: 'not-started', state: 'open', note: 'eligible — nobody has taken it',
      startability: 'start-work', branchUrl: `${GH}${OTHER}`,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    // THE REGISTRY ENTRY THAT CAUSED THE MOVE. WORKING draws agents, not branch
    // rows, so without this entry the handed row renders nowhere at all and the
    // note has no row to land in.
    agents: [{
      session: '334b3492', branch: BRANCH, worktree: '', command: '', startedAt: '',
      pid: '4242', previousPid: '', relaunches: 0, state: 'running' as const,
    }],
    sprints: [], issues: [], issueAnswer: 'answered', issueError: null,
    summary: { plans: 2, waves: 2, branches: rows.length, claimed: 1, eligible: 1, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
};

describe('a handed slice reads as taken, in the agent\'s own row', () => {
  let cat: Catalogue;
  let page: Page;

  beforeAll(async () => {
    cat = await openCatalogue();
    page = await cat.open('an-empty-estate', { tab: 'agents', over: { fleet: fleet() } });
    await page.getByText('Working').first().waitFor({ timeout: 15_000 });
    await expandAgentFolds(page);
  }, 90_000);

  afterAll(async () => {
    await cat?.close();
  });

  it('the agent\'s row carries the hand-over note', async () => {
    // The note reaches the AGENT's row by the join, because the moved branch row
    // is not drawn in WORKING.
    const notes = page.locator('[data-agent-row] [data-row-note]');
    await expect.poll(async () => {
      await expandAgentFolds(page);
      return (await notes.allInnerTexts()).map((t) => t.trim());
    }, { timeout: 20_000 }).toContain(HANDED);
  });

  it('NOT STARTED holds no row for the handed branch', async () => {
    // THE SECTION IS AN ELEMENT, not an attribute on the row. Rows carry no
    // `data-group`, so a `[data-branch][data-group="not-started"]` selector
    // matches nothing and the claim would pass against an unfixed board —
    // `sprint-switch.browser.test.ts` records the same trap for
    // `[data-agent-row]`. So the section is located by its own heading button
    // and the row is looked for inside it.
    const notStarted = page.locator('section', {
      has: page.locator('[data-group-toggle="not-started"]'),
    });

    // The OTHER branch proves the section rendered and unfolded at all: an
    // empty or missing NOT STARTED would satisfy the claim below for free.
    await expect.poll(async () => {
      await expandAgentFolds(page);
      return notStarted.locator(`[data-branch="${OTHER}"]`).count();
    }, { timeout: 20_000 }).toBeGreaterThan(0);

    expect(await notStarted.locator(`[data-branch="${BRANCH}"]`).count()).toBe(0);
  });
});
