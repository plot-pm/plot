import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import type { AgentRow, Fleet } from '../../src/contract/schema.js';

/**
 * A GROUP HEADING CARRIES THE ACTIVITY OF THE ROWS BEHIND IT.
 *
 * The reported case is a COLLAPSED group, and it is not hypothetical: QUIET and
 * DONE are in `COLLAPSED_BY_DEFAULT` and the fold is persisted in
 * `localStorage`, so they stay shut across sessions. A folded heading reports
 * `(4)` — a STOCK count that says *four rows are in here* and never *one of them
 * is moving*. QUIET's own purpose is *"go check whether this died"*, so the one
 * group whose job is surfacing possible deaths was folded shut showing a number.
 *
 * `groupPace` and `headingPace` are pure functions pinned in
 * `test/unit/agent-list.test.ts`. None of that can answer what is here:
 *
 * - that the mark renders on a heading whose rows are NOT IN THE DOM at all,
 *   which is the whole point and which a unit test cannot state;
 * - that an expanded heading drops the spinner and its rows carry it;
 * - that in a heading it flows as text, inside the heading's own box;
 * - that the toggle button's accessible name does not gain the mark's `title`;
 * - that the tally `(4)` still says what it always said.
 *
 * `/api/fleet` is stubbed at the network boundary, the way the sibling suites do
 * it: every claim is about what the tab RENDERS from a pulse.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null,
  localDirty: false, localLocked: false, stuck: null,
  // No PLOT-BLOCKED marker. The schema defaults this to null, and the Delivery
  // tab reads an absent value as a marker.
  question: null,
  ...over,
});

const fleet = (rows: AgentRow[]): Fleet => ({
  generatedAt: new Date().toISOString(),
  ageSeconds: 1, ready: true, error: null, rows,
  // WORKING renders from the registry since
  // `the-working-section-shows-every-worker`: a WORKING row appears only where
  // an agent names its branch, so the group's own rows — and the pace mark its
  // heading carries — come from these entries.
  agents: rows
    .filter((r) => r.group === 'working')
    .map((r) => ({
      session: `s-${r.branch}`, branch: r.branch, worktree: `/wt/plot-wt-${r.branch}`,
      command: '', startedAt: '', pid: '', previousPid: '', relaunches: 0,
      state: 'running' as const,
    })),
  summary: {
    plans: 1, waves: 1, branches: rows.length,
    claimed: 0, eligible: 0, blocked: 0, deferred: 0,
  },
  prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
} as Fleet);

/**
 * A QUIET group holding a row that is being written to, and a DONE group that
 * is not.
 *
 * QUIET because it is in `COLLAPSED_BY_DEFAULT` — so it renders FOLDED with no
 * further interaction, which is the reported case exactly. The DONE group is
 * the negative half: a heading that always carried the mark would say nothing,
 * and a single group cannot state that.
 *
 * `localDirty` rather than `localLocked`: a lock also lights the mark, but it
 * arrives through the echo and a fixture using it would be asserting the echo's
 * timing rather than this wave's rule.
 */
const FOLDED = [
  row({
    // A PROCESS AND A WRITE. The dot reads the process since 2026-08-22 —
    // `localDirty` alone is a person editing, which the background flash
    // reports — and the local signal still sets the PACE, so this row is the
    // fast case: a worker running AND writing.
    branch: 'feature/dying', group: 'quiet', worker: 'running', localDirty: true,
    note: 'last commit 40 min ago', branchUrl: `${GH}feature/dying`,
  }),
  row({
    branch: 'feature/also-quiet', group: 'quiet',
    note: 'last commit 3 days ago', branchUrl: `${GH}feature/also-quiet`,
  }),
  row({
    branch: 'feature/finished', wave: 'Finished', group: 'done', state: 'merged',
    note: 'merged', branchUrl: `${GH}feature/finished`,
  }),
];

describe('a group heading carries the activity of the rows behind it', () => {
  // THE STATE IS SERVED, NOT SPAWNED AND STUBBED.
  //
  // This file started `board-server.mjs` over the tiny-garden fixture only to
  // serve `index.html`: it never read `/api/board`, and stubbed `/api/fleet`
  // itself. The mock serves the same built client and answers both payloads by
  // name, so the test states its own input instead of inheriting an estate.
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(rows: AgentRow[] = FOLDED): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: fleet(rows) },
      viewport: { width: 1400, height: 900 },
    });
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  /** The group or section for a key — its heading and, when open, its rows. */
  const sectionFor = (page: Page, key: string) =>
    page.locator(`[data-group="${key}"], [data-section="${key}"]`);

  const toggleFor = (page: Page, key: string) =>
    page.locator(`[data-group-toggle="${key}"]`);

  /** The heading of a group or section: an h3 for a group, an h2 for a section. */
  const headingFor = (page: Page, key: string) =>
    page.locator(`[data-delivery-group="${key}"], [data-delivery-section="${key}"]`);

  /** Fold a group the reader finds open, so the heading stands for rows it hides. */
  const fold = async (page: Page, key: string) => {
    await toggleFor(page, key).waitFor({ timeout: 10_000 });
    if ((await toggleFor(page, key).getAttribute('aria-expanded')) === 'true') await toggleFor(page, key).click();
    await expect.poll(() => toggleFor(page, key).getAttribute('aria-expanded')).toBe('false');
  };

  const markInHeading = (page: Page, key: string) =>
    headingFor(page, key).locator('[data-activity-spinner]');

  /** The spinner glyph's resolved `::before` style. */
  const glyphOf = (locator: ReturnType<typeof markInHeading>) =>
    locator.first().evaluate((el) => {
      const s = getComputedStyle(el, '::before');
      return { content: s.content, animationName: s.animationName, animationDuration: s.animationDuration };
    });

  // ── A folded PLAN speaks for its branches ─────────────────────────────────

  it('flashes the PLAN HEAD when a branch folded beneath it changes', async () => {
    // THE SECOND FOLD, one level in from this suite's subject. A section can be
    // collapsed — that is everything above — and so can a PLAN inside an open
    // section. Reported from the live board: a write landed on a branch whose
    // plan was folded, the row that flashed was not in the DOM, and the reader
    // saw nothing at all.
    //
    // The wave row already aggregated (`wg.rows.some(...)`); the plan head did
    // so for the ACTIVITY mark and not for this one. Two marks, one aggregation
    // rule — a head speaks for its branches or it says nothing about them.
    const page = await open([
      row({
        branch: 'feature/deep', group: 'waiting-on-you', plan: 'plant-tomatoes',
        planFile: '2026-03-01-plant-tomatoes.md', wave: 'w',
        branchUrl: `${GH}feature/deep`,
      }),
    ]);
    // Fold the plan, so the branch's own row leaves the tree.
    for (const t of await page.locator('[data-slice-toggle]').all()) {
      if (await t.getAttribute('aria-expanded') === 'true') await t.click();
    }
    await expect.poll(() => page.locator('[data-plan-row]').count()).toBeGreaterThan(0);
    // The head is present and the branch row is not — which is what makes the
    // head the only thing that can report the change.
    expect(await page.locator('[data-branch="feature/deep"]').count()).toBe(0);
  });

  it('does NOT flash the head once the branches are on screen', async () => {
    // THE OTHER HALF, and it is what keeps the first honest. Open, the rows
    // flash for themselves; a head flashing alongside them tints two lines for
    // one event, and the reader sees a second change that never happened.
    //
    // Asserted through the SOURCE rather than through a pulse, because the
    // claim is a condition rather than a timing: the head's mark is gated on
    // `expanded === false`. A browser assertion would have to catch a 3s flash
    // inside an 18s scan window, which measures the scan.
    //
    // `=== false`, not `!expanded`: the prop is `boolean | null` and null means
    // *this plan has no fold*. A head with nothing to hide hides nothing, so
    // its branch is right there flashing and the head must stay quiet.
    //
    // Read from `lib/agent-rows/rows.tsx`, which is where `PlanRow` lives since
    // `the-components-leave-the-shell` split the row estate out of the shell. A
    // scan of `AgentList.tsx` would now match nothing and fail loudly, which is
    // the benign direction — but the fact being asserted is about the plan
    // HEAD, so it follows the component that renders one.
    const source = readFileSync(
      new URL('../../src/app/lib/agent-rows/rows.tsx', import.meta.url), 'utf8');
    expect(source).toContain('marked && expanded === false ? <ChangeMark /> : null');
  });

  // ── The reported case ──────────────────────────────────────────────────────

  it('marks a COLLAPSED group whose row is being written to', async () => {
    // The row is removed from the tree, so the heading is the only thing on the
    // page that can say anything about it.
    const page = await open();
    await fold(page, 'queued');
    expect(await toggleFor(page, 'queued').getAttribute('aria-expanded')).toBe('false');
    expect(await sectionFor(page, 'queued').locator('li[data-tuple-kind]').count()).toBe(0);
    await expect.poll(() => markInHeading(page, 'queued').count()).toBe(1);
  });

  it('leaves a collapsed group with NO active row unmarked', async () => {
    const page = await open();
    await page.locator('[data-delivery-section="release-delivery"]').waitFor({ timeout: 10_000 });
    await toggleFor(page, 'release-delivery').click({ position: { x: 4, y: 8 } });
    await expect.poll(() => toggleFor(page, 'release-delivery').getAttribute('aria-expanded')).toBe('false');
    expect(await markInHeading(page, 'release-delivery').count()).toBe(0);
  });

  it('drops the heading spinner when the group is EXPANDED, and the row carries it', async () => {
    // An open heading shows nothing: its rows show their own spinners in their
    // Status cells, so the heading would only say it twice.
    const page = await open();
    await fold(page, 'queued');
    await expect.poll(() => markInHeading(page, 'queued').count()).toBe(1);
    await toggleFor(page, 'queued').click();
    await expect.poll(() => toggleFor(page, 'queued').getAttribute('aria-expanded')).toBe('true');
    await expect.poll(() =>
      sectionFor(page, 'queued').locator('li[data-tuple-kind]').count()).toBeGreaterThan(0);
    expect(await markInHeading(page, 'queued').count()).toBe(0);
    await expect.poll(() => sectionFor(page, 'queued')
      .locator('li[data-tuple-kind] [data-row-cell="status"] [data-activity-spinner]').count())
      .toBeGreaterThan(0);
  });

  it('states the same pace folded as the row states open', async () => {
    const page = await open();
    await fold(page, 'queued');
    await expect.poll(() => markInHeading(page, 'queued').count()).toBe(1);
    const folded = await markInHeading(page, 'queued').getAttribute('data-activity-pace');
    await toggleFor(page, 'queued').click();
    const rowMark = sectionFor(page, 'queued')
      .locator('li[data-tuple-kind] [data-activity-spinner]');
    await expect.poll(() => rowMark.count()).toBeGreaterThan(0);
    expect(await rowMark.first().getAttribute('data-activity-pace')).toBe(folded);
  });

  it('shows no heading spinner on an open SECTION, so nothing wraps onto its own line', async () => {
    // The You card's heading holds the stage line (`Discovery 20 → Design 0
    // → …`); a spinner after it wrapped onto a line of its own.
    const page = await open();
    for (const key of ['you', 'fleet', 'release-delivery']) {
      const heading = page.locator(`[data-delivery-section="${key}"]`);
      if ((await heading.count()) === 0) continue;
      const toggle = toggleFor(page, key);
      if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') continue;
      expect(await heading.locator('[data-activity-spinner]').count(), `${key} heading`).toBe(0);
    }
  });

  // ── Where it sits ─────────────────────────────────────────────────────────

  it('flows in the heading as text', async () => {
    const page = await open();
    await fold(page, 'queued');
    await expect.poll(() => markInHeading(page, 'queued').count()).toBe(1);
    const position = await markInHeading(page, 'queued')
      .evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('static');
  });

  it('sits INSIDE its own heading, beside the words', async () => {
    const page = await open();
    await fold(page, 'queued');
    await expect.poll(() => markInHeading(page, 'queued').count()).toBe(1);
    const mark = (await markInHeading(page, 'queued').boundingBox())!;
    const heading = (await headingFor(page, 'queued').boundingBox())!;
    expect(mark.x).toBeGreaterThanOrEqual(heading.x - 0.5);
    expect(mark.x + mark.width).toBeLessThanOrEqual(heading.x + heading.width + 0.5);
    expect(mark.y).toBeGreaterThanOrEqual(heading.y - 0.5);
    expect(mark.y + mark.height).toBeLessThanOrEqual(heading.y + heading.height + 0.5);
    expect(mark.width).toBeGreaterThan(0);
    expect(mark.height).toBeGreaterThan(0);
  });

  it('does not push the heading onto a second line', async () => {
    const page = await open();
    await fold(page, 'queued');
    await expect.poll(() => markInHeading(page, 'queued').count()).toBe(1);
    const heading = headingFor(page, 'queued');
    const marked = (await heading.boundingBox())!;
    const line = await heading.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect(marked.height).toBeLessThan(line * 1.5);
  });

  // ── What it says, and to whom ─────────────────────────────────────────────

  it('says nothing to a screen reader, and nothing to the toggle\'s name', async () => {
    const page = await open();
    await fold(page, 'queued');
    await expect.poll(() => markInHeading(page, 'queued').count()).toBe(1);
    expect(await markInHeading(page, 'queued').getAttribute('aria-hidden')).toBe('true');
    const name = await toggleFor(page, 'queued')
      .evaluate((el) => (el as HTMLElement).innerText);
    expect(name.toLowerCase()).not.toMatch(/write is in progress|claimed, and no write/);
  });

  it('leaves the tally saying exactly what it always said', async () => {
    const page = await open();
    await fold(page, 'queued');
    await expect.poll(() => toggleFor(page, 'queued').count()).toBe(1);
    const text = await page.locator('h3[data-delivery-group="queued"]').innerText();
    expect(text).toContain('(1)');
    expect(text).not.toMatch(/active|\(\d+\s*,/);
  });

  it('cycles the same braille frames the rows cycle', async () => {
    const page = await open();
    await fold(page, 'queued');
    await expect.poll(() => markInHeading(page, 'queued').count()).toBe(1);
    const glyph = await glyphOf(markInHeading(page, 'queued'));
    expect(glyph.animationName).toBe('activity-spinner');
    expect(glyph.content).toMatch(/^"[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]"$/);
  });
});

/**
 * The pace a collapsed heading states: the strongest one its rows state. A
 * group holding one written-to row among claimed ones is `fast`; a group
 * holding only claimed rows is `slow`.
 */
describe('a collapsed heading shows the strongest pace its rows state', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(rows: AgentRow[]): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: fleet(rows) },
      viewport: { width: 1400, height: 900 },
    });
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  const toggleFor = (page: Page, key: string) =>
    page.locator(`[data-group-toggle="${key}"]`);

  const fold = async (page: Page, key: string) => {
    await toggleFor(page, key).waitFor({ timeout: 10_000 });
    if ((await toggleFor(page, key).getAttribute('aria-expanded')) === 'true') await toggleFor(page, key).click();
    await expect.poll(() => toggleFor(page, key).getAttribute('aria-expanded')).toBe('false');
  };

  const headingMark = (page: Page, key: string) =>
    page.locator(`[data-delivery-group="${key}"], [data-delivery-section="${key}"]`)
      .locator('[data-activity-spinner]');

  /** The key of the section that holds the `working` group. */
  const sectionOfWorking = async (page: Page) => {
    const section = page.locator('section[data-section]')
      .filter({ has: page.locator('[data-group="working"]') });
    await section.first().waitFor({ timeout: 10_000 });
    return (await section.first().getAttribute('data-section'))!;
  };

  const durationOf = (locator: ReturnType<typeof headingMark>) =>
    locator.first().evaluate((el) => getComputedStyle(el, '::before').animationDuration);

  it('is FAST for a group holding one measured row among claimed ones', async () => {
    const page = await open([
      row({ branch: 'feature/claimed-a', group: 'quiet', branchUrl: `${GH}feature/claimed-a` }),
      row({ branch: 'feature/claimed-b', group: 'quiet', branchUrl: `${GH}feature/claimed-b` }),
      row({
        branch: 'feature/writing', group: 'quiet', worker: 'running', localDirty: true,
        branchUrl: `${GH}feature/writing`,
      }),
    ]);
    await fold(page, 'queued');
    await expect.poll(() => headingMark(page, 'queued').count()).toBe(1);
    expect(await headingMark(page, 'queued').getAttribute('data-activity-pace')).toBe('fast');
  });

  it('is SLOW for a section holding only CLAIMED rows', async () => {
    // The `working` group never folds, so its section's heading speaks for it.
    const page = await open([
      row({ branch: 'feature/claimed', group: 'working', note: 'claimed, no known worker' }),
    ]);
    const key = await sectionOfWorking(page);
    await fold(page, key);
    await expect.poll(() => headingMark(page, key).count()).toBe(1);
    expect(await headingMark(page, key).getAttribute('data-activity-pace')).toBe('slow');
  });

  it('resolves to the same frame duration the row uses', async () => {
    const page = await open([
      row({
        branch: 'feature/writing', group: 'quiet', worker: 'running', localDirty: true,
        branchUrl: `${GH}feature/writing`,
      }),
    ]);
    await fold(page, 'queued');
    await expect.poll(() => headingMark(page, 'queued').count()).toBe(1);
    const heading = await durationOf(headingMark(page, 'queued'));
    await toggleFor(page, 'queued').click();
    const inRow = page.locator('li[data-tuple-kind]')
      .filter({ has: page.locator('[data-branch="feature/writing"]') }).last()
      .locator('[data-activity-spinner]');
    await expect.poll(() => inRow.count()).toBe(1);
    expect(heading).toBe(await durationOf(inRow));
    expect(Number.parseFloat(heading)).toBeGreaterThan(0);
  });
});
