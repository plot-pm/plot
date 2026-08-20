import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * NOT STARTED counts PLANS — what only a rendered page can settle.
 *
 * The decisions themselves are pure functions, asserted in
 * `test/unit/not-started-plans.test.ts`. Three things are not: whether the fold
 * OPENS, whether the plan row's columns land on the same tracks as a branch
 * row's, and whether every other section still renders branch rows.
 *
 * The fixture is the live board of 2026-08-17, reduced: `activity-shows-itself`
 * with three unstarted waves, `plot-sprint-support` waiting 187 days on one,
 * `shelved-work` holding a deferred branch with a real PR and a real age, and
 * one WAITING ON YOU row to prove the other sections are untouched.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Design', group: 'not-started', ageMinutes: null,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null,
  ...over,
});

function fleet(): Fleet {
  const rows: AgentRow[] = [
    // The plan that printed three identical rows for one wait.
    row({
      plan: 'activity-shows-itself', planFile: '2026-08-17-activity-shows-itself.md',
      branch: 'feature/activity-marker-glows', waitingDays: 1, waitingOn: 'click' as const, note: ELIGIBLE_NOTE,
    }),
    row({
      plan: 'activity-shows-itself', planFile: '2026-08-17-activity-shows-itself.md',
      branch: 'feature/group-shows-inner-activity', waitingDays: 1,
      waitingOn: 'time' as const, note: 'blocked by Truth',
    }),
    row({
      plan: 'activity-shows-itself', planFile: '2026-08-17-activity-shows-itself.md',
      branch: 'feature/unpushed-work-shows-still', waitingDays: 1,
      waitingOn: 'time' as const, note: 'blocked by Truth',
    }),
    // One unstarted wave, waiting since February.
    row({
      plan: 'plot-sprint-support', planFile: '2026-02-11-plot-sprint-support.md',
      branch: 'feature/plot-sprint-support', waitingDays: 187,
    }),
    // A branch that WAS started and then shelved: it carries a PR and an age
    // that exist nowhere else in this section.
    row({
      plan: 'shelved-work', planFile: '2026-08-10-shelved-work.md',
      branch: 'feature/set-down', state: 'deferred', ageMinutes: 400, waitingDays: 7,
      note: 'last commit 6h ago', branchUrl: `${GH}feature/set-down`,
      pr: { number: 57, url: 'https://github.com/tiny/garden/pull/57', draft: false, state: 'green' },
    }),
    // Untouched neighbours: a real branch holding real work.
    row({
      plan: 'reviewed-plan', planFile: '2026-08-15-reviewed-plan.md',
      branch: 'feature/needs-review', group: 'waiting-on-you', state: 'wip',
      phase: 'Development', ageMinutes: 30, waitingDays: null,
      note: 'PR #116 green', branchUrl: `${GH}feature/needs-review`,
      pr: { number: 116, url: 'https://github.com/tiny/garden/pull/116', draft: false, state: 'green' },
    }),
    row({
      plan: 'quiet-plan', planFile: '2026-08-01-quiet-plan.md',
      branch: 'feature/gone-still', group: 'quiet', state: 'wip', phase: 'Development',
      ageMinutes: 4000, waitingDays: null, note: 'last commit 2d ago',
      branchUrl: `${GH}feature/gone-still`,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 5, waves: 6, branches: rows.length, claimed: 0, eligible: 2, blocked: 2, deferred: 1 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as Fleet;
}

describe('NOT STARTED renders one row per plan', () => {
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
    await page.getByText('Not started').first().waitFor({ timeout: 10_000 });
    return page;
  }

  /** The NOT STARTED grid — located by its own accessible name. */
  const section = (page: Page) => page.locator('ul[role="grid"][aria-label^="Not started"]');

  const planRow = (page: Page, plan: string) =>
    section(page).locator(`li[data-plan-row="${plan}"]`);

  it('shows ONE row for a plan with three unstarted waves', async () => {
    const page = await open();
    try {
      // The measurement: three rows for one waiting plan, each carrying `pr=—`
      // and `age=—`, the two extras saying nothing the first did not.
      await expect.poll(() => planRow(page, 'activity-shows-itself').count()).toBe(1);
      // And the branches are NOT rendered while it is folded.
      await expect.poll(() =>
        section(page).locator('[data-branch="feature/activity-marker-glows"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('names how many waves remain and that the first is eligible', async () => {
    const page = await open();
    try {
      await expect.poll(() =>
        planRow(page, 'activity-shows-itself').locator('[data-wave-summary]').textContent())
        .toBe('3 waves, first eligible');
    } finally {
      await page.close();
    }
  });

  it('OPENS the fold and brings the three branch names back', async () => {
    const page = await open();
    try {
      // The pairing that matters: an implementation that summarises the waves
      // away passes the one-row assertion above and loses the plan's own words
      // for what it will do. A reader who wants them must not have to open the
      // plan file.
      await page.locator('[data-wave-toggle="activity-shows-itself"]').click();
      for (const branch of [
        'feature/activity-marker-glows',
        'feature/group-shows-inner-activity',
        'feature/unpushed-work-shows-still',
      ]) {
        await expect.poll(() =>
          section(page).locator(`[data-branch="${branch}"]`).count(), { timeout: 5_000 }).toBe(1);
      }
    } finally {
      await page.close();
    }
  });

  it('folds it shut again, and says which state it is in', async () => {
    const page = await open();
    try {
      const toggle = page.locator('[data-wave-toggle="activity-shows-itself"]');
      // `aria-expanded` is what tells a screen reader the fold is shut — the
      // caret alone is a visual fact.
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      await expect.poll(() =>
        section(page).locator('[data-branch="feature/activity-marker-glows"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('gives a plan with ONE unstarted wave no expander, and shows its branch', async () => {
    const page = await open();
    try {
      // A control that reveals a row it already shows is noise. And the row must
      // still be reachable: hiding it behind a control the reader was never
      // given would lose it entirely.
      await expect.poll(() =>
        page.locator('[data-wave-toggle="plot-sprint-support"]').count()).toBe(0);
      await expect.poll(() =>
        section(page).locator('[data-branch="feature/plot-sprint-support"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('reads the plan clock, so 187 days shows where the branch clock is blank', async () => {
    const page = await open();
    try {
      // `waitingLabel(187)` is `6mo` — the unit that reads. Its branch has no
      // tip, so `ageMinutes` says nothing about the six months the plan waited.
      await expect.poll(() =>
        planRow(page, 'plot-sprint-support').getByText('6mo').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('sorts the section by the plan clock, oldest first', async () => {
    const page = await open();
    try {
      // The pairing that matters: `groupByPlan`'s `ageMinutes` sort scores every
      // group here -1, so a test that only checks "the groups are ordered"
      // passes against a sort that does nothing. This asserts the ORDER.
      await expect.poll(() =>
        section(page).locator('li[data-plan-row]').evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-plan-row'))),
      ).toEqual(['plot-sprint-support', 'shelved-work', 'activity-shows-itself']);
    } finally {
      await page.close();
    }
  });

  it('keeps a deferred branch\'s own row, with its own PR and age, under its plan', async () => {
    const page = await open();
    try {
      // It WAS started and then shelved. `fleet.ts` warns what flattening it
      // costs: "a branch started and then shelved read as never begun, with its
      // age and its PR erased."
      const branchRow = section(page).locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/set-down"]') });
      await expect.poll(() => branchRow.count()).toBe(1);
      await expect.poll(() => branchRow.locator('[data-pr-link]').textContent())
        .toContain('57');
      await expect.poll(() => branchRow.getByText('6h', { exact: true }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('leaves every OTHER section rendering branch rows', async () => {
    const page = await open();
    try {
      // The change is confined to the one section whose rows are not branches.
      for (const [label, branch] of [
        ['Waiting on you', 'feature/needs-review'],
        ['Quiet', 'feature/gone-still'],
      ] as const) {
        const grid = page.locator(`ul[role="grid"][aria-label^="${label}"]`);
        // Sections can start folded (`quiet` does) — open it before looking.
        const toggle = page.locator(`[data-group-toggle]`).filter({ hasText: label });
        if (await grid.count() === 0) await toggle.click();
        await expect.poll(() =>
          page.locator(`ul[role="grid"][aria-label^="${label}"] [data-branch="${branch}"]`).count(),
          { timeout: 5_000 }).toBe(1);
        // And NO plan rows there: the branch is rightly the subject.
        await expect.poll(() =>
          page.locator(`ul[role="grid"][aria-label^="${label}"] li[data-plan-row]`).count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('indents a plan\'s waves under it, and keeps their slots aligned with each other', async () => {
    const page = await open();
    try {
      // ONE GRID, AND THIS ASSERTS THE AGREEMENT AGAIN — which is the third
      // thing this test has claimed, and the reversal is worth reading in one
      // place because each version was right about the layout it was written
      // against.
      //
      //   1. Originally: same x, because a plan row borrowed the branch tracks.
      //      That is what made eight sibling plans read as a NESTING — the plan
      //      name and the branch name below it both began at 222px, measured.
      //   2. `a-plan-row-is-not-a-branch-row` gave the plan row its own
      //      proportions and this asserted they DIFFER, by enough to see.
      //   3. `one-component-renders-every-row` collapses both grids into
      //      `TUPLE_TRACKS`, so the tracks agree — told apart by slot 2 stating
      //      the KIND in a word rather than by an offset.
      //   4. NOW: the plan's waves are INDENTED under it, and the parent is not
      //      one of them.
      //
      // WHY (4) DOES NOT BRING BACK (1). What (1) feared was an ACCIDENT: eight
      // sibling plans, each at the same x, reading as a nesting that did not
      // exist. Here the nesting is the truth — a wave IS a child of its plan —
      // so an indent states a real relationship instead of implying a false one.
      //
      // And (3)'s argument holds only where the kind word DIFFERS. Measured
      // 2026-08-20 on a three-wave plan: parent and children all render `PLAN`,
      // so slot 2 distinguishes nothing there and the reader had a heading and
      // three identical labels. `a-wave-is-a-thing-not-a-label` fixes the label;
      // the indent is what makes the set legible while it is still wrong.
      //
      // So the claim splits. **Children align with each other** — one grid, and
      // a column a reader can scan down. **The parent sits 24px to their left**,
      // matching its own fold control, which is the shape a file tree uses.
      await page.locator('[data-wave-toggle="activity-shows-itself"]').click();
      const branchRow = section(page).locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/activity-marker-glows"]') });
      await branchRow.waitFor({ timeout: 5_000 });
      const planRowEl = planRow(page, 'activity-shows-itself');
      // THE PARENT IS OUTDENTED, by the width of its own fold control. One
      // measurement, because the offset is a single fact: if the indent were
      // lost the difference would be 0, and if it were applied twice it would
      // be 48.
      const pFirst = await planRowEl.locator('[role="gridcell"]').first().boundingBox();
      const bFirst = await branchRow.locator('[role="gridcell"]').first().boundingBox();
      expect(bFirst!.x - pFirst!.x, 'the waves sit one indent right of their plan')
        .toBeGreaterThan(16);

      // AND THE CHILDREN AGREE WITH EACH OTHER, in every slot — which is what
      // one grid buys and what a reader scanning a column depends on. A single
      // matching cell could be a coincidence of content width; the claim is
      // about the grid.
      const siblings = section(page).locator('[data-wave-list] li[data-agent-row]');
      const n = await siblings.count();
      expect(n, 'more than one wave, or this asserts nothing').toBeGreaterThan(1);
      for (const slot of [0, 1, 2, 3, 4, 5, 6]) {
        const first = await siblings.nth(0).locator('[role="gridcell"]').nth(slot).boundingBox();
        for (let i = 1; i < n; i++) {
          const other = await siblings.nth(i).locator('[role="gridcell"]').nth(slot).boundingBox();
          expect(Math.abs(first!.x - other!.x), `slot ${slot} x, sibling ${i}`).toBeLessThan(1);
        }
      }
      // AND THE NESTING IS STILL GONE, which is the property (2) was protecting
      // and the one that must survive the realignment. It survives in the KIND
      // rather than in the offset: the two rows say what they are.
      // LOWERCASED, because slot 2 wears Tailwind's `uppercase` on the board
      // while the authored words are `Plan` and `Branch`. Asserting the styled
      // form would make this a claim about a CSS utility rather than about the
      // two rows saying what they are.
      expect((await planRowEl.locator('[data-kind]').innerText()).toLowerCase()).toBe('plan');
      expect((await branchRow.locator('[data-kind]').innerText()).toLowerCase()).toBe('branch');
    } finally {
      await page.close();
    }
  });
  it('colours only the rows a person can release, and only in this section', async () => {
    // The half a class-name assertion cannot settle: that the browser RESOLVED
    // a different colour for `you` than for the other two, and that a row
    // outside NOT STARTED gets no waiting-state at all.
    const page = await open();
    try {
      await page.locator('[data-wave-toggle="activity-shows-itself"]').click();
      const noteOf = (branch: string) =>
        section(page).locator('li[data-agent-row]')
          .filter({ has: page.locator(`[data-branch="${branch}"]`) })
          .locator('[data-row-note]');

      const eligible = noteOf('feature/activity-marker-glows');
      const blocked = noteOf('feature/group-shows-inner-activity');
      await eligible.waitFor({ timeout: 5_000 });

      // The FIELD reaches the DOM, so a rule keyed on the note's wording cannot
      // masquerade as this passing.
      expect(await eligible.getAttribute('data-waiting-on')).toBe('click');
      expect(await blocked.getAttribute('data-waiting-on')).toBe('time');

      const colourOf = (loc: typeof eligible) =>
        loc.evaluate((el) => getComputedStyle(el).color);
      const eligibleColour = await colourOf(eligible);
      const blockedColour = await colourOf(blocked);
      // Blocked is the quietest — the most common state in a multi-wave plan,
      // and the least actionable.
      expect(blockedColour).not.toBe(eligibleColour);

      // NOTHING ANIMATES. Motion marks an unanswered request; an ordinary
      // Draft is not one.
      for (const loc of [eligible, blocked]) {
        expect(await loc.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
      }
    } finally {
      await page.close();
    }
  });
  it('draws the separator BETWEEN plans, never between a plan and its branch', async () => {
    // The reported defect: every row drew its own rule, including the plan
    // row — so the line fell between a plan and its first branch, and no line
    // fell between one plan and the next. Each visual block therefore held one
    // plan's branches and the FOLLOWING plan's heading: the separator divided
    // exactly the wrong pair, and `last:border-0` could not save it because a
    // plan row is never the last child of its own group.
    const page = await open();
    try {
      await page.locator('[data-wave-toggle="activity-shows-itself"]').click();
      const branchRow = section(page).locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/activity-marker-glows"]') });
      await branchRow.waitFor({ timeout: 5_000 });

      const widthOf = (loc: ReturnType<typeof branchRow.first>) =>
        loc.evaluate((el) => getComputedStyle(el).borderBottomWidth);

      // Neither the plan row nor a branch row inside the group draws one...
      expect(await widthOf(planRow(page, 'activity-shows-itself'))).toBe('0px');
      expect(await widthOf(branchRow)).toBe('0px');
      // ...the GROUP does, once, around the pair.
      //
      // Read as border OR outline. `the-row-shows-what-it-withholds` gave the
      // group a full edge on all four sides rather than a rule beneath it — a
      // group that suppresses its inner dividers and closes with one bottom
      // line is the arrangement that reads as continuing past its last member,
      // which is how two unrelated issue rows came to sit under a plan heading.
      // It is drawn as an `outline` because a border needs a margin to clear
      // the grid's own, and that margin insets the rows inside the group,
      // costing the column alignment every row in the fleet shares.
      //
      // The property under test is *the group draws the separator and its rows
      // do not* — which is unchanged. Naming one CSS property was how this
      // test came to fail on a change that kept its subject intact.
      const group = section(page).locator('li[role="rowgroup"]').first();
      const edge = await group.evaluate((el) => {
        const cs = getComputedStyle(el);
        return Math.max(
          parseFloat(cs.borderBottomWidth) || 0,
          cs.outlineStyle === 'none' ? 0 : (parseFloat(cs.outlineWidth) || 0),
        );
      });
      expect(edge).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('states phase and the waiting clock ONCE, on the plan row', async () => {
    // Both are properties of the PLAN that a branch merely inherits: every
    // branch of one plan shares one `waitingDays`, dating the plan's own
    // `Approved:` record. Repeating them down the column says one number three
    // times and reads like three measurements.
    const page = await open();
    try {
      await page.locator('[data-wave-toggle="activity-shows-itself"]').click();
      const branchRow = section(page).locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/activity-marker-glows"]') });
      await branchRow.waitFor({ timeout: 5_000 });

      // The branch row's phase cell is empty — the cell still RENDERS, so the
      // seven branch tracks hold their width and branch rows stay aligned with
      // branch rows in every other section.
      expect(await branchRow.locator('[data-phase]').count()).toBe(0);
      // THE SAME NUMBER OF CELLS, and this too is a reversal stated rather than
      // quietly dropped. It asserted FEWER, on the argument that a plan row has
      // no phase track, no PR cell and no actions cell — true of
      // `PLAN_ROW_TRACKS`, and the reason there were two grids for what the
      // contract says are seven kinds.
      //
      // A shape does not admit that argument. Every kind fills the same seven
      // tracks and a kind with nothing for a slot renders NOTHING IN IT — which
      // is not the same as having no slot: an empty cell holds its width, and
      // that is what keeps a plan row's clock under a branch row's clock. The
      // count matching now means the opposite of what it used to: not that a
      // plan row went back to borrowing a branch's tracks, but that neither
      // borrows because there is only one grid to borrow from.
      const planCells = await planRow(page, 'activity-shows-itself')
        .locator('[role="gridcell"]').count();
      const branchCells = await branchRow.locator('[role="gridcell"]').count();
      expect(planCells).toBe(branchCells);
      // The plan row's phase rides in its STATUS slot — slot 5, the object the
      // fact belongs to — rather than a track of its own, so it is still stated
      // exactly once per group.
      expect(await planRow(page, 'activity-shows-itself').locator('[data-phase]').count()).toBe(1);
      // And the plan row still carries the clock the branches gave up.
      expect(await planRow(page, 'activity-shows-itself').textContent()).toMatch(/d|mo|today/);
    } finally {
      await page.close();
    }
  });
  it('counts PLANS in its heading, not the rows folded behind them', async () => {
    // Measured on screen: `NOT STARTED (6)` above three visible lines, because
    // one plan with five unstarted waves is one row and five records. The
    // heading counts what the section SHOWS — everywhere else that is rows,
    // and here it is plans.
    //
    // Nothing is hidden by the smaller figure: each plan row carries its own
    // `N waves` summary, so the branches behind the expander are described
    // where they live rather than added into a number one level up.
    const page = await open();
    try {
      const heading = page.getByRole('heading', { name: /Not started/i }).first();
      await heading.waitFor({ timeout: 5_000 });
      const planRows = section(page).locator('li[data-plan-row]');
      await expect.poll(() => planRows.count()).toBeGreaterThan(0);
      const plans = await planRows.count();
      expect(await heading.textContent()).toContain(`(${plans})`);
    } finally {
      await page.close();
    }
  });
});
