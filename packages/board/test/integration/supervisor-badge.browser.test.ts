import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import type { AgentRow, Fleet, Supervisor } from '../../src/contract/schema.js';

/**
 * THE SUPERVISOR BADGE — ONE BROWSER TEST, AND IT PROVES ONLY THAT THE BADGE
 * SHOWS WHAT IT WAS GIVEN.
 *
 * Every decision behind it — which of the three states a reading is, whether it
 * is worth saying, and whether it is a warning — is a domain property asserted
 * in `packages/domain/test/supervisor-reading.test.ts` with no browser and no
 * server. This file owns the other half: that the badge lands on the WORKING
 * header beside the stepper, that `up` renders nothing, and that a warning is
 * visibly different from a note.
 *
 * `/api/fleet` is stubbed at the network boundary, so no claim here is about a
 * git estate or a live supervisor.
 */
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null, ...over,
});

/** A pulse with a row in WORKING and one in NOT STARTED, so both headers render. */
function fleet(supervisor: Supervisor | undefined): Fleet {
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
    fleetControls: { autoDispatch: false, parallelAgents: 3 },
    supervisor,
  } as Fleet;
}

/** The section a control sits under — its nearest `<section>`'s heading text. */
async function sectionOf(page: Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate((el) => {
    const section = el.closest('section');
    return section?.querySelector('h2')?.textContent?.toLowerCase() ?? '';
  });
}

describe('the supervisor badge (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  /**
   * THE ROUTE IS INSTALLED BEFORE THE FIRST NAVIGATION, through the
   * catalogue's own `route` option, and that is not a preference.
   *
   * `catalogue/index.ts` states the reason: *"a route added to an open page
   * cannot catch a poll already in flight: between the test deciding and the
   * route existing there is a window a fetch can land in."* Calling
   * `page.route` after `cat.open` leaves that window open, and the payload then
   * arrives only on a LATER poll — or, under a loaded machine, not within any
   * bound the test can wait.
   *
   * Measured 2026-09-07 on identical source: this file passed five of five
   * standing alone and failed one or two of five inside the full board suite,
   * with the badge never appearing rather than appearing late.
   *
   * The stepper is then the anchor rather than the badge, because two of the
   * five cases assert the badge is ABSENT. The stepper renders with the WORKING
   * header this payload produces, and every claim below is about a span inside
   * it — so its presence is what says the payload landed.
   */
  async function open(payload: Fleet): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      route: {
        '**/api/fleet': (route) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }),
      },
    });
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    await page.locator('[data-fleet-parallel-agents]').waitFor({ timeout: 10_000 });
    return page;
  }

  it('renders nothing when a supervisor is loaded', async () => {
    // `up` is the ordinary state and needs no word. The badge is silent when
    // the news is good — the `registry` annotation's shape beside it.
    const page = await open(fleet({
      state: 'up', prominence: 'quiet', shown: false,
      label: 'supervised', detail: 'A supervisor is loaded.',
    }));
    try {
      expect(await page.locator('[data-fleet-supervisor]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('renders nothing when the server sent no supervisor field at all', async () => {
    // A server predating this field was never asked the question, which is a
    // different fact from `unknown` — and it renders as nothing, not as a state.
    const page = await open(fleet(undefined));
    try {
      expect(await page.locator('[data-fleet-supervisor]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('shows the warning on the WORKING header beside the stepper', async () => {
    // The measured failure: six agents running, nothing loaded to reap them.
    const page = await open(fleet({
      state: 'down', prominence: 'warn', shown: true,
      label: 'unsupervised',
      detail: 'No supervisor is loaded, and 6 agents are running.',
    }));
    try {
      const badge = page.locator('[data-fleet-supervisor]');
      await expect.poll(() => badge.count()).toBe(1);
      expect(await badge.textContent()).toContain('unsupervised');
      expect(await badge.getAttribute('title')).toContain('6 agents are running');
      // ON THE SECTION IT IS ABOUT. The supervisor is what reaps WORKING's
      // agents when they finish, so the statement belongs on WORKING.
      expect(await sectionOf(page, '[data-fleet-supervisor]')).toContain('working');
      // Inside the stepper, beside the registry annotation it borrows its shape
      // from — not floating elsewhere in the header.
      expect(
        await badge.evaluate((el) => el.closest('[data-fleet-parallel-agents]') !== null),
      ).toBe(true);
      // A warning is amber, matching its neighbours in the same header.
      expect(await badge.getAttribute('class')).toContain('text-amber-600');
    } finally {
      await page.close();
    }
  });

  it('renders `down` with no agents quietly — not as a warning', async () => {
    // Nothing is being neglected, so it is stated and not shouted. This is the
    // half of the rule that keeps the warning worth reading.
    const page = await open(fleet({
      state: 'down', prominence: 'quiet', shown: true,
      label: 'unsupervised',
      detail: 'No supervisor is loaded. No agent is running.',
    }));
    try {
      const badge = page.locator('[data-fleet-supervisor]');
      await expect.poll(() => badge.count()).toBe(1);
      expect(await badge.getAttribute('data-fleet-supervisor-prominence')).toBe('quiet');
      expect(await badge.getAttribute('class')).not.toContain('text-amber-600');
    } finally {
      await page.close();
    }
  });

  it('renders `unknown` as neither up nor down', async () => {
    // THE STATE THIS PLAN EXISTS FOR. It must be visible — a board that cannot
    // ask has not established that a supervisor runs — and it must not carry the
    // alarm, because the board's own inability to ask is not a fact about the
    // fleet.
    const page = await open(fleet({
      state: 'unknown', prominence: 'note', shown: true,
      label: 'supervisor unknown',
      detail: 'The board could not ask `plot-fleetctl.sh --status`.',
    }));
    try {
      const badge = page.locator('[data-fleet-supervisor]');
      await expect.poll(() => badge.count()).toBe(1);
      expect(await badge.textContent()).toContain('supervisor unknown');
      // Not the all-clear: it is on screen at all.
      expect(await badge.isVisible()).toBe(true);
      // Not the alarm: no amber.
      expect(await badge.getAttribute('class')).not.toContain('text-amber-600');
      expect(await badge.getAttribute('data-fleet-supervisor-state')).toBe('unknown');
    } finally {
      await page.close();
    }
  });
});
