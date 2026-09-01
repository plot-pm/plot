import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { expandAgentFolds, startServer } from '../helpers.mjs';
import { openCatalogue, board as buildBoard, card as buildCard, column, type Catalogue } from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet, type IssueRow } from '../../src/contract/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

/**
 * THE ROW SAYS WHAT IT KNOWS — the five display findings, measured in a browser.
 *
 * Each of these is a geometry or a boundary, which is precisely what a unit test
 * cannot settle: *is a section break bigger than a row break*, *does this group
 * have an edge*, *is this control 24 px*. The plan measured every one of them on
 * the running board on 2026-08-19 and the numbers are quoted at each assertion,
 * because a test that only says "greater than zero" passes the defect.
 *
 * The pairing that matters throughout: **a weaker implementation passes the
 * obvious assertion.** A group can gain a border and still leave the issue rows
 * inside it; a target can gain a class name and no pixels; the plan row can gain
 * a menu that opens on a plan nobody may approve. So each finding is asserted
 * from both sides.
 */
const GH = 'https://github.com/tiny/garden/tree/';

/** WCAG 2.2's floor for a pointer target. Apple asks 44, Google 48. */
const MIN_TARGET = 24;

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Design', group: 'not-started', ageMinutes: null,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null, deferredReason: '',
  ...over,
});

const issue = (number: number, title: string): IssueRow => ({
  number,
  title,
  url: `https://github.com/tiny/garden/issues/${number}`,
  ageMinutes: 120,
  labels: [],
});

/**
 * The board of 2026-08-19, reduced to what the five findings need.
 *
 * `plant-tomatoes` is the fixture's Draft plan (`2026-03-01-plant-tomatoes.md`,
 * phase Draft, PR #146) — so the card the server builds from the real plan file
 * is a Draft card, which is what the approval assertions hang on. Nothing about
 * the card is stubbed; only the fleet rows are.
 */
function fleet(): Fleet {
  const rows: AgentRow[] = [
    // A DRAFT plan in NOT STARTED — the state whose whole content is *waiting
    // for a person to approve it*, and the row that offered nothing to click.
    row({
      plan: 'plant-tomatoes', planFile: '2026-03-01-plant-tomatoes.md',
      branch: 'feature/sow-seedlings', phase: 'Discovery', waitingDays: 5,
      waitingOn: 'you' as const, note: 'plan not approved yet — still in review',
    }),
    // A plan with three branches, so the section has a group with real members
    // for the boundary to close after.
    row({
      plan: 'strawberry-netting', planFile: '2026-04-01-strawberry-netting.md',
      branch: 'feature/net-the-berries', waitingDays: 2,
    }),
    row({
      plan: 'strawberry-netting', planFile: '2026-04-01-strawberry-netting.md',
      branch: 'feature/hoop-the-frames', waitingDays: 2,
      waitingOn: 'time' as const, note: 'blocked by Frames',
    }),
    // WAITING ON YOU: a plan group whose LAST member is followed by issue rows
    // belonging to no plan — the exact arrangement measured on 2026-08-19,
    // where two issue rows rendered under a heading reading `(5)`.
    row({
      plan: 'fix-leaky-hose', planFile: '2026-03-05-fix-leaky-hose.md',
      branch: 'feature/replace-washer', group: 'waiting-on-you', state: 'wip',
      phase: 'Development', ageMinutes: 30, waitingDays: null,
      note: 'PR #116 green', branchUrl: `${GH}feature/replace-washer`,
      pr: { number: 116, url: 'https://github.com/tiny/garden/pull/116', draft: false, state: 'green' },
    }),
    row({
      plan: 'fix-leaky-hose', planFile: '2026-03-05-fix-leaky-hose.md',
      branch: 'feature/clamp-the-joint', group: 'waiting-on-you', state: 'wip',
      phase: 'Development', ageMinutes: 45, waitingDays: null,
      note: 'PR #117 green', branchUrl: `${GH}feature/clamp-the-joint`,
      pr: { number: 117, url: 'https://github.com/tiny/garden/pull/117', draft: false, state: 'green' },
    }),
    // A DEFERRED branch carrying the reason its plan recorded, and one carrying
    // none. The two must not render alike: `deferred` with no reason is a real
    // state (the bare `<!-- deferred -->`), and inventing a sentence for it
    // would be the same defect from the other side.
    row({
      plan: 'zucchini-glut', planFile: '2026-05-15-zucchini-glut.md',
      branch: 'feature/give-them-away', group: 'waiting-on-you', state: 'deferred',
      ageMinutes: 400, waitingDays: 7, note: 'last commit 6h ago',
      deferredReason: 'verified already implemented 2026-08-17 — startRepair() at fleet.ts:806',
    }),
    row({
      plan: 'zucchini-glut', planFile: '2026-05-15-zucchini-glut.md',
      branch: 'feature/pickle-the-rest', group: 'waiting-on-you', state: 'deferred',
      ageMinutes: 500, waitingDays: 8, note: 'last commit 8h ago',
      deferredReason: '',
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    issues: [issue(227, 'The board absorbs what follows a plan'), issue(228, 'A group needs an edge')],
    issueAnswer: 'answered',
    issueError: null,
    summary: { plans: 4, waves: 5, branches: rows.length, claimed: 0, eligible: 2, blocked: 1, deferred: 2 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
}

describe('the row says what it knows', () => {
  // THE STATE IS SERVED, NOT SPAWNED AND STUBBED.
  //
  // This file started `board-server.mjs` over the tiny-garden fixture only to
  // serve `index.html`: it never read `/api/board`, and stubbed `/api/fleet`
  // itself. The mock serves the same built client and answers both payloads by
  // name, so the test states its own input instead of inheriting an estate.
  let cat: Catalogue;
  /**
   * A REAL BOARD, for the one test whose subject is a CAPABILITY.
   *
   * The approval control is gated on the server reporting `approve:
   * {available: true}`, and availability is a claim about a transport the mock
   * does not have — `mock-board.ts` says as much about why
   * `approve.browser.test.ts` stays real. A served state can state the card and
   * the row; it cannot state that this board could run the approve script.
   *
   * Measured 2026-09-01: with the card and the fleet both served, the plan row
   * rendered and `data-plan-actions` did not. The card was correct — probed at
   * `/api/board` — so what was missing was the permission, not the payload.
   *
   * @see `offers approval on a DRAFT plan row`
   */
  let server: { port: number; kill: () => void };
  let realURL: string;

  beforeAll(async () => {
    cat = await openCatalogue();
    server = await startServer(FIXTURE);
    realURL = `http://localhost:${server.port}/`;
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
    server?.kill();
  });

  /** The real board, for the capability test only. */
  async function openReal(width = 1480): Promise<Page> {
    const ctx = await cat.browser.newContext({ viewport: { width, height: 1400 } });
    const page = await ctx.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${realURL}?tab=agents`);
    await page.getByText('Not started').first().waitFor({ timeout: 15_000 });
    await expandAgentFolds(page);
    return page;
  }

  async function open(width = 1480): Promise<Page> {
    // THE BOARD IS SUPPLIED TOO, and it has to be: the plan-actions menu is
    // built from a board CARD matching the fleet row's plan, so a fleet-only
    // state renders the row and no menu. The real server used to answer
    // `/api/board` from the tiny-garden fixture, which is where the Draft
    // `plant-tomatoes` card came from — stated here instead.
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: {
        fleet: fleet(),
        board: buildBoard({
          columns: [column({
            phase: 'Discovery',
            cards: [buildCard({
              slug: 'plant-tomatoes', title: 'Plant tomatoes', type: 'feature',
              phase: 'Discovery', path: 'docs/plans/2026-03-01-plant-tomatoes.md',
              prs: [], phaseDate: '2026-03-01',
            })],
          })],
        }),
      },
      viewport: { width, height: 1400 },
    });
    await page.getByText('Not started').first().waitFor({ timeout: 15_000 });
    await expandAgentFolds(page);
    return page;
  }

  const grid = (page: Page, label: string) =>
    page.locator(`ul[role="grid"][aria-label^="${label}"]`);

  // ─── A section break reads as a bigger break than a row break ────────────

  it('leaves more space above a section heading than between two rows', async () => {
    const page = await open();
    try {
      // MEASURED 2026-08-19: 16 px between one section block and the next
      // section heading, against 4 px between that heading and its own block —
      // and rows sit 35–36 px apart at `py-2`. So the strongest structural
      // break on the page was drawn with a gap barely larger than the weakest.
      //
      // Asserted as a COMPARISON rather than against a number, so the test
      // states the property (*a section break is the bigger break*) and not one
      // implementation of it.
      const gaps = await page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll('[data-sections] > section'));
        const between: number[] = [];
        for (let i = 1; i < sections.length; i += 1) {
          const above = sections[i - 1].getBoundingClientRect();
          const below = sections[i].getBoundingClientRect();
          between.push(Math.round(below.top - above.bottom));
        }
        // Two rows inside ONE group, for the gap a row break draws.
        const rows = Array.from(
          document.querySelectorAll('ul[role="grid"] li[data-agent-row]'),
        ).map((el) => el.getBoundingClientRect());
        let rowGap = 0;
        for (let i = 1; i < rows.length; i += 1) {
          const g = Math.round(rows[i].top - rows[i - 1].bottom);
          if (g >= 0) { rowGap = g; break; }
        }
        return { between, rowGap };
      });
      expect(gaps.between.length).toBeGreaterThan(0);
      // Every section break, not merely the average of them: one wide gap
      // elsewhere on the page must not carry a narrow one here.
      for (const gap of gaps.between) {
        expect(gap).toBeGreaterThan(gaps.rowGap);
        // And bigger than the 16 px measured, which was the defect.
        expect(gap).toBeGreaterThan(16);
      }
    } finally {
      await page.close();
    }
  });

  it('keeps the rows themselves at the density an operator wants', async () => {
    const page = await open();
    try {
      // The rows are NOT part of this fix. They measured 35–36 px on 2026-08-19
      // and a change that spaced the sections by spacing everything would pass
      // the assertion above and cost the board its density.
      //
      // ROWS OF ONE LINE, which is what "the density" means here. A row that
      // carries a second line is taller by exactly that line and always was —
      // `conflict / the host reports this branch does not merge` reads this way
      // on main, and a deferred row now states its reason the same way. This
      // test measured the deferred rows too and failed at 56 px, which was the
      // test being wrong about its own subject rather than the row being wrong.
      const heights = await page.evaluate(() =>
        Array.from(document.querySelectorAll('ul[role="grid"] li[data-agent-row]'))
          .filter((el) => !el.querySelector('[data-deferred-reason], [data-stuck-cell]'))
          .map((el) => Math.round(el.getBoundingClientRect().height)));
      expect(heights.length).toBeGreaterThan(0);
      for (const h of heights) expect(h).toBeLessThanOrEqual(40);
    } finally {
      await page.close();
    }
  });

  // ─── A section is not a row, and is no longer drawn as one ───────────────
  //
  // The spacing half of this finding is above. This is the SIZE half, and it
  // was measured on 2026-08-20 to be worse than reported: the section `<h2>`
  // was `text-xs`, 12px, while a row's branch name renders 13px and the row's
  // own `<li>` is `text-sm`. The strongest structural break on the page was set
  // BELOW the weakest thing inside it, and the plan `<h3>` under it at 11px was
  // smaller still — three levels ordered backwards.
  //
  // Read these together with the two above: spacing separates the sections,
  // size distinguishes them, and each can be undone without touching the other.

  /** The rendered font size of an element, in px, as a number. */
  const fontSizes = (page: Page) =>
    page.evaluate(() => {
      const size = (el: Element | null) =>
        el ? Number.parseFloat(getComputedStyle(el).fontSize) : null;
      // A ROW'S OWN TEXT, taken as the LARGEST thing a row draws rather than
      // the smallest. A row carries several sizes — 13px branch name, 12px
      // supporting cells — and the heading has to clear the biggest of them or
      // it is still smaller than something in the list it introduces. Asserting
      // against the 12px cells would pass a heading the branch names overpower.
      const rowText = Array.from(
        document.querySelectorAll('ul[role="grid"] li[data-agent-row] *'),
      )
        .filter((el) => el.children.length === 0 && el.textContent?.trim())
        .map((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      return {
        section: size(document.querySelector('[data-sections] > section h2')),
        sectionCaret: size(
          document.querySelector('[data-group-toggle] span[aria-hidden]'),
        ),
        // THE PLAN'S NAME, read off the plan ROW — it stopped being an `h3` when
        // a plan head became a row rather than chrome. `ul[role="grid"] h3`
        // matched nothing, so this read 0 and the comparison below was between
        // a real number and an absence.
        planHeading: size(document.querySelector('li[data-plan-row] [data-tuple-link="plan"], li[data-plan-row] [data-tuple-text="plan"]')),
        rowMax: rowText.length ? Math.max(...rowText) : null,
      };
    });

  it('draws a section heading larger than the rows it introduces', async () => {
    const page = await open();
    try {
      const px = await fontSizes(page);
      expect(px.rowMax).toBeGreaterThan(0);
      // THE PROPERTY, not one implementation of it: a section reads as the
      // stronger level. Stated as a comparison so re-tuning the scale later
      // does not have to re-tune this test.
      expect(px.section!).toBeGreaterThan(px.rowMax!);
      // And above the 12px measured, which was the defect itself. Without this
      // the comparison alone would pass if a row ever SHRANK to meet a heading
      // that never moved — the wrong repair for this finding, and the one that
      // costs the rows their scan.
      expect(px.section!).toBeGreaterThan(12);
    } finally {
      await page.close();
    }
  });

  it('draws the section fold caret larger than a row, without shrinking its target', async () => {
    const page = await open();
    try {
      const px = await fontSizes(page);
      // THE GLYPH GROWS. The caret was 13px against a 13px branch name — the
      // control that answers *is there more here?*, drawn at the size of the
      // thing it hides.
      expect(px.sectionCaret!).toBeGreaterThan(px.rowMax!);

      // AND THE TARGET DOES NOT MOVE. This is the assertion that keeps the
      // earlier fix's work: `py-1 -my-1` made the heading line a 24px target
      // deliberately, and a "bigger caret" that reached the glyph by trimming
      // the padding would pass the line above while undoing it. Legible and
      // hittable are separate properties of one control, so both are measured.
      const target = await page
        .locator('[data-group-toggle]')
        .first()
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { h: Math.round(r.height), w: Math.round(r.width) };
        });
      expect(target.h).toBeGreaterThanOrEqual(MIN_TARGET);
    } finally {
      await page.close();
    }
  });

  it('stops the plan heading being the smallest text on the page', async () => {
    const page = await open();
    try {
      const px = await fontSizes(page);
      expect(px.planHeading).toBeGreaterThan(0);
      // A LABEL NOT SMALLER THAN WHAT IT LABELS. At `text-[11px]` this heading
      // sat under the 13px branch names it introduces — the section's defect
      // one level down.
      expect(px.planHeading!).toBeGreaterThanOrEqual(px.rowMax!);
      // AND STILL BELOW THE SECTION. Two sizes for three levels was the
      // decision — this heading sits in a tinted, outlined box that already
      // says *inside a section* — so it must not climb to the section's size
      // and flatten the one distinction this branch draws.
      expect(px.planHeading!).toBeLessThan(px.section!);
    } finally {
      await page.close();
    }
  });

  it('keeps a section foldable, with aria-expanded tracking the fold', async () => {
    const page = await open();
    try {
      // The heading is a BUTTON, and growing its type is exactly the kind of
      // change that turns one into a `<span>` by accident. The fold is the
      // reason the heading is interactive at all.
      const toggle = page.locator('[data-group-toggle]').first();
      await expect.poll(() => toggle.count()).toBe(1);
      const rows = () =>
        page
          .locator('section')
          .filter({ has: page.locator('[data-group-toggle]') })
          .first()
          .locator('ul[role="grid"]')
          .count();

      // From a KNOWN state: the fold is remembered across sessions, so a test
      // that assumes open passes or fails on what a previous run left behind.
      if ((await toggle.getAttribute('aria-expanded')) === 'false') {
        await toggle.click();
      }
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      await expect.poll(rows).toBe(1);

      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      // The BODY GOES, not merely the attribute — a fold that flips a label and
      // leaves the rows on screen is the state this assertion exists to catch.
      await expect.poll(rows).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ─── A plan group has an edge, so it stops absorbing what follows ────────

  it('closes the plan group after its last branch, with the issue rows outside it', async () => {
    const page = await open();
    try {
      const section = grid(page, 'Waiting on you');
      const group = section.locator('li[data-plan-group="fix-leaky-hose"]');
      await expect.poll(() => group.count()).toBe(1);
      // THE EDGE IS DRAWN, on all four sides. A group whose only boundary was
      // a row-weight rule under its last member is the one arrangement that
      // reads as continuing past it.
      //
      // Asserted on the RENDERED edge rather than on `border-*`: the edge is an
      // `outline`, because a border plus the margin it needs insets the rows
      // inside the group and costs the column alignment every row in the fleet
      // shares. Reading both is what keeps this test about the edge rather than
      // about one way of drawing it.
      const edge = await group.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          outline: parseFloat(s.outlineWidth) || 0,
          border: parseFloat(s.borderBottomWidth) || 0,
          style: s.outlineStyle,
        };
      });
      expect(Math.max(edge.outline, edge.border)).toBeGreaterThan(0);
      expect(edge.outline > 0 ? edge.style : 'solid').not.toBe('none');
      // AND IT COSTS NO ALIGNMENT — measured WITHIN each row, which is what
      // that claim can mean once rows nest.
      //
      // It compared absolute x: a cell inside the group against a plan head
      // outside it, expecting the same pixel. Measured, they differ by 50 —
      // two levels of `ml-6` plus each group's rule, because one row sits two
      // folds deep and the other at the top. That is the INDENT, drawn on
      // purpose, and asserting it away would assert that nesting is invisible.
      //
      // The property the tracks exist for is that a row's cells land on the
      // same offsets whatever the row's depth, so it is asked of the offsets.
      const offsets = await page.evaluate(() => {
        const first = (sel: string) => {
          const cell = document.querySelector(`${sel} [role="gridcell"]`);
          const li = cell?.closest('li');
          if (!cell || !li) return null;
          return Math.round(cell.getBoundingClientRect().x - li.getBoundingClientRect().x);
        };
        return { inside: first('li[data-agent-row]'), outside: first('li[data-plan-row]') };
      });
      expect(offsets.inside, `inside ${offsets.inside} outside ${offsets.outside}`)
        .toBe(offsets.outside);
      // AND THE ISSUE ROWS ARE OUTSIDE IT. This is the half a border alone does
      // not buy: #227 and #228 belong to no plan, and the layout must place
      // them where nothing claims they do.
      for (const number of [227, 228]) {
        const link = section.locator(`[data-issue-link][href$="/${number}"]`);
        await expect.poll(() => link.count()).toBe(1);
        await expect.poll(() =>
          group.locator(`[data-issue-link][href$="/${number}"]`).count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('matches the count beside a plan name to the rows inside its group', async () => {
    const page = await open();
    try {
      // The consequence the plan names: a heading reading `(5)` above seven
      // lines makes the reader arbitrate between the number and the layout.
      const section = grid(page, 'Waiting on you');
      const group = section.locator('li[data-plan-group="zucchini-glut"]');
      await expect.poll(() => group.count()).toBe(1);
      const inside = await group.locator('li[data-agent-row]').count();
      // THE COUNT IS ON THE PLAN ROW, not in an `h3`. A plan heads its group
      // with a row since the wave kind landed, and the tally moved with it.
      // `li[data-plan-row]`, not the bare attribute: the fold button inside the
      // row carries it too, and `.first()` on the attribute alone reads the
      // caret — measured, it returned `▸`.
      const head = await group.locator('li[data-plan-row]').first().innerText();
      expect(head, `${inside} rows inside, head reads: ${head}`)
        .toContain(`(${inside})`);
    } finally {
      await page.close();
    }
  });

  // ─── The plan row hosts the approval that belongs to a plan ──────────────

  it('offers approval on a DRAFT plan row', async () => {
    // THE REAL BOARD: the control is gated on a capability, not on a payload.
    const page = await openReal();
    try {
      // Measured 2026-08-19: `ApproveButton` existed, the server reported
      // `approve: {available: true}`, the card read `phase: Discovery` — and the
      // button rendered inside the `⋯` menu of a BRANCH row, which a Draft plan
      // never has, because a Draft branch has nothing to start. So the plan
      // whose whole state was *waiting for a person to approve it* offered that
      // person nothing to click.
      const planRow = grid(page, 'Not started').locator('li[data-plan-row="plant-tomatoes"]');
      await expect.poll(() => planRow.count()).toBe(1);
      const menu = planRow.locator('[data-plan-actions="plant-tomatoes"]');
      await expect.poll(() => menu.count(), { timeout: 10_000 }).toBe(1);
      // It OPENS, and the button is in it. A control that renders and refuses to
      // open passes a presence assertion and changes nothing for the operator.
      await menu.click();
      await expect.poll(() =>
        planRow.locator('[role="menu"]').getByRole('button', { name: /approve/i }).count(),
        { timeout: 5_000 }).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers it on NO plan past Draft', async () => {
    const page = await open();
    try {
      // The other half, and the one an over-eager implementation loses: approve
      // is the plan's act only while the plan is Draft. `plot-approve.sh`
      // refuses every other phase, so a row offering it would be inviting a
      // refusal.
      for (const plan of ['strawberry-netting']) {
        const planRow = grid(page, 'Not started').locator(`li[data-plan-row="${plan}"]`);
        await expect.poll(() => planRow.count()).toBe(1);
        await expect.poll(() => planRow.locator('[data-plan-actions]').count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('keeps the plan row cells aligned once the actions cell exists', async () => {
    const page = await open();
    try {
      // The actions track is new, and a new track is exactly how a row loses
      // its alignment. The clock is the cell before it: a Draft plan (with a
      // menu) and a plan past Draft (without one) must land theirs at one x, or
      // the column the track exists to hold has moved.
      const clockRight = async (plan: string) => {
        const cells = grid(page, 'Not started')
          .locator(`li[data-plan-row="${plan}"] [role="gridcell"]`);
        const box = await cells.nth(3).boundingBox();
        return Math.round(box?.x ?? -1);
      };
      const draft = await clockRight('plant-tomatoes');
      const approved = await clockRight('strawberry-netting');
      expect(draft).toBeGreaterThan(0);
      expect(Math.abs(draft - approved)).toBeLessThanOrEqual(1);
    } finally {
      await page.close();
    }
  });

  // ─── A deferred row states the reason recorded in its annotation ─────────

  it('renders the deferral reason its plan recorded', async () => {
    const page = await open();
    try {
      // The sentence had been in the plan file since the day the branch was
      // shelved; `plot-plan-meta.sh` tested for the annotation's PRESENCE and
      // dropped the text after the colon. So `deferred` and `no commits` sat
      // side by side as two unrelated facts, when the first is the reason for
      // the second.
      const branchRow = grid(page, 'Waiting on you').locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/give-them-away"]') });
      await expect.poll(() => branchRow.count()).toBe(1);
      await expect.poll(() => branchRow.locator('[data-deferred]').count()).toBe(1);
      // IN THE ROW, not only under a hover: a `title` is unreachable by touch
      // and by keyboard, and this sentence is the whole answer to *what do I do
      // with this row*.
      //
      // ON ITS OWN LINE, and that placement is load-bearing rather than
      // decorative. Two bounded cells were tried first and each broke: beside
      // the branch name the sentence crushed
      // `bug/the-no-ref-arm-reads-the-join` to `b… ads-the-join`, and in the
      // fixed `14rem` note cell `truncate` gave it zero width so it rendered as
      // nothing at all. Both were measured on screen. The row's own second line
      // — the shape a stuck row already uses for its evidence — is the one place
      // a sentence fits without spending a column.
      await expect.poll(() =>
        branchRow.locator('[data-deferred-reason]').textContent())
        .toContain('startRepair() at fleet.ts:806');
      // AND THE BRANCH NAME SURVIVES IT. This is the half the first
      // implementation lost: the branch is the row's primary key and the only
      // cell that flexes, so a sentence sharing it wins and the name is what
      // pays.
      //
      // MEASURED ON THE TAIL, because the name is two spans and only one of
      // them is allowed to yield. `BranchLabel` folds a long name in the
      // MIDDLE — a `truncate` head that gives up width and a `shrink-0` tail
      // that never does — so the tail is where "the name survived" is decided.
      // `splitBranch` states the reason: six branches here share twenty-four
      // characters of prefix, so the suffix is what tells them apart and a
      // reader who loses it loses the row's identity.
      //
      // This assertion replaced one on the OUTER span's `scrollWidth >
      // clientWidth`, which was correct for a single-span name and reports
      // every folded name as crushed. Measured 2026-08-21 for this row in its
      // 81px slot: outer scroll 94 against client 81 — *because* the head
      // collapsed to 0 and handed its width to a 94px tail that clipped
      // nothing. The old measure called the mechanism working as designed a
      // failure, and would go on doing so for every name long enough to fold.
      //
      // The clipped head is deliberately NOT asserted. It is the give in the
      // design, and pinning it would forbid the fold this row depends on.
      const tail = branchRow.locator('[data-branch] > span > span').last();
      const clipped = await tail.evaluate((el) => ({
        text: el.textContent ?? '',
        overflowing: el.scrollWidth > el.clientWidth + 1,
      }));
      // The tail renders whole: no ellipsis of its own, at its full width.
      expect(clipped.overflowing).toBe(false);
      // AND IT IS THE HALF THAT DISTINGUISHES. A tail that survived by being
      // empty passes the line above and identifies nothing, which is the same
      // defect one step along — so the surviving text has to be the end of the
      // name a reader would search for.
      expect(clipped.text.length).toBeGreaterThan(0);
      expect('feature/give-them-away'.endsWith(clipped.text)).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('still reads as deferred where the plan recorded no reason', async () => {
    const page = await open();
    try {
      // The bare `<!-- deferred -->`. The badge is the state and must survive on
      // its own; a sentence invented to fill the space would be the same defect
      // from the other side.
      const branchRow = grid(page, 'Waiting on you').locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/pickle-the-rest"]') });
      await expect.poll(() => branchRow.count()).toBe(1);
      await expect.poll(() => branchRow.locator('[data-deferred]').textContent())
        .toContain('deferred');
      await expect.poll(() => branchRow.locator('[data-deferred-reason]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ─── Every pointer target reaches 24 x 24, and the fold is legible ───────

  it('gives every pointer target at least 24 px in both directions', async () => {
    const page = await open();
    try {
      // MEASURED 2026-08-19 at 1480px: 37 elements under 24 px in one
      // direction. `data-wave-toggle` was 5 x 10 at `font-size: 10px` — a fifth
      // of the smallest published minimum, and the control that answers *is
      // there more here?*
      //
      // The sweep runs over the SELECTORS the plan measured, so a target that
      // regresses is named rather than counted.
      // OPEN WHATEVER FOLDS, rather than one named plan. This clicked
      // `[data-wave-toggle="strawberry-netting"]`, and that plan draws no fold:
      // measured, only `zucchini-glut` and `fix-leaky-hose` carry one, because a
      // fold is drawn per foldable GROUP and these four plans sit in different
      // sections. The click waited out its 30s timeout on a control that was
      // never going to exist.
      //
      // What this test needs is any folded thing opened, so more targets are on
      // screen to measure — not a particular plan's.
      await expandAgentFolds(page);
      const small = await page.evaluate((min) => {
        const selectors = [
          '[data-wave-toggle]',
          '[data-row-actions]',
          '[data-plan-actions] button',
          '[data-pr-link]',
          '[data-issue-link]',
          '[data-group-toggle]',
        ];
        const bad: string[] = [];
        for (const sel of selectors) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            const r = el.getBoundingClientRect();
            // Zero-sized means not rendered (a folded section), not a failure.
            if (r.width === 0 && r.height === 0) continue;
            if (r.width < min || r.height < min) {
              bad.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`);
            }
          }
        }
        return bad;
      }, MIN_TARGET);
      expect(small).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('distinguishes the two fold states without reading five pixels of glyph', async () => {
    const page = await open();
    try {
      // `zucchini-glut`, because it HAS a fold. This read `strawberry-netting`,
      // which draws none — a fold is drawn per foldable group, and these plans
      // sit in different sections. Every locator here then waited out its 30s
      // timeout on a control that does not exist.
      // The reason a reader could not tell a folded plan from an empty one was
      // not the wording of the summary: it was that the ONLY difference between
      // `▸` and `▾` was five pixels of caret, in two shapes of near-equal mass.
      //
      // Asserted on the RENDERED GEOMETRY, which is what a screenshot shows:
      // one glyph rotated 90 degrees differs by orientation rather than by
      // typeface. Read as `rotate` and `transform` together — Tailwind v4 emits
      // the standalone `rotate` property, and asserting on only one of the two
      // would make this test pass for the wrong reason if that ever changes.
      const orientation = () =>
        page.locator('[data-wave-toggle="zucchini-glut"] span[aria-hidden]')
          .evaluate((el) => {
            const s = getComputedStyle(el);
            return `${s.rotate}|${s.transform}`;
          });
      const toggle = page.locator('[data-wave-toggle="zucchini-glut"]');
      // Start from a KNOWN state rather than from whichever one the page
      // happens to be in — the fold is remembered across sessions, so a test
      // that assumes "shut" asserts on the wrong half whenever it is not.
      if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
      // WAITED FOR, because `transition-transform` animates the glyph: reading
      // `rotate` in the same tick as the click catches the transition mid-flight
      // and reports the state being LEFT. Measured: `aria-expanded="false"` on
      // the button and `90deg` on the glyph inside it, which no render produces
      // — both read the same `expanded` prop.
      await expect.poll(orientation, { timeout: 5_000 }).not.toContain('90deg');
      const shut = await orientation();
      expect(shut).not.toContain('90deg');
      await toggle.click();
      // WAITED FOR, then asserted with a PLAIN `expect`.
      //
      // `expect.poll(...).toMatch(...)` is not a supported combination in this
      // vitest: it resolves at once and passes whatever the value is. Measured
      // while writing this test — the same call passed against
      // `/DEFINITELY_NOT_THERE/`. So the waiting is done by Playwright, which
      // throws on timeout, and the assertion runs on the settled value.
      // `transition-transform` means the quarter turn takes a frame or two, and
      // reading mid-flight reports an angle nobody designed.
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-wave-toggle="zucchini-glut"] span[aria-hidden]');
        return !!el && getComputedStyle(el).rotate === '90deg';
      }, undefined, { timeout: 5_000 });
      const turned = await orientation();
      expect(turned).toContain('90deg');
      expect(turned).not.toBe(shut);
      // And `aria-expanded` still carries it for a reader who sees no geometry
      // at all.
      await expect.poll(() =>
        page.locator('[data-wave-toggle="zucchini-glut"]').getAttribute('aria-expanded'))
        .toBe('true');
    } finally {
      await page.close();
    }
  });

  it('regresses nothing below the card breakpoint', async () => {
    const page = await open(420);
    try {
      // Below `CARD_BELOW_PX` the row stops being a row and becomes a card, and
      // every one of these changes is a grid property. The card form must still
      // render its facts — the branch, the deferral and its reason among them.
      const branchRow = page.locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/give-them-away"]') });
      await expect.poll(() => branchRow.count(), { timeout: 10_000 }).toBe(1);
      await expect.poll(() => branchRow.locator('[data-deferred]').count()).toBe(1);
      await expect.poll(() =>
        branchRow.locator('[data-deferred-reason]').textContent())
        .toContain('startRepair()');
      // And the page must not scroll sideways: a widened target that pushes the
      // row past the viewport trades one defect for another.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    } finally {
      await page.close();
    }
  });
});
