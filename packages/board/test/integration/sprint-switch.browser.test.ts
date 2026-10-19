import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, expandAgentFolds, type Catalogue } from '../catalogue/index.js';
import { type AgentRow, type Fleet, type FleetSprint } from '../../src/contract/schema.js';

/**
 * AN OPEN BOARD FOLLOWS A SPRINT CHANGE — #1145, measured in a browser.
 *
 * The Agents tab holds «This sprint» as an in-memory Set of sprint slugs, while
 * the control is built from the ACTIVE sprints of the moment. When a selected
 * sprint closes the two disagree, and the filter asks the membership map —
 * built from active sprints only — about a slug it has no entry for. That
 * fails EVERY plan row, the closed sprint's own members included, so both
 * fixtures carry a row from each side: a test watching only the new sprint's
 * rows would miss half the defect.
 *
 * THE CONTROL IS NOW ONE CHIP, all-or-nothing against every Active sprint —
 * `the-delivery-tab-renders-one-chip-row` replaced the per-sprint checkboxes
 * this file tested with `data-sprint-toggle="<slug>"`. The scenario below
 * (select, let the selected sprint close, confirm the selection survives an
 * empty poll, confirm it prunes on the next non-empty one) still holds: it
 * exercises `sprintFilter`'s `Set<string>` and `activeSprints`' own churn, and
 * neither depends on a reader being able to pick a SUBSET of active sprints.
 * `the Active sprint button checks every Active sprint box in one click` and
 * `keeps filtering on the sprint that is still active`
 * (`agents-tab.browser.test.ts`, `sprint-switch.browser.test.ts`) exercised
 * exactly the subset case this chip removes — see their own updated comments.
 *
 * ## How one page sees two payloads
 *
 * These tests are about what the board does ACROSS A POLL, so the state has to
 * change under an open page. `cat.mock.serve()` swaps it on the server, and
 * `cat.mock.served()` counts the answers — the honest signal that the client
 * picked the new payload up. Waiting a duration instead would assert the poll
 * interval, which is not the subject. A page route was the other candidate and
 * is the weaker one here: the mock's own `fail()` comment records that a poll
 * already in flight slips through the window a route is installed in, and a
 * server-side switch has no such window.
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

/** Both fixture rows, under whichever sprints are Active for this poll. */
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

const ONLY_A = () => fleet([sprint(SPRINT_A, 'Sprint A', [PLAN_A])]);
const ONLY_B_EMPTY = () => fleet([sprint(SPRINT_B, 'Sprint B', [])]);
const NO_SPRINTS = () => fleet([]);

describe('an open board follows a sprint change', () => {
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
    await reveal(page);
    return page;
  }

  async function reveal(page: Page): Promise<void> {
    const toggle = page.locator('[data-group-toggle="waiting-on-you"]');
    if (await toggle.count() > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click();
    }
    await expandAgentFolds(page);
  }

  /**
   * Serve a new payload and return once the client has fetched it.
   *
   * The count is the handshake: `served().fleet` rises when `/api/fleet`
   * answers again, so this waits for the POLL rather than for a duration.
   */
  async function swap(payload: Fleet): Promise<void> {
    const before = cat.mock.served().fleet;
    cat.mock.serve('an-empty-estate', {
      fleet: payload,
      board: buildBoard({
        server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME },
      }),
    });
    await expect.poll(() => cat.mock.served().fleet > before, { timeout: 20_000 }).toBe(true);
  }

  /**
   * The branches this page renders.
   *
   * `[data-branch]` and NOT `[data-agent-row]`: a slice row carries the branch
   * attribute and the page renders zero `data-agent-row` elements for this
   * fixture, so the narrower selector matches nothing and every assertion
   * against it passes vacuously. Measured while writing this test.
   */
  const branches = async (page: Page): Promise<string[]> =>
    page.locator('[data-branch]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-branch') ?? '').filter(Boolean));

  /**
   * Poll until exactly the named fixture rows render.
   *
   * Folds are re-opened each pass: a row arriving on a later poll lands under a
   * shut plan, and a row in the DOM but folded away reads as absent for a reason
   * that has nothing to do with the filter.
   */
  async function expectBranches(page: Page, want: string[]): Promise<void> {
    const wanted = [...want].sort().join(',');
    await expect.poll(async () => {
      await reveal(page);
      const shown = await branches(page);
      return shown.filter((b) => b === ROW_A || b === ROW_B).sort().join(',');
    }, { timeout: 20_000 }).toBe(wanted);
  }

  // THE CHIP, all-or-nothing — `data-chip="This sprint"` with `data-chip-on`.
  const chip = (page: Page) => page.locator('[data-chip="This sprint"]');
  const chipOn = async (page: Page): Promise<boolean> => (await chip(page).getAttribute('data-chip-on')) === '1';

  it('stops filtering on a sprint that closed, and forgets it', async () => {
    // Sprint A active, naming `plan-a` only; `bug/b` is in no sprint.
    const page = await open(ONLY_A());
    try {
      await chip(page).click();
      // The filter runs: A's member shows, the row in no sprint is hidden.
      await expectBranches(page, [ROW_A]);

      // AN EMPTY SPRINT LIST PRUNES NOTHING. `workingTreeSprints` answers `[]`
      // for a missing or unreadable sprint directory, which a checkout or a
      // fast-forward can cause for one poll. The filter is off for that poll, so
      // both rows show; the stored selection has to survive it.
      await swap(NO_SPRINTS());
      await expectBranches(page, [ROW_A, ROW_B]);

      // A active again: the selection came back unchanged, so `bug/b` is hidden
      // once more and the chip is still on. That is what proves the empty
      // poll pruned nothing.
      await swap(ONLY_A());
      await expectBranches(page, [ROW_A]);
      expect(await chipOn(page)).toBe(true);

      // THE SWITCH. A closes and B starts, naming neither plan. On `origin/main`
      // the retained slug hides BOTH rows — `plan-a` included, because the
      // membership map holds no entry for a closed sprint — and the board prints
      // `2 hidden by Sprint only` beside a chip reading off.
      await swap(ONLY_B_EMPTY());
      await expectBranches(page, [ROW_A, ROW_B]);
      expect(await page.locator('[data-sprint-hidden]').count()).toBe(0);
      expect(await page.locator('body').innerText()).not.toContain('hidden by Sprint only');
      expect(await chipOn(page)).toBe(false);

      // THE PRUNE. Back to a tree where A is Active — a branch switch does this,
      // because `workingTreeSprints` reads the checked-out tree. A slug kept in
      // the Set would filter again with the chip on, a selection this reader
      // never made in this view. It was pruned, so the chip reads off and
      // `bug/b` stays visible. This assertion fails on `origin/main`.
      await swap(ONLY_A());
      await expect.poll(() => chipOn(page), { timeout: 20_000 }).toBe(false);
      await expectBranches(page, [ROW_A, ROW_B]);
    } finally {
      await page.close();
    }
  });

  // THE SUBSET CASE THIS CHIP REMOVES. The per-sprint checkboxes this file
  // used to test let a reader select Sprint A alone, then Sprint B alone, and
  // watch the filter track whichever subset was checked while the other
  // sprint closed. `This sprint` is all-or-nothing against `activeSprints` —
  // `toggleThisSprintChip` in `AgentList.tsx` — so there is no SUBSET for a
  // closing sprint to leave behind: on is "every Active sprint", off is
  // "none", and a sprint that closes while the chip is on just shrinks what
  // "every Active sprint" means on the next poll. The scenario this test
  // exercised (one sprint stays selected through the other's closure) has no
  // equivalent left to assert — reported in this branch's PR as a plan gap
  // rather than guessed at here.
});
