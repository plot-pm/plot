import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, type Route } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import type { AgentRow, Fleet } from '../../src/contract/schema.js';

/**
 * THE TWO FLEET CONTROLS, driven in a real browser against the shipped artifact.
 *
 * `/api/fleet` is stubbed at the network boundary: every claim here is about
 * what the section HEADERS render from a pulse and what a click POSTs, not about
 * a git estate. The server half — the state file, the defaults, the endpoint's
 * clamp and cross-origin refusal — is pinned against the artifact in
 * `test/fleet-controls.test.mjs`, where a second real board process reads the
 * first's values. This file owns the DOM half: WHICH section each control sits
 * on, that the stepper is a real `spinbutton`, and that it is keyboard
 * reachable with its value announced.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null, ...over,
});

/**
 * A pulse with at least one row in WORKING and one in NOT STARTED, so both
 * headers render — and `fleetControls` set to the values under test.
 */
function fleet(controls: Fleet['fleetControls']): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/working-a', plan: 'beans', group: 'working', ageMinutes: 10 }),
    row({
      branch: 'feature/untaken', plan: 'plant-tomatoes', group: 'not-started',
      state: 'open', phase: 'Design', ageMinutes: null, waitingOn: 'click' as const,
      note: 'ready', branchUrl: `${GH}feature/untaken`, waitingDays: 3,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1,
    ready: true,
    error: null,
    rows,
    summary: { plans: 2, waves: 2, branches: rows.length, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
    prAgeSeconds: 74,
    prNextInSeconds: 46,
    scanNextInSeconds: 3,
    prError: null,
    fleetControls: controls,
  } as Fleet;
}

/** The section a control sits under — its nearest `<section>`'s heading text. */
async function sectionOf(page: Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate((el) => {
    const section = el.closest('section');
    return section?.querySelector('h2')?.textContent?.toLowerCase() ?? '';
  });
}

describe('the two fleet controls (real browser renders the shipped artifact)', () => {
  // THE STATE IS SERVED. The board was started only to serve `index.html`:
  // this file routes `/api/fleet` and `/api/fleet-controls` itself, so the
  // server answered nothing the test read.
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  /**
   * Open the Agents tab with `/api/fleet` answering `payload`, and
   * `/api/fleet-controls` echoing whatever it is POSTed (merged onto `payload`'s
   * controls) — a synchronous route callback, because an async one fails tests
   * that already passed.
   *
   * BOTH ROUTES ARE INSTALLED BEFORE THE FIRST NAVIGATION, through the
   * catalogue's `route` option. Installing them on an already-navigated page
   * left a window the client's first `/api/fleet` fetch could land in: the real
   * server answered, the app rendered `FLEET_CONTROLS_DEFAULT`, and
   * `parallelAgents` read 3 where the test had supplied 1. The window is a race,
   * so the stub's presence is a precondition here rather than a timing outcome.
   */
  async function open(
    payload: Fleet,
    extra: Record<string, (route: Route) => unknown> = {},
  ): Promise<{ page: Page; posts: unknown[] }> {
    const posts: unknown[] = [];
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      route: {
        '**/api/fleet': (route) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }),
        '**/api/fleet-controls': (route) => {
          const patch = JSON.parse(route.request().postData() ?? '{}');
          posts.push(patch);
          const merged = { ...payload.fleetControls, ...patch };
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(merged) });
        },
        ...extra,
      },
    });
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return { page, posts };
  }

  it('renders the switch in NOT STARTED only, the stepper in WORKING only', async () => {
    const { page } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      // Exactly one of each, and each under the header it is about.
      expect(await page.locator('[data-fleet-auto-dispatch]').count()).toBe(1);
      expect(await page.locator('[data-fleet-parallel-agents]').count()).toBe(1);
      expect(await sectionOf(page, '[data-fleet-auto-dispatch]')).toContain('not started');
      expect(await sectionOf(page, '[data-fleet-parallel-agents]')).toContain('working');
    } finally {
      await page.close();
    }
  });

  it('renders both controls right-aligned in the same column', async () => {
    // THE GEOMETRY, NOT A CLASS NAME. A test asserting the presence of
    // `ml-auto`, or that the control exists at all, passes the layout this
    // slice replaced — the stepper used to sit immediately after a tally whose
    // width changes with the data, so it moved between renders and the operator
    // re-found it every time.
    //
    // TWO SECTIONS AGREEING IS THE PROPERTY. A later hand right-aligning only
    // WORKING satisfies every claim about one control's position, so the
    // assertion compares the two columns to each other — which is what such a
    // change breaks.
    //
    // MEASURED ON THE COLUMN, NOT ON THE CONTROL. `[data-fleet-auto-dispatch]`
    // is the `<input>` inside its label and the label's text follows it, so the
    // checkbox's own right edge sits 85 px left of the column — measured
    // 2026-09-10, 1286.7 against 1372. The right-aligned box is the column, and
    // asserting on the input would have failed a correct layout.
    //
    // AND AGAINST THE HEADING'S CONTENT EDGE. The `<h2>` carries `px-3`, so its
    // border box ends 12 px right of where its children can reach: 1384 against
    // 1372. A claim against `h2.right` fails by exactly that padding.
    const { page } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      const boxes = await page.evaluate(() => {
        const read = (sel: string) => {
          const el = document.querySelector(sel);
          const column = el?.closest('[data-fleet-control-column]');
          const h2 = column?.closest('h2');
          if (!column || !h2) return null;
          const c = column.getBoundingClientRect();
          const h = h2.getBoundingClientRect();
          const padRight = parseFloat(getComputedStyle(h2).paddingRight) || 0;
          return { right: c.right, width: c.width, contentRight: h.right - padRight };
        };
        return {
          sw: read('[data-fleet-auto-dispatch]'),
          st: read('[data-fleet-parallel-agents]'),
        };
      });
      expect(boxes.sw).not.toBeNull();
      expect(boxes.st).not.toBeNull();
      const sw = boxes.sw!;
      const st = boxes.st!;
      // Each control's column ends on its own heading's content edge — a
      // one-pixel tolerance for sub-pixel layout.
      expect(Math.abs(sw.contentRight - sw.right)).toBeLessThan(2);
      expect(Math.abs(st.contentRight - st.right)).toBeLessThan(2);
      // AND THE SAME COLUMN. Both headings are the same width in the same
      // container, so two right-aligned columns share an edge — this is the
      // claim that fails if only one section is aligned.
      expect(Math.abs(sw.right - st.right)).toBeLessThan(2);
      // Neither column is zero-width: a collapsed box satisfies every
      // arithmetic claim above while rendering nothing an operator can hit.
      expect(sw.width).toBeGreaterThan(0);
      expect(st.width).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('the switch reflects the shared state and POSTs the flip', async () => {
    const { page, posts } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      const box = page.locator('[data-fleet-auto-dispatch]');
      expect(await box.isChecked()).toBe(false);
      await box.click();
      await expect.poll(() => box.isChecked()).toBe(true);
      // The click posted the FLIP, and only that field — a partial write.
      expect(posts).toContainEqual({ autoDispatch: true });
    } finally {
      await page.close();
    }
  });

  it('the stepper is a real spinbutton that announces its value', async () => {
    const { page } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      const spin = page.getByRole('spinbutton', { name: 'parallel agents cap' });
      expect(await spin.count()).toBe(1);
      // The role and its value/bounds are what a screen reader reads.
      expect(await spin.getAttribute('aria-valuenow')).toBe('3');
      expect(await spin.getAttribute('aria-valuemin')).toBe('1');
      expect(await spin.getAttribute('aria-valuetext')).toBe('3 agents cap');
    } finally {
      await page.close();
    }
  });

  it('the stepper increments and decrements, and POSTs each new value', async () => {
    const { page, posts } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      const spin = page.getByRole('spinbutton', { name: 'parallel agents cap' });
      await page.locator('[data-fleet-parallel-increment]').click();
      await expect.poll(() => spin.getAttribute('aria-valuenow')).toBe('4');
      await page.locator('[data-fleet-parallel-decrement]').click();
      await expect.poll(() => spin.getAttribute('aria-valuenow')).toBe('3');
      expect(posts).toContainEqual({ parallelAgents: 4 });
      expect(posts).toContainEqual({ parallelAgents: 3 });
    } finally {
      await page.close();
    }
  });

  it('the stepper refuses to go below 1', async () => {
    const { page, posts } = await open(fleet({ autoDispatch: false, parallelAgents: 1 }));
    try {
      const spin = page.getByRole('spinbutton', { name: 'parallel agents cap' });
      expect(await spin.getAttribute('aria-valuenow')).toBe('1');
      // At the floor the decrement is disabled, and clicking it changes nothing
      // and posts nothing — a cap of zero is what the switch says, not the cap.
      expect(await page.locator('[data-fleet-parallel-decrement]').isDisabled()).toBe(true);
      expect(await spin.getAttribute('aria-valuenow')).toBe('1');
      expect(posts.some((p) => (p as { parallelAgents?: number }).parallelAgents === 0)).toBe(false);
    } finally {
      await page.close();
    }
  });

  it('turning the switch on dispatches NOTHING — it only records the intention', async () => {
    // The wave's hard boundary: this switch builds the control and wave 3 does
    // the dispatching. A switch that is on must reach `/api/fleet-controls` and
    // NEVER `/api/dispatch`, or this wave would be starting agents it was
    // explicitly told not to.
    const dispatched: unknown[] = [];
    const { page, posts } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }), {
      // Routed BEFORE the navigation like the other two, so a dispatch fired at
      // any point in the page's life is counted — a route added after the click
      // can only ever prove the calls it was present for.
      '**/api/dispatch': (route) => {
        dispatched.push(route.request().postData());
        route.fulfill({ status: 202, contentType: 'application/json', body: '{}' });
      },
    });
    try {
      await page.locator('[data-fleet-auto-dispatch]').click();
      // WAIT FOR THE EVENT, NOT A DURATION. The click's own POST arriving is
      // proof the handler ran to completion, so a dispatch it would have made
      // has already been made. A sleep can only assume that.
      await expect.poll(() => posts).toContainEqual({ autoDispatch: true });
      expect(dispatched).toHaveLength(0);
    } finally {
      await page.close();
    }
  });

  it('the switch and stepper are keyboard reachable, and Arrow keys adjust the cap', async () => {
    const { page, posts } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      // The checkbox is a native control, reachable and toggled by keyboard.
      const box = page.locator('[data-fleet-auto-dispatch]');
      await box.focus();
      expect(await box.evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.press('Space');
      await expect.poll(() => box.isChecked()).toBe(true);

      // The spinbutton is focusable, and ArrowUp/ArrowDown are its own
      // interaction — a reader who Tabs onto it changes the value without the
      // two buttons.
      const spin = page.getByRole('spinbutton', { name: 'parallel agents cap' });
      await spin.focus();
      expect(await spin.evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => spin.getAttribute('aria-valuenow')).toBe('4');
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => spin.getAttribute('aria-valuenow')).toBe('3');
      expect(posts).toContainEqual({ autoDispatch: true });
      expect(posts).toContainEqual({ parallelAgents: 4 });
    } finally {
      await page.close();
    }
  });
});
