import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import type { AgentEntry, AgentRow, Fleet, Supervisor } from '../../src/contract/schema.js';

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
 *
 * ## The placement assertion is INVERTED, not deleted
 *
 * Wave 2 shipped the alert inside `ParallelAgentsStepper` and this file locked
 * it there — `el.closest('[data-fleet-parallel-agents]') !== null`. Wave 3
 * moves it out, so that assertion is rewritten to assert the OPPOSITE rather
 * than dropped: the new placement is locked the way the old one was, and a
 * later hand nesting it back in the control fails here.
 *
 * The reason it moved is not layout tidiness. Nested in a `spinbutton` a screen
 * reader announces the outage sentence as part of the control's VALUE, and the
 * control is now right-aligned, which would have carried an alert into the
 * column a control owns.
 *
 * NOTE ON THE LABELS BELOW: this file stubs its own (`label: 'unsupervised'`),
 * so it passes despite wave 2's rename to the FLEET vocabulary. Those strings
 * are fixtures, not the current wording — `packages/domain/test/supervisor-
 * reading.test.ts` owns what the words are.
 */
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null, ...over,
});

/**
 * One registry entry. WORKING RENDERS THE REGISTRY, not the rows — so a fixture
 * whose `rows` place a branch in `working` and whose `agents` do not name it
 * renders an EMPTY section and every assertion against it times out.
 *
 * `identity` defaults to `manifest`: a declared agent is the ordinary row, and
 * the undeclared one is the case a test states explicitly.
 */
const agent = (over: Partial<AgentEntry> = {}): AgentEntry => ({
  session: 'sess0000', identity: 'manifest', branch: 'feature/x',
  worktree: '/wt/plot-wt-x', command: '', startedAt: '', pid: '', previousPid: '',
  relaunches: 0, state: 'running', ...over,
});

/** A pulse with a row in WORKING and one in NOT STARTED, so both headers render. */
function fleet(supervisor: Supervisor | undefined, agents?: AgentEntry[]): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/working-a', plan: 'beans', group: 'working', ageMinutes: 10 }),
    row({
      branch: 'feature/untaken', plan: 'plant-tomatoes', group: 'not-started',
      state: 'open', phase: 'Design', ageMinutes: null, waitingOn: 'click' as const,
      note: 'ready', branchUrl: `${GH}feature/untaken`, waitingDays: 3,
    }),
  ];
  return {
    agents: agents ?? [agent({ session: 'worka001', branch: 'feature/working-a' })],
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
      // OUTSIDE THE CONTROL — the anti-contract flip. Wave 2 asserted this was
      // `true`; the alert is neither a control nor its value, and a
      // `spinbutton` announces its contents as part of what it reads.
      expect(
        await badge.evaluate((el) => el.closest('[data-fleet-parallel-agents]') !== null),
      ).toBe(false);
      // AND OUTSIDE THE HEADING, on its own line. Asserted as well as the
      // negative above, because *not in the stepper* is also satisfied by
      // sitting elsewhere inside the `<h2>` — which is the placement that would
      // still make the alert compete with the control for the right edge.
      expect(await badge.evaluate((el) => el.closest('h2') !== null)).toBe(false);
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
  it('keeps every WORKING row when the fleet is stopped', async () => {
    // THE NAIVE IMPLEMENTATION OF "the section carries the warning" IS TO
    // REPLACE THE SECTION'S CONTENTS WITH IT, and that is what this refuses.
    //
    // The rows are real processes. `fleet.ts:383` — "THE WORKING SECTION IS THE
    // REGISTRY" — reads manifests and worktrees from disk and never the
    // supervisor, so a stopped fleet does not empty the section, and each row's
    // `running` stays literally true because the pids still exist. Hiding them
    // loses processes an operator may need to stop by hand; marking each row
    // repeats one fact N times.
    //
    // ASSERTED AS A COMPARISON, not as an absolute count. A test asserting
    // `toBe(3)` against the unsupervised fixture alone passes an implementation
    // that renders three rows for unrelated reasons; the property is that the
    // number does not MOVE between a supervised and an unsupervised board.
    const agents = [
      agent({ session: 'worka001', branch: 'feature/working-a' }),
      agent({ session: 'workb002', branch: 'feature/spare-b' }),
      agent({ session: 'workc003', branch: 'feature/spare-c' }),
    ];
    const supervised = await open(fleet({
      state: 'up', prominence: 'quiet', shown: false,
      label: 'fleet running', detail: 'The fleet is supervised.',
    }, agents));
    let before: number;
    try {
      before = await supervised.locator('[data-agent-row]').count();
      expect(before).toBeGreaterThan(0);
    } finally {
      await supervised.close();
    }
    const stopped = await open(fleet({
      state: 'down', prominence: 'alert', shown: true,
      label: 'FLEET STOPPED',
      detail: 'No supervisor is loaded, and 3 agents are running. Start it: `/plot-fleet --start`',
    }, agents));
    try {
      // The alert is on screen — otherwise the row count below proves nothing.
      await expect.poll(() => stopped.locator('[data-fleet-supervisor]').count()).toBe(1);
      expect(await stopped.locator('[data-agent-row]').count()).toBe(before);
    } finally {
      await stopped.close();
    }
  });

  it('renders a desk with no manifest as an error row, and still renders it', async () => {
    // TWO ASSERTIONS, NOT ONE. A test asserting only the error kind passes an
    // implementation that DROPS the desk, which is the outcome the plan
    // explicitly refuses: the desk is what holds the work, so enforcement
    // changes the row's kind and never its existence.
    const page = await open(fleet(undefined, [
      agent({ session: 'declar01', branch: 'feature/working-a', identity: 'manifest' }),
      // No manifest declared this one — the registry inferred it from a desk.
      agent({ session: '', branch: 'feature/undeclared', worktree: '/wt/plot-wt-undeclared',
        identity: 'synthesized' }),
    ]));
    try {
      // IT RENDERS. Both entries have rows — the undeclared one was not dropped.
      await expect.poll(() => page.locator('[data-agent-row]').count()).toBe(2);
      // AND ITS KIND CHANGED. Exactly the undeclared desk is marked, so the
      // assertion is also that the declared one is NOT — a blanket error state
      // would satisfy a count of one but not this pair.
      expect(await page.locator('[data-agent-undeclared]').count()).toBe(1);
      // AND IT IS THE RIGHT ROW. Identified by the agent row's own per-branch
      // id rather than `data-branch`, which is a LINK attribute: this desk has
      // no joined branch row, so it renders no branch link and carries none.
      const marked = page.locator('[data-agent-row][data-agent-undeclared]');
      expect(await marked.getAttribute('id')).toBe('agent-row-feature/undeclared');
    } finally {
      await page.close();
    }
  });
});
