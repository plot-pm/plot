import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import type { AgentRow, Fleet, Stuck } from '../../src/contract/schema.js';

/**
 * The activity spinner's appearance — the half only a real page can settle.
 *
 * `activityPace`, `groupPace`, the class list and the keyframes are pinned in
 * `test/unit/agent-list.test.ts`. This suite asserts what the browser resolves:
 *
 * - the spinner sits in the row's Status cell, before the status word, on the
 *   status word's line;
 * - its `::before` glyph cycles through the braille frames at two rates;
 * - under `prefers-reduced-motion: reduce` it stays and shows the static frame;
 * - the grid tracks do not move for it;
 * - it is `aria-hidden` and names its local-only limit in its `title`.
 *
 * `/api/fleet` is stubbed at the network boundary: every claim here is about
 * what the tab renders from a pulse.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const GH = 'https://github.com/tiny/garden/tree/';

const row =(over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', planState: 'approved', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null,
  // A RUNNING WORKER BY DEFAULT, because that is what this suite is about.
  //
  // Every row here used to say `localDirty: true` to mean *this row is active*,
  // and that was the definition until 2026-08-22: the dot read the WORKTREE.
  // It now reads the PROCESS — a live worker, or CI running — because a person
  // editing files is not a machine, and the row for the branch being committed
  // to pulsed for hours while nothing but a person typed in it.
  //
  // So the fixture states the process, and the local fields keep their own
  // meaning: they set the PACE. A row with a worker and a clean worktree
  // spins slow; the same row with `localDirty` spins fast.
  worker: 'running',
  localDirty: false, localLocked: false, localAhead: 0, stuck: null, ...over,
});

const fleet = (rows: AgentRow[]): Fleet => ({
  generatedAt: new Date().toISOString(),
  ageSeconds: 1, ready: true, error: null, rows,
  // WORKING renders from the registry since
  // `the-working-section-shows-every-worker`, so a WORKING row — the one that
  // carries the spinner — appears only where an agent names its branch.
  // One entry per `working` branch; the mark's presence and pace still read the
  // joined row's `worker` and local signals.
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
 * Two rows differing ONLY in whether a write is in progress.
 *
 * The pair is what makes the track assertion mean anything: a mark that pushed
 * the columns in would move them on the marked row and not on the other, and a
 * single row cannot state that.
 *
 * Both rows sit in WORKING and render from the registry — the pair must be the
 * SAME KIND for a geometry comparison to mean anything, and a WORKING row is an
 * agent row now. `feature/writing` carries the mark (a live worker, dirty
 * worktree → fast); `feature/idle` is the negative case, a worker whose process
 * is gone (`stalled`, `worker: 'none'`) so `isActive` is false and it draws no
 * mark. Same structure, one marked and one not, which is exactly what the "the
 * mark costs the grid nothing" claim needs.
 *
 * A WORKING row appears only where an agent names its branch; the fixture's
 * `fleet()` derives one per working row, so both rows render. The MARK is gated
 * on `row.worker` (a process), not on the agent's state, so `feature/idle` with
 * `worker: 'none'` draws none while `feature/writing` does.
 */
const PAIR = [
  row({ branch: 'feature/writing', localDirty: true, branchUrl: `${GH}feature/writing` }),
  // IDLE MEANS NO PROCESS, stated rather than inherited. The factory gives every
  // row a running worker because that is what this suite is about; this one row
  // says otherwise, which is what makes it the negative case — a WORKING row
  // whose worker is gone draws no spinner.
  row({ branch: 'feature/idle', worker: 'none', branchUrl: `${GH}feature/idle` }),
];

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

const rowFor = (page: Page, branch: string) =>
  // The row that carries this branch, whatever kind of row states it: a
  // branch in a wave renders as its wave row.
  page.locator('li').filter({ has: page.locator(`[data-branch="${branch}"]`) })
    .filter({ has: page.locator('[role="gridcell"]') }).last();

const spinnerIn = (page: Page, branch: string) =>
  rowFor(page, branch).locator('[data-activity-spinner]');

/** The glyph's resolved `::before` style — never the class list. */
const glyphOf = (locator: ReturnType<typeof spinnerIn>) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return {
      content: s.content,
      animationName: s.animationName,
      animationDuration: s.animationDuration,
      animationPlayState: s.animationPlayState,
    };
  });

/** A box read without waiting for an animation to settle. */
const rectOf = (locator: ReturnType<typeof spinnerIn>) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

const midY = (box: { y: number; height: number }) => box.y + box.height / 2;

describe('the activity spinner sits in the Status cell and cycles braille frames', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  /**
   * The Agents tab at a desktop width, optionally for a reader who asked for
   * reduced motion. A separate context rather than `page.emulateMedia`, so the
   * preference holds from first paint.
   */
  async function open(
    rows: AgentRow[] = PAIR,
    opts: { reducedMotion?: 'reduce' } = {},
  ): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: fleet(rows) },
      viewport: { width: 1400, height: 900 },
      ...(opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {}),
    });
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  it('renders the spinner on the writing row and NOT on the idle one', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/writing').count()).toBe(1);
    expect(await spinnerIn(page, 'feature/idle').count()).toBe(0);
  });

  it('sits in the Status cell, before the status word, and not in the marks cell', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/writing').count()).toBe(1);
    const li = rowFor(page, 'feature/writing');
    expect(await li.locator('[data-row-cell="status"] [data-activity-spinner]').count()).toBe(1);
    expect(await li.locator('[role="gridcell"]').first().locator('[data-activity-spinner]').count()).toBe(0);
    // The spinner is the cell's first element: everything else follows it.
    const first = await li.locator('[data-row-cell="status"]')
      .evaluate((cell) => cell.firstElementChild?.hasAttribute('data-activity-spinner') ?? false);
    expect(first).toBe(true);
    // The old travelling mark is gone.
    expect(await li.locator('[data-activity-mark], [data-activity-dot], [data-activity-track]').count()).toBe(0);
  });

  it('shares the status word\'s line box, so it is centred on the text', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/writing').count()).toBe(1);
    const li = rowFor(page, 'feature/writing');
    const spinner = await rectOf(spinnerIn(page, 'feature/writing'));
    const next = await li.locator('[data-row-cell="status"]').evaluate((cell) => {
      const el = cell.firstElementChild?.nextElementSibling;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const cell = await rectOf(li.locator('[data-row-cell="status"]'));
    const reference = next ?? cell;
    expect(Math.abs(midY(spinner) - midY(reference))).toBeLessThan(4);
    if (next) expect(spinner.x + spinner.width).toBeLessThanOrEqual(next.x + 0.5);
  });

  it('cycles the braille frames — a real animation the browser resolved', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/writing').count()).toBe(1);
    const seen = await glyphOf(spinnerIn(page, 'feature/writing'));
    expect(seen.animationName).toBe('activity-spinner');
    expect(seen.animationPlayState).toBe('running');
    // Sampled over a full fast cycle: the glyph changes, and every glyph it
    // shows is one of the ten frames.
    const glyphs = await spinnerIn(page, 'feature/writing').evaluate(async (el) => {
      const out: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        out.push(getComputedStyle(el, '::before').content);
        await new Promise((r) => setTimeout(r, 45));
      }
      return out;
    });
    for (const g of glyphs) expect(FRAMES).toContain(g.replace(/^"|"$/g, ''));
    expect(new Set(glyphs).size).toBeGreaterThanOrEqual(3);
  });

  it('is emerald, set apart from the slate status text', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/writing').count()).toBe(1);
    const colours = await rowFor(page, 'feature/writing').locator('[data-row-cell="status"]')
      .evaluate((cell) => ({
        spinner: getComputedStyle(cell.querySelector('[data-activity-spinner]')!).color,
        cell: getComputedStyle(cell).color,
      }));
    expect(colours.spinner).not.toBe(colours.cell);
    expect(colours.spinner).toMatch(/oklch\([\d.]+ [\d.]+ 16\d|rgb\(5, 150, 105\)/);
  });

  it('keeps the spinner under reduced motion and shows the static frame', async () => {
    const page = await open(PAIR, { reducedMotion: 'reduce' });
    await expect.poll(() => spinnerIn(page, 'feature/writing').count()).toBe(1);
    const seen = await glyphOf(spinnerIn(page, 'feature/writing'));
    expect(seen.animationName).toBe('none');
    expect(seen.content).toBe('"⠿"');
    const box = await rectOf(spinnerIn(page, 'feature/writing'));
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    const visibility = await spinnerIn(page, 'feature/writing')
      .evaluate((el) => getComputedStyle(el).visibility);
    expect(visibility).toBe('visible');
  });

  it('shows one static frame for both paces under reduced motion', async () => {
    const page = await open([
      row({ branch: 'feature/measured', localDirty: true, branchUrl: `${GH}feature/measured` }),
      row({ branch: 'bug/unobserved', group: 'working', branchUrl: `${GH}bug/unobserved` }),
    ], { reducedMotion: 'reduce' });
    await expect.poll(() => spinnerIn(page, 'feature/measured').count()).toBe(1);
    const fast = await glyphOf(spinnerIn(page, 'feature/measured'));
    const slow = await glyphOf(spinnerIn(page, 'bug/unobserved'));
    expect(fast.content).toBe('"⠿"');
    expect(slow.content).toBe('"⠿"');
  });

  it('leaves the grid tracks exactly where they are', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/writing').count()).toBe(1);
    const cellX = async (branch: string, name: string) =>
      (await rectOf(rowFor(page, branch).locator(`[data-row-cell="${name}"]`))).x;
    for (const label of ['item', 'plan', 'status'] as const) {
      const writing = await cellX('feature/writing', label);
      const idle = await cellX('feature/idle', label);
      expect(Math.abs(writing - idle), `${label} track moved`).toBeLessThan(1);
    }
    const tracks = await rowFor(page, 'feature/writing')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // SEVEN: the marks lane and the six Work items columns.
    expect(tracks.split(' ')).toHaveLength(7);
  });

  it('keeps the unpushed mark in the marks cell, distinct from the spinner', async () => {
    const page = await open([
      row({
        branch: 'feature/dirty-and-ahead', localDirty: true, localAhead: 3,
        group: 'working', branchUrl: `${GH}feature/dirty-and-ahead`,
      }),
    ]);
    const li = rowFor(page, 'feature/dirty-and-ahead');
    await expect.poll(() => li.locator('[data-activity-spinner]').count()).toBe(1);
    expect(await li.locator('[role="gridcell"]').first().locator('[data-unpushed-mark]').count()).toBe(1);
    expect(await li.locator('[data-row-cell="status"] [data-unpushed-mark]').count()).toBe(0);
  });

  it('names its local-only limit, and says nothing to a screen reader', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/writing').count()).toBe(1);
    const mark = spinnerIn(page, 'feature/writing');
    expect(await mark.getAttribute('title')).toBe('A write is in progress in this checkout');
    expect(await mark.getAttribute('aria-hidden')).toBe('true');
  });

  it('never lets a screen reader hear a glyph or a speed', async () => {
    // The branch names avoid the words being searched for.
    const page = await open([
      row({ branch: 'feature/measured', localDirty: true, branchUrl: `${GH}feature/measured` }),
      row({ branch: 'bug/unobserved', group: 'working', branchUrl: `${GH}bug/unobserved` }),
    ]);
    await expect.poll(() => spinnerIn(page, 'feature/measured').count()).toBe(1);
    for (const branch of ['feature/measured', 'bug/unobserved']) {
      expect(await spinnerIn(page, branch).getAttribute('aria-hidden')).toBe('true');
      const text = await rowFor(page, branch).innerText();
      expect(text.toLowerCase()).not.toMatch(/\b(fast|slow)\b/);
      expect(text).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠿]/);
    }
  });
});

/**
 * The two paces: `fast` where a write was observed in this checkout, `slow`
 * where the row is claimed and no write was observed.
 */
describe('the spinner runs at two paces, and they are distinguishable', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  /** Both in WORKING, differing only in `localDirty`. */
  const ROWS = [
    row({
      branch: 'feature/measured', group: 'working', localDirty: true,
      note: 'last commit 18 min ago', branchUrl: `${GH}feature/measured`,
    }),
    row({
      branch: 'bug/unobserved', group: 'working', localDirty: false, localLocked: false,
      note: 'claimed, no known worker', branchUrl: `${GH}bug/unobserved`,
    }),
  ];

  async function open(): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: fleet(ROWS) },
      viewport: { width: 1400, height: 900 },
    });
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  const durationOf = async (page: Page, branch: string) =>
    Number.parseFloat((await glyphOf(spinnerIn(page, branch))).animationDuration);

  it('marks BOTH rows — the measured one and the merely claimed one', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/measured').count()).toBe(1);
    expect(await spinnerIn(page, 'bug/unobserved').count()).toBe(1);
  });

  it('exposes the pace as data-activity-pace', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/measured').count()).toBe(1);
    expect(await spinnerIn(page, 'feature/measured').getAttribute('data-activity-pace')).toBe('fast');
    expect(await spinnerIn(page, 'bug/unobserved').getAttribute('data-activity-pace')).toBe('slow');
  });

  it('runs 80 ms per frame where a write was observed and 220 ms where none was', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/measured').count()).toBe(1);
    expect(await durationOf(page, 'feature/measured')).toBeCloseTo(0.8, 5);
    expect(await durationOf(page, 'bug/unobserved')).toBeCloseTo(2.2, 5);
  });

  it('says which fact each pace states, in the spinner\'s own words', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/measured').count()).toBe(1);
    expect(await spinnerIn(page, 'feature/measured').getAttribute('title'))
      .toBe('A write is in progress in this checkout');
    const slow = await spinnerIn(page, 'bug/unobserved').getAttribute('title');
    expect(slow).toBe('Claimed, and no write observed in this checkout');
    expect(slow!.toLowerCase()).not.toMatch(/idle|nobody|no one/);
  });

  it('keeps the row\'s note carrying the state in words', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/measured').count()).toBe(1);
    const agentRow = (branch: string) =>
      page.locator('[data-fleet-agent-row]').filter({ has: page.locator(`[data-agent-branch="${branch}"]`) });
    expect(await agentRow('feature/measured').innerText()).toMatch(/last commit/i);
    expect(await agentRow('bug/unobserved').innerText()).toMatch(/claimed, no known worker/i);
  });
});

/**
 * A row that grows a second line (a stuck status beneath the columns) keeps
 * the spinner on its first line, in the Status cell.
 */
describe('the activity spinner stays on the row\'s first line', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const stuck = (over: Partial<Stuck> = {}): Stuck => ({
    state: 'conflict',
    conflicts: ['packages/board/src/app/App.tsx'],
    localAhead: 0,
    changedPaths: [],
    failingChecks: [],
    runHistory: [],
    ...over,
  });

  const ROWS = [
    row({ branch: 'feature/one-line', localDirty: true, branchUrl: `${GH}feature/one-line` }),
    row({
      branch: 'feature/two-lines', localDirty: true,
      group: 'waiting-on-you', stuck: stuck(),
      branchUrl: `${GH}feature/two-lines`,
    }),
  ];

  async function open(): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: fleet(ROWS) },
      viewport: { width: 1400, height: 900 },
    });
    await page.locator('[data-delivery-section]').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  it('renders a row that really is two lines tall, and one that is not', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/two-lines').count()).toBe(1);
    expect(await rowFor(page, 'feature/two-lines').locator('[data-stuck]').count()).toBe(1);
    const tall = (await rowFor(page, 'feature/two-lines').boundingBox())!;
    const short = (await rowFor(page, 'feature/one-line').boundingBox())!;
    expect(tall.height).toBeGreaterThan(short.height + 15);
  });

  it('sits on the branch name\'s line on a row carrying a status line', async () => {
    // The containment claim on the tall row: a spinner centred on the whole
    // row lands in the gap between the two lines, outside the branch box.
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/two-lines').count()).toBe(1);
    const spinner = await rectOf(spinnerIn(page, 'feature/two-lines'));
    const branch = (await rowFor(page, 'feature/two-lines')
      .locator('[data-branch]').first().boundingBox())!;
    expect(midY(spinner)).toBeGreaterThanOrEqual(branch.y);
    expect(midY(spinner)).toBeLessThanOrEqual(branch.y + branch.height);
  });

  it('sits in the row\'s top half on a row carrying a status line', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/two-lines').count()).toBe(1);
    const spinner = await rectOf(spinnerIn(page, 'feature/two-lines'));
    const li = (await rowFor(page, 'feature/two-lines').boundingBox())!;
    expect(spinner.y + spinner.height).toBeLessThan(midY(li));
  });

  it('sits on the branch name\'s line on a single-line row', async () => {
    const page = await open();
    await expect.poll(() => spinnerIn(page, 'feature/one-line').count()).toBe(1);
    const spinner = await rectOf(spinnerIn(page, 'feature/one-line'));
    const branch = (await rowFor(page, 'feature/one-line')
      .locator('[data-branch]').first().boundingBox())!;
    expect(midY(spinner)).toBeGreaterThanOrEqual(branch.y);
    expect(midY(spinner)).toBeLessThanOrEqual(branch.y + branch.height);
  });
});
