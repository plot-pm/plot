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

  it('renders the WORKING row as a wave row, not a branch row', async () => {
    const page = await open();
    try {
      // THE ROW EXISTS AS A WAVE ROW. Before the fix the WORKING wave rendered
      // through `<Row>` and carried `data-agent-row`/`data-tuple-kind="wave"`
      // but no `data-wave-row`, so the section had no wave list at all.
      const working = page.locator(`[data-wave-row="${WORKING_WAVE}"]`);
      await expect.poll(() => working.count()).toBe(1);
      expect(await working.getAttribute('data-tuple-kind')).toBe('wave');
    } finally {
      await page.close();
    }
  });

  it('fills the same slots in WORKING as a wave row does in NOT STARTED', async () => {
    const page = await open();
    try {
      const working = await slotsOf(page, WORKING_WAVE);
      const notStarted = await slotsOf(page, NOT_STARTED_WAVE);

      // SLOT 2 — the kind, `WAVE`, identical in both sections. The source label
      // is `Wave` (`KIND_LABEL.wave`), and the cell wears `text-transform:
      // uppercase`, so `.innerText` — which honours CSS transforms — reads back
      // `WAVE`. The hook attribute carries the untransformed kind. Asserted in
      // both sections AND for equality between them, so the kind cannot read one
      // way in WORKING and another in NOT STARTED.
      expect(working.kindLabel).toBe('wave');
      expect(working.kindLabelText).toBe('WAVE');
      expect(working.kindLabel).toBe(notStarted.kindLabel);
      expect(working.kindLabelText).toBe(notStarted.kindLabelText);

      // SLOT 3 — the wave's OWN NAME leads, asserted BY NAME (items 1, 1b). Not
      // "not the branch name" — that passes on an empty slot; the name itself.
      expect(working.name).toBe(WORKING_WAVE);
      expect(notStarted.name).toBe(NOT_STARTED_WAVE);
      // The branch name is NOT in slot 3 — it is demoted there today.
      expect(working.name).not.toBe(WORKING_BRANCH);
      // Same PROJECTION for the name in both sections — a wave's name is a text
      // `plan` link wherever it renders.
      expect(working.nameAttr).toBe(notStarted.nameAttr);

      // SLOT 4 — the branch (and its plan) travel together, beside the name,
      // exactly as a NOT STARTED wave of one carries them. The branch is asserted
      // BY VALUE (`data-branch`) rather than by rendered text, since `BranchLabel`
      // folds the name into aria-hidden, truncated halves.
      expect(working.linkWhats).toContain('branch');
      expect(working.linkBranches).toContain(WORKING_BRANCH);
      expect(notStarted.linkWhats).toContain('branch');
    } finally {
      await page.close();
    }
  });

  it('keeps the worker facts on the WORKING wave row (item 3)', async () => {
    const page = await open();
    try {
      const working = await slotsOf(page, WORKING_WAVE);
      // A LIVE WORKER BECOMES THE STATUS — `soleRowStatus` returns `working` for
      // a running worker on a non-finished row. The wave keeps its identity and
      // the worker becomes what slot 5 says.
      expect(working.status).toContain('working');
      // The pid note survives on the row — the wave of one inherits its branch's
      // note, so `worker running (pid …)` is not lost.
      expect(working.rowText).toContain(WORKER_PID_NOTE);
    } finally {
      await page.close();
    }
  });

  it('shows NO plan head in WORKING (item 2) — it still orders by agent', async () => {
    const page = await open();
    try {
      // WORKING never groups by plan (`waveGroupsFor` returns [] for it), so no
      // `PlanRow` heads it — `data-tuple-kind="plan"` and the plan-actions menu
      // are both absent from the section. A fix that started grouping WORKING to
      // make the wave render would fail here. The section's grid is scoped by its
      // `aria-label`, the hook `AgentList` gives each group's `<ul role="grid">`.
      const workingGrid = page.locator('ul[role="grid"][aria-label="Working — agent branches"]');
      await expect.poll(() => workingGrid.count()).toBe(1);
      expect(await workingGrid.locator('li[data-tuple-kind="plan"]').count()).toBe(0);
      expect(await workingGrid.locator('[data-plan-actions]').count()).toBe(0);
      // And the wave row IS in this section — the scope is proven non-vacuous.
      expect(await workingGrid.locator(`[data-wave-row="${WORKING_WAVE}"]`).count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});
