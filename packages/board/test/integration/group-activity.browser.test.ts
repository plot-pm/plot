import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
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
 * `groupPace` is a pure function and is pinned in `test/unit/agent-list.test.ts`,
 * along with the two placement strings. None of that can answer what is here:
 *
 * - that the mark renders on a heading whose rows are NOT IN THE DOM at all,
 *   which is the whole point and which a unit test cannot state;
 * - that it survives expanding, rather than vanishing at the moment of opening;
 * - that in a heading it FLOWS rather than escaping to a positioned ancestor —
 *   the failure a shared `sm:absolute` would cause, invisible to a class-name
 *   assertion and to any test that never renders the heading;
 * - that the toggle button's accessible name does not gain the mark's `title`;
 * - that the tally `(4)` still says what it always said.
 *
 * `/api/fleet` is stubbed at the network boundary, the way the sibling suites do
 * it: every claim is about what the tab RENDERS from a pulse.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, repair: null, ...over,
});

const fleet = (rows: AgentRow[]): Fleet => ({
  generatedAt: new Date().toISOString(),
  ageSeconds: 1, ready: true, error: null, rows,
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
    branch: 'feature/dying', group: 'quiet', localDirty: true,
    note: 'last commit 40 min ago', branchUrl: `${GH}feature/dying`,
  }),
  row({
    branch: 'feature/also-quiet', group: 'quiet',
    note: 'last commit 3 days ago', branchUrl: `${GH}feature/also-quiet`,
  }),
  row({
    branch: 'feature/finished', group: 'done', state: 'merged',
    note: 'merged', branchUrl: `${GH}feature/finished`,
  }),
];

describe('a group heading carries the activity of the rows behind it', () => {
  let browser: Browser;
  let server: { kill: () => void; port: number };
  let baseURL: string;
  const contexts: BrowserContext[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    server?.kill();
  });

  async function open(rows: AgentRow[] = FOLDED): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    contexts.push(context);
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet(rows)) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    return page;
  }

  /** The section for a group key — its heading and, when open, its rows. */
  const sectionFor = (page: Page, key: string) =>
    page.locator('section').filter({ has: page.locator(`[data-group-toggle="${key}"]`) });

  const toggleFor = (page: Page, key: string) =>
    page.locator(`[data-group-toggle="${key}"]`);

  const markInHeading = (page: Page, key: string) =>
    sectionFor(page, key).locator('h2 [data-activity-mark]');

  // ── The reported case ──────────────────────────────────────────────────────

  it('marks a COLLAPSED group whose row is being written to', async () => {
    // THE assertion, and the case no test covered before this wave. The row is
    // not merely hidden — it is REMOVED from the tree, so the heading is the
    // only thing on the page that can say anything about it.
    const page = await open();
    await expect.poll(() => toggleFor(page, 'quiet').count()).toBe(1);
    expect(await toggleFor(page, 'quiet').getAttribute('aria-expanded')).toBe('false');
    // The row really is absent, which is what makes the heading's mark the
    // only signal. If the row were merely visually hidden this suite would be
    // asserting something much weaker than it claims.
    expect(await sectionFor(page, 'quiet').locator('li[data-agent-row]').count()).toBe(0);
    await expect.poll(() => markInHeading(page, 'quiet').count()).toBe(1);
  });

  it('leaves a collapsed group with NO active row unmarked', async () => {
    // The negative, and it is what makes the positive mean anything: a heading
    // that always shows the mark says nothing at all. DONE is collapsed by
    // default too, so this is the same shape with the opposite answer.
    const page = await open();
    await expect.poll(() => toggleFor(page, 'done').count()).toBe(1);
    expect(await toggleFor(page, 'done').getAttribute('aria-expanded')).toBe('false');
    expect(await markInHeading(page, 'done').count()).toBe(0);
  });

  it('keeps the mark when the group is EXPANDED', async () => {
    // Hiding it on expand was considered — the rows show it themselves, so the
    // heading repeats them — and rejected because the mark would then vanish at
    // the moment of opening, which reads as *it stopped*. A marker that
    // disappears when you look closer is worse than one that repeats itself.
    const page = await open();
    await expect.poll(() => markInHeading(page, 'quiet').count()).toBe(1);
    await toggleFor(page, 'quiet').click();
    await expect.poll(() =>
      toggleFor(page, 'quiet').getAttribute('aria-expanded')).toBe('true');
    // The rows are now on the page AND the heading still carries the mark.
    expect(await sectionFor(page, 'quiet').locator('li[data-agent-row]').count())
      .toBeGreaterThan(0);
    expect(await markInHeading(page, 'quiet').count()).toBe(1);
  });

  it('agrees with the row beneath it once both are visible', async () => {
    // The heading is derived from the same `active` set the rows are rendered
    // from, so agreement is structural. Stated on the page because that is
    // where a drift would actually be seen: the heading's pace and its active
    // row's pace are the same word.
    const page = await open();
    await toggleFor(page, 'quiet').click();
    await expect.poll(() =>
      sectionFor(page, 'quiet').locator('li[data-agent-row]').count()).toBeGreaterThan(0);
    const rowMark = sectionFor(page, 'quiet')
      .locator('li[data-agent-row]')
      .filter({ has: page.locator('[data-branch="feature/dying"]') })
      .locator('[data-activity-mark]');
    await expect.poll(() => rowMark.count()).toBe(1);
    expect(await markInHeading(page, 'quiet').getAttribute('data-activity-pace'))
      .toBe(await rowMark.getAttribute('data-activity-pace'));
  });

  // ── Where it sits ─────────────────────────────────────────────────────────

  it('FLOWS in the heading rather than escaping to a positioned ancestor', async () => {
    // The failure a shared `sm:absolute` would cause, and the reason this claim
    // needs a page. The row's placement positions against the row's own
    // `relative` box; an `<h2>` has no positioned ancestor, so the row's string
    // reused here would hang the mark off whatever ancestor happened to be
    // positioned and land it somewhere else entirely — a defect no class-name
    // assertion can see.
    const page = await open();
    await expect.poll(() => markInHeading(page, 'quiet').count()).toBe(1);
    const position = await markInHeading(page, 'quiet')
      .evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('relative');
  });

  it('sits INSIDE its own heading, beside the words', async () => {
    // Stated in geometry rather than in the DOM alone: an absolutely positioned
    // mark can be a descendant of the heading in the tree and render across the
    // page. Its box must be within its heading's box, and to the right of the
    // tally it follows.
    const page = await open();
    await expect.poll(() => markInHeading(page, 'quiet').count()).toBe(1);
    const mark = (await markInHeading(page, 'quiet').boundingBox())!;
    const heading = (await sectionFor(page, 'quiet').locator('h2').boundingBox())!;
    expect(mark.x).toBeGreaterThanOrEqual(heading.x - 0.5);
    expect(mark.x + mark.width).toBeLessThanOrEqual(heading.x + heading.width + 0.5);
    expect(mark.y).toBeGreaterThanOrEqual(heading.y - 0.5);
    expect(mark.y + mark.height).toBeLessThanOrEqual(heading.y + heading.height + 0.5);
    // And it really has a box — a mark collapsed to zero width would satisfy
    // every containment assertion above while being invisible.
    expect(mark.width).toBeGreaterThan(0);
    expect(mark.height).toBeGreaterThan(0);
  });

  it('does not push the heading onto a second line', async () => {
    // The mark is added to a heading that already holds a caret, an icon, a
    // label and a tally. A section whose heading wrapped would cost a row of
    // vertical space on a view whose entire complaint was crowding.
    const page = await open();
    await expect.poll(() => markInHeading(page, 'quiet').count()).toBe(1);
    const marked = (await sectionFor(page, 'quiet').locator('h2').boundingBox())!;
    const plain = (await sectionFor(page, 'done').locator('h2').boundingBox())!;
    expect(Math.abs(marked.height - plain.height)).toBeLessThan(2);
  });

  // ── What it says, and to whom ─────────────────────────────────────────────

  it('says nothing to a screen reader, and nothing to the toggle\'s name', async () => {
    // The mark lives INSIDE the toggle button, so its `title` would otherwise
    // join the button's accessible name — a reader would hear "quiet 2 a write
    // is in progress in this checkout". `aria-hidden` is what prevents it, and
    // this is the assertion that would catch its removal.
    const page = await open();
    await expect.poll(() => markInHeading(page, 'quiet').count()).toBe(1);
    expect(await markInHeading(page, 'quiet').getAttribute('aria-hidden')).toBe('true');
    const name = await toggleFor(page, 'quiet')
      .evaluate((el) => (el as HTMLElement).innerText);
    expect(name.toLowerCase()).not.toMatch(/write is in progress|claimed, and no write/);
  });

  it('leaves the tally saying exactly what it always said', async () => {
    // `(2)` separates ABSENT from EMPTY — a distinction this board paid for —
    // and that job is not being extended. No second figure, no `(2, 1 active)`:
    // the reader opening a group does not need to know whether it is one row or
    // three, they need to know whether opening it is worth it.
    const page = await open();
    await expect.poll(() => toggleFor(page, 'quiet').count()).toBe(1);
    const text = await toggleFor(page, 'quiet').innerText();
    expect(text).toContain('(2)');
    expect(text).not.toMatch(/active|\(\d+\s*,/);
  });

  it('carries the same glow the rows carry, not a heading-only variant', async () => {
    // A group heading says what its rows say, so it must say it in the SAME
    // mark. The glow is what the mark is read by at a distance, and a heading
    // that rendered a duller one would be a second design wearing one name.
    const page = await open();
    await expect.poll(() => markInHeading(page, 'quiet').count()).toBe(1);
    const shadow = await markInHeading(page, 'quiet')
      .locator('[data-activity-dot]')
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe('none');
    expect(shadow).toMatch(/rgba\(16,\s*185,\s*129,\s*0\.9\)\s+0px\s+0px\s+4px/);
  });
});

/**
 * THE PACE A HEADING STATES — the strongest one its rows state, never stronger.
 *
 * A group holding one written-to row among merely-claimed ones is a group where
 * something is demonstrably happening, so its heading travels FAST. A group
 * holding only claimed rows travels SLOW — *unknown, never nobody*, the same
 * ordering every mark on this board keeps.
 *
 * The rule is pinned as a pure function in the unit suite. What needs a page is
 * that the heading's mark resolves to the same two durations the rows' do, so a
 * reader reads one vocabulary rather than two.
 */
describe('a heading travels at the strongest pace its rows state', () => {
  let browser: Browser;
  let server: { kill: () => void; port: number };
  let baseURL: string;
  const contexts: BrowserContext[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    server?.kill();
  });

  async function open(rows: AgentRow[]): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    contexts.push(context);
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet(rows)) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    return page;
  }

  const headingMark = (page: Page, key: string) =>
    page.locator('section')
      .filter({ has: page.locator(`[data-group-toggle="${key}"]`) })
      .locator('h2 [data-activity-mark]');

  it('travels FAST for a group holding one measured row among claimed ones', async () => {
    // THE ordering assertion. An implementation reporting the WEAKEST pace — or
    // keeping the last row's answer — lets one measured write hide behind two
    // unobserved claims, and the fast row is precisely the reason to open the
    // group. The written-to row is LAST so an implementation stopping at the
    // first live row it meets fails here rather than passing by luck.
    const page = await open([
      row({ branch: 'feature/claimed-a', group: 'quiet', branchUrl: `${GH}feature/claimed-a` }),
      row({ branch: 'feature/claimed-b', group: 'quiet', branchUrl: `${GH}feature/claimed-b` }),
      row({
        branch: 'feature/writing', group: 'quiet', localDirty: true,
        branchUrl: `${GH}feature/writing`,
      }),
    ]);
    await expect.poll(() => headingMark(page, 'quiet').count()).toBe(1);
    expect(await headingMark(page, 'quiet').getAttribute('data-activity-pace')).toBe('fast');
  });

  it('travels SLOW for a group holding only CLAIMED rows', async () => {
    // The weaker claim, and the board is licensed to make it: the fleet placed
    // these rows in WORKING and this checkout observed nothing local. Absence
    // is not falsehood, so the heading says *unknown*, never *nobody*.
    //
    // WORKING rather than QUIET, because `isLive` is what produces the slow
    // pace and it reads `group === 'working'`.
    const page = await open([
      row({ branch: 'feature/claimed', group: 'working', note: 'claimed, no known worker' }),
    ]);
    await expect.poll(() => headingMark(page, 'working').count()).toBe(1);
    expect(await headingMark(page, 'working').getAttribute('data-activity-pace')).toBe('slow');
  });

  it('resolves to the same two durations the rows use', async () => {
    // One vocabulary, read at two levels. A heading whose "fast" resolved to a
    // different duration than a row's "fast" would teach the reader two scales
    // for one word.
    const page = await open([
      row({
        branch: 'feature/writing', group: 'working', localDirty: true,
        branchUrl: `${GH}feature/writing`,
      }),
    ]);
    await expect.poll(() => headingMark(page, 'working').count()).toBe(1);
    const durationOf = (locator: ReturnType<typeof headingMark>) =>
      locator.locator('[data-activity-dot]')
        .evaluate((el) => getComputedStyle(el).animationDuration);
    const heading = await durationOf(headingMark(page, 'working'));
    const inRow = await page.locator('li[data-agent-row]')
      .filter({ has: page.locator('[data-branch="feature/writing"]') })
      .locator('[data-activity-mark]')
      .locator('[data-activity-dot]')
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(heading).toBe(inRow);
    expect(Number.parseFloat(heading)).toBeGreaterThan(0);
  });
});
