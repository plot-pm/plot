import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import type { AgentRow, Fleet } from '../../src/contract/schema.js';

/**
 * A WAVE ROW IS A WAVE ROW EVERYWHERE — measured in a browser, WORKING included.
 *
 * The defect (`a-wave-row-is-a-wave-row-everywhere`, wave 1): a row whose `kind`
 * is `wave` renders through the wave row in NOT STARTED — its NAME leads slot 3 —
 * and as a BRANCH row in WORKING — the branch leads slot 3 and the wave name is
 * demoted to a badge. Same kind, same payload, two grammars.
 *
 * The cause is one function deciding two questions: `waveGroupsFor` is scoped to
 * one section on purpose (WORKING orders by agent, must not group by plan), and
 * `ungroupedRows` — its complement — renders everything it returns as `<Row>`, a
 * branch row. Skipping the GROUP should not skip the ROW's kind.
 *
 * So this asserts, SLOT BY SLOT and against a NOT STARTED row of the same kind,
 * that a wave in WORKING fills the seven tracks the same way: `WAVE` in slot 2,
 * the wave's NAME in slot 3 (asserted BY NAME, since a test for *not the branch
 * name* passes on an empty slot), the branch and plan together in slot 4. And
 * the two properties a naive fix breaks: WORKING shows NO plan heads (item 2),
 * and the worker facts survive on the wave row itself (item 3).
 *
 * **A literal payload, fulfilled synchronously.** The bug is a placement decision
 * in the adapter (`AgentList`), so the fixture is a fleet whose WORKING row is a
 * `kind: 'wave'` row the way the server emits one (`carriesWave` — the plan has
 * waves) — a route that awaits anything fails suites that already passed here.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

// The two wave names, on this repo's estate, so slot 3 can be asserted BY NAME.
const WORKING_WAVE = 'Named';
const NOT_STARTED_WAVE = 'Anchored';
const WORKING_BRANCH = 'bug/a-wave-row-names-its-wave';
const WORKER_PID_NOTE = 'worker running (pid 45678)';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-24-a-plan.md',
  wave: 'w', state: 'wip', phase: null, group: 'working', ageMinutes: 30,
  waitingOn: null, note: '', pr: null, branchUrl: '', waitingDays: null,
  kind: 'wave', worker: 'none', localDirty: false, localLocked: false,
  blockedBy: null, verdict: null, stuck: null, repair: null, deferredReason: '',
  ...over,
});

/**
 * A fleet with the same wave kind in two sections. WORKING carries a wave being
 * worked (a live worker, no fold — a wave of one); NOT STARTED carries a wave a
 * person may start. Two DIFFERENT plans, so neither section could group them into
 * one head even if it tried.
 */
function fleet(): Fleet {
  const rows: AgentRow[] = [
    row({
      kind: 'wave', group: 'working',
      plan: 'one-wave-row-two-contents',
      planFile: '2026-08-24-one-wave-row-two-contents.md',
      branch: WORKING_BRANCH, branchUrl: `https://github.com/tiny/garden/tree/${WORKING_BRANCH}`,
      wave: WORKING_WAVE, worker: 'running', ageMinutes: 33, note: WORKER_PID_NOTE,
    }),
    row({
      kind: 'wave', group: 'not-started',
      plan: 'a-wave-is-a-thing-not-a-label',
      planFile: '2026-08-24-a-wave-is-a-thing-not-a-label.md',
      branch: 'feature/anchor-the-wave',
      branchUrl: 'https://github.com/tiny/garden/tree/feature/anchor-the-wave',
      // `state: 'open'` is what makes NOT STARTED render this as a wave row: the
      // section's `countsPlans` arm groups only `isUnbegun` rows
      // (`group === 'not-started' && state === 'open'`). The rescued fixture left
      // it at the `row()` default (`wip`), so the BASELINE wave never rendered and
      // all four tests timed out on `Anchored` — the fixture bug the brief warned
      // a selector typo would look identical to. An unstarted, eligible wave is
      // `open` by definition, so this matches the row's own intent.
      state: 'open',
      wave: NOT_STARTED_WAVE, verdict: 'eligible', waitingDays: 2, ageMinutes: null,
      note: 'approved — nobody has taken it',
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    issues: [], issueAnswer: 'answered', issueError: null,
    summary: { plans: 2, waves: 2, branches: rows.length, claimed: 1, eligible: 1, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
}

/**
 * The seven slots of one wave row, read at one layout so the two rows are
 * compared under the same render. Each slot is a `role="gridcell"` in order;
 * the hooks match `TupleRow.tsx`.
 */
async function slotsOf(page: Page, wave: string) {
  const waveRow = page.locator(`[data-wave-row="${wave}"]`);
  await expect.poll(() => waveRow.count()).toBe(1);
  return waveRow.evaluate((rowEl) => {
    const kind = rowEl.getAttribute('data-tuple-kind');
    const kindLabel = rowEl.querySelector('[data-tuple-kind-label]');
    // Slot 3 — the item's own name. A wave projects its name as a text `plan`
    // link with no href (`tupleFromWave`), so it is `[data-tuple-text="plan"]`.
    const nameCell = rowEl.querySelector('[role="gridcell"]:nth-of-type(3)');
    const name = nameCell?.querySelector('[data-tuple-text],[data-tuple-link]') as HTMLElement | null;
    // Slot 4 — the artifact links. A wave of one carries its branch (and, off a
    // plan head, its plan) here.
    const linksCell = rowEl.querySelector('[role="gridcell"]:nth-of-type(4)');
    const linkWhats = [...(linksCell?.querySelectorAll('[data-tuple-what]') ?? [])]
      .map((el) => el.getAttribute('data-tuple-what'));
    const linkLabels = [...(linksCell?.querySelectorAll('[data-tuple-link],[data-tuple-text]') ?? [])]
      .map((el) => (el as HTMLElement).innerText.trim());
    // A branch link folds its name into two `aria-hidden` spans (`BranchLabel`)
    // and clips the head with `truncate`, so `.innerText` is neither reliable nor
    // the full name. The VALUE rides on `data-branch` — the hook a dozen test
    // files use to find *the row for this branch* — so slot 4's branch names are
    // read from there, not from the rendered text.
    const linkBranches = [...(linksCell?.querySelectorAll('[data-branch]') ?? [])]
      .map((el) => el.getAttribute('data-branch'));
    const status = rowEl.querySelector('[data-tuple-status]') as HTMLElement | null;
    return {
      kind,
      kindLabel: kindLabel ? kindLabel.getAttribute('data-tuple-kind-label') : null,
      kindLabelText: kindLabel ? (kindLabel as HTMLElement).innerText.trim() : null,
      name: name ? name.innerText.trim() : null,
      nameAttr: name ? (name.getAttribute('data-tuple-text') ?? name.getAttribute('data-tuple-link')) : null,
      linkWhats,
      linkLabels,
      linkBranches,
      status: status ? status.innerText.trim() : null,
      rowText: (rowEl as HTMLElement).innerText,
    };
  });
}

describe('a wave row is a wave row in every section', () => {
  // WHAT THIS FILE CLAIMS, AND WHAT IT STOPPED CLAIMING ON 2026-08-25.
  //
  // It was written for `a-wave-row-is-a-wave-row-everywhere` (#392), and its
  // subject was WORKING: a wave rendered there through `<Row>` as a BRANCH row,
  // so the same wave read as a wave in NOT STARTED and as a branch here.
  //
  // `the-working-section-shows-every-worker` (#398) then re-keyed WORKING on the
  // REGISTRY: one row per live agent, because a worker rendered as a property of
  // its branch is invisible whenever its branch has no row — measured at 23
  // registry entries against 0 rows in WORKING, with 6 agents whose branch the
  // pulse never produced.
  //
  // The two cannot both hold, and the operator chose the registry. So the claim
  // *the WORKING row is a wave row* is RETIRED, and the three claims that do not
  // depend on WORKING's keying are kept and still asserted:
  //
  //   - a wave row in NOT STARTED renders as a wave, with its own name in slot 3
  //   - the worker's facts (status, pid note) reach the row that represents it
  //   - WORKING carries NO plan head — it orders by agent, never by plan
  //
  // Retiring the first without keeping these three would drop live regression
  // cover along with the obsolete assertion. `working-shows-every-agent.browser
  // .test.ts` owns what WORKING renders now; this file owns what survived.
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
    const context = await browser.newContext({ viewport: { width: 1480, height: 1400 } });
    const page = await context.newPage();
    // SYNCHRONOUS fulfil — a route callback that awaits anything fails suites
    // that already passed on this machine.
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.locator(`[data-wave-row="${NOT_STARTED_WAVE}"]`).first().waitFor({ timeout: 15_000 });
    return page;
  }

  it('renders a wave row as a wave in NOT STARTED — its own name in slot 3', async () => {
    const page = await open();
    try {
      // THE SURVIVING HALF OF #392's FIRST CLAIM. WORKING no longer renders wave
      // rows at all, but a wave in a wave-grouped section still must: the defect
      // #392 fixed was a wave rendering through `<Row>` and losing its name to a
      // badge, and NOT STARTED is where that is still observable.
      const ns = page.locator(`[data-wave-row="${NOT_STARTED_WAVE}"]`);
      await expect.poll(() => ns.count()).toBe(1);
      expect(await ns.getAttribute('data-tuple-kind')).toBe('wave');

      const slots = await slotsOf(page, NOT_STARTED_WAVE);
      // Slot 2 is the kind. The label is `Wave`, uppercased by CSS, and
      // `.innerText` honours the transform while the attribute does not.
      expect(slots.kindLabel).toBe('wave');
      expect(slots.kindLabelText).toBe('WAVE');
      // Slot 3 leads with the wave's OWN NAME — asserted BY NAME, because
      // "not the branch name" also passes on an empty slot.
      expect(slots.name).toBe(NOT_STARTED_WAVE);
    } finally {
      await page.close();
    }
  });

  // THE WORKER-FACTS CLAIM MOVED, rather than being deleted.
  //
  // #392 asserted it here on a WAVE row: a live worker becomes the status, and
  // `worker running (pid …)` survives onto the row. Under the registry keying
  // WORKING renders from `fleet.agents`, and this file's fixture supplies no
  // registry — so the section is empty here and the assertion would be testing
  // its own fixture, not the board. Tried it: the section's innerText read back
  // as the column headers plus `none`.
  //
  // `working-shows-every-agent.browser.test.ts` asserts it with a real registry
  // (`reads \`running\` for a running worker`), which is where the
  // claim can actually be observed. Duplicating it here against an empty section
  // would be a test that passes for the wrong reason, or fails for one.

  it('shows NO plan head in WORKING (item 2) — it still orders by agent', async () => {
    const page = await open();
    try {
      // UNCHANGED BY THE RE-KEYING, and the reason it is kept verbatim: both
      // designs agree WORKING never groups by plan. Under #392 that held because
      // `waveGroupsFor` returns [] for the section; under #398 it holds because
      // the rows are agents, which no plan heads. A fix that started grouping
      // WORKING — for either design — fails here.
      const workingGrid = page.locator('ul[role="grid"][aria-label="Working — agent branches"]');
      await expect.poll(() => workingGrid.count()).toBe(1);
      expect(await workingGrid.locator('li[data-tuple-kind="plan"]').count()).toBe(0);
      expect(await workingGrid.locator('[data-plan-actions]').count()).toBe(0);
      // NON-VACUOUS: the section has rows, so the two zeroes above mean something.
      expect(await workingGrid.locator('li').count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });
});
