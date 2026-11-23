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
 * what the Fleet section renders from a pulse and what a click POSTs, not about
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
  phase: 'Development', planState: 'approved', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null, ...over,
});

/**
 * A pulse with a worked branch and an untaken one, and `fleetControls` set to
 * the values under test.
 */
function fleet(controls: Fleet['fleetControls']): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/working-a', plan: 'beans', group: 'working', ageMinutes: 10 }),
    row({
      branch: 'feature/untaken', plan: 'plant-tomatoes', group: 'not-started',
      state: 'open', phase: 'Design', planState: 'design', ageMinutes: null, waitingOn: 'click' as const,
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
    await page.locator('[data-delivery-section="fleet"]').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return { page, posts };
  }

  it('renders the switch and the stepper once each, both in Fleet', async () => {
    const { page } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      // Exactly one of each, and both in the section they are about: the two
      // controls start and cap the fleet's agents.
      expect(await page.locator('[data-fleet-auto-dispatch]').count()).toBe(1);
      expect(await page.locator('[data-fleet-parallel-agents]').count()).toBe(1);
      expect(await sectionOf(page, '[data-fleet-auto-dispatch]')).toContain('fleet');
      expect(await sectionOf(page, '[data-fleet-parallel-agents]')).toContain('fleet');
    } finally {
      await page.close();
    }
  });

  it('renders the switches and the stepper in one row at the top of the open Fleet section', async () => {
    // THE GEOMETRY, NOT A CLASS NAME. The row sits under the heading and above every group, and the switch and the
    // stepper share it: a row that wrapped them apart, or one rendered inside the heading, fails here.
    const { page } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      const boxes = await page.evaluate(() => {
        const row = document.querySelector('[data-section="fleet"] [data-fleet-switch-row]');
        const head = document.querySelector('[data-section-head="fleet"]');
        const sw = document.querySelector('[data-fleet-auto-dispatch]')?.closest('label') ?? document.querySelector('[data-fleet-auto-dispatch]');
        const st = document.querySelector('[data-fleet-parallel-agents]');
        if (!row || !head || !sw || !st) return null;
        const r = row.getBoundingClientRect();
        return {
          rowTop: r.top, rowWidth: r.width, headBottom: head.getBoundingClientRect().bottom,
          inRow: [sw, st].every((el) => row.contains(el)),
          inHeading: row.closest('h2') !== null,
          firstAfterHead: head.nextElementSibling === row,
        };
      });
      expect(boxes).not.toBeNull();
      expect(boxes!.inRow).toBe(true);
      expect(boxes!.inHeading).toBe(false);
      expect(boxes!.firstAfterHead).toBe(true);
      expect(boxes!.rowTop).toBeGreaterThanOrEqual(boxes!.headBottom - 1);
      // A collapsed box satisfies every claim above while rendering nothing an operator can hit.
      expect(boxes!.rowWidth).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('holds the switches and the stepper in the Fleet section body and none in its heading', async () => {
    const { page } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      const switches = '[data-fleet-auto-dispatch], [data-fleet-auto-switch], [data-fleet-parallel-agents]';
      expect(await page.locator('#fleet-controls').count()).toBe(1);
      expect(await page.locator('#fleet-controls[data-fleet-control-column]').count()).toBe(1);
      expect(await page.locator('[data-delivery-section="fleet"] #fleet-controls').count()).toBe(0);
      expect(await page.locator(`[data-section="fleet"] :is(${switches})`).count()).toBe(5);
      expect(await page.locator('#fleet-controls [data-fleet-auto-switch]').count()).toBe(3);
    } finally {
      await page.close();
    }
  });

  it('renders no switch outside the Fleet section', async () => {
    const { page } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      const outside = await page.evaluate(() => [...document.querySelectorAll(
        '[data-fleet-auto-dispatch], [data-fleet-auto-switch], [data-fleet-parallel-agents]',
      )].filter((el) => el.closest('[data-section="fleet"]') === null).length);
      expect(outside).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('renders the switch row above the empty frame of a stopped fleet', async () => {
    const stopped = { ...fleet({ autoDispatch: false, parallelAgents: 3 }), supervisor: {
      state: 'down', prominence: 'note', shown: true, label: 'fleet stopped', detail: '',
    } } as Fleet;
    const { page } = await open(stopped);
    try {
      const frame = page.locator('[data-section-empty-frame="fleet"]');
      await frame.waitFor({ timeout: 10_000 });
      expect(await frame.getAttribute('data-empty-kind')).toBe('stopped');
      const order = await page.evaluate(() => {
        const row = document.querySelector('[data-section="fleet"] [data-fleet-switch-row]');
        const empty = document.querySelector('[data-section-empty-frame="fleet"]');
        return row && empty ? (row.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : null;
      });
      expect(order).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('shows no switch in a folded Fleet section, and a held group\'s link opens it with the switches in view', async () => {
    const { page } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      const toggle = page.locator('[data-section-toggle="fleet"]');
      if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      expect(await page.locator('#fleet-controls').count()).toBe(0);
      const link = page.locator('[data-group-held="autoDispatch"] button');
      await expect.poll(() => link.count()).toBe(1);
      await link.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      await expect.poll(() => page.locator('#fleet-controls').isVisible()).toBe(true);
      await expect.poll(() => page.locator('#fleet-controls').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      })).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('shows the output tokens of today in the heading, from the payload', async () => {
    const payload = { ...fleet({ autoDispatch: false, parallelAgents: 3 }), tokensToday: { text: '842 output tokens today, finished runs', title: 'cache read tokens: 5M' } } as Fleet;
    const { page } = await open(payload);
    try {
      const figure = page.locator('[data-delivery-section="fleet"] [data-fleet-tokens-today]');
      expect((await figure.textContent())?.trim()).toBe('· 842 output tokens today, finished runs');
      expect(await figure.getAttribute('title')).toContain('cache read tokens: 5M');
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
  it('the header Fleet group shows the switches as text, posts nothing, and opens the Fleet section', async () => {
    const { page, posts } = await open(fleet({ autoDispatch: false, parallelAgents: 3 }));
    try {
      const group = page.locator('[data-tab-header] [data-header-group="fleet"]');
      await group.waitFor({ timeout: 10_000 });
      expect(await group.locator('input, [role="spinbutton"]').count()).toBe(0);
      expect(await group.locator('[data-header-mark="dispatch"]').getAttribute('data-on')).toBe('0');
      // One source: the header's cap equals the Fleet body's.
      expect(await group.locator('[data-header-parallel]').innerText())
        .toContain(String(await page.locator('[data-fleet-parallel-agents]').getAttribute('aria-valuenow')));
      await group.locator('[data-header-open="fleet"]').click();
      await page.waitForTimeout(300);
      expect(posts).toEqual([]);
      expect(await page.locator('#fleet-controls').isVisible()).toBe(true);
      // 320 px: no horizontal scroll.
      await page.setViewportSize({ width: 320, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    } finally {
      await page.close();
    }
  });

});
