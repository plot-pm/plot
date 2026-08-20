import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet, type IssueRow } from '../../src/contract/schema.js';

/**
 * ONE GRID RENDERS A PLAN ROW, A BRANCH ROW AND A TICKET ROW — on the BOARD.
 *
 * ## Why this file exists rather than more of `tuple-row.browser.test.ts`
 *
 * That suite bundles the tuple into a harness page, and its own docstring says
 * why and for how long: *the tuple row has no live call site yet … when the
 * collapse wave gives it one, these assertions move to the board's own page and
 * the harness goes.* This is that move, for the five kinds the board actually
 * emits. The harness keeps the two it cannot — `build` and `agent` have no data
 * source, so no row of either reaches `/api/fleet`, and deleting the harness
 * would delete the only coverage of two of the seven kinds.
 *
 * The difference is not ceremony. A harness proves the COMPONENT renders six
 * slots from a tuple it is handed; only the board proves the ADAPTERS hand it
 * the right one — that a plan row is built from `tupleFromPlan` and not from
 * some second opinion, that a ticket is no longer laid on a branch's tracks,
 * that all three arrive on one grid. Those are claims about three call sites,
 * and a harness has one.
 *
 * ## What each assertion is paired against
 *
 * The rule this estate applies throughout: **a weaker implementation passes the
 * obvious assertion.** A shared grid with three fillers passes *they all have
 * seven cells*; a ticket keeps passing *it has no wave* while still being laid
 * on a branch's tracks, because the cell was empty either way. So each claim is
 * asserted from both sides — the count AND the geometry, the absence AND what
 * stands in its place.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Design', group: 'not-started', ageMinutes: null,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null, deferredReason: '',
  kind: 'branch' as const,
  ...over,
});

const issue = (number: number, title: string): IssueRow => ({
  number, title, url: `https://github.com/tiny/garden/issues/${number}`,
  ageMinutes: 120, labels: [],
});

/**
 * A fleet holding all three row kinds the board emits, in ONE section.
 *
 * One section on purpose: the claim is that the three land on one grid, and
 * three rows in three sections could each be on a grid of its own and still
 * pass every per-row assertion. `waiting-on-you` is the section that holds
 * branches and unplanned tickets together, so it is where a ticket row and a
 * branch row have always been neighbours.
 */
function fleet(): Fleet {
  const rows: AgentRow[] = [
    // A BRANCH with a merge conflict — kind `branch` even though it has a PR,
    // because no PR resolves a conflict. The 67-of-80 case the plan measured.
    row({
      branch: 'feature/conflicted', branchUrl: `${GH}feature/conflicted`,
      group: 'waiting-on-you', state: 'wip', phase: 'Development',
      ageMinutes: 25 * 1440, waitingDays: null, waitingOn: 'you' as const,
      note: 'conflict — rebase needed', kind: 'branch' as const,
      pr: { number: 57, url: 'https://github.com/tiny/garden/pull/57', draft: false, state: 'conflicts' },
    }),
    // A PR row — anything with an open PR that is NOT conflicting.
    row({
      branch: 'feature/reviewed', branchUrl: `${GH}feature/reviewed`,
      group: 'waiting-on-you', state: 'wip', phase: 'Development',
      ageMinutes: 3 * 1440, waitingDays: null, waitingOn: 'you' as const,
      note: 'awaiting review', kind: 'pr' as const,
      pr: { number: 58, url: 'https://github.com/tiny/garden/pull/58', draft: false, state: 'green' },
    }),
    // A PLAN's unstarted branch, in NOT STARTED — which is where the board
    // draws a PLAN ROW above the branches it groups.
    row({
      plan: 'plant-tomatoes', planFile: '2026-03-01-plant-tomatoes.md',
      branch: 'feature/sow-seedlings', phase: 'Discovery', waitingDays: 5,
      waitingOn: 'you' as const, note: 'plan not approved yet — still in review',
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    // The UNPLANNED TICKET — a row with no branch, no wave and no worker, which
    // is exactly what it used to wear seven branch tracks to say.
    issues: [issue(228, 'Fleet scan asks the host once per branch')],
    issueAnswer: 'answered',
    issueError: null,
    summary: { plans: 2, waves: 2, branches: rows.length, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 1, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
}

describe('one grid renders a plan row, a branch row and a ticket row', () => {
  let browser: Browser;
  let server: { port: number; kill: () => void } | undefined;
  let baseURL = '';

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server!.port}/`;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  async function open(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1480, height: 1400 } });
    const page = await context.newPage();
    // SYNCHRONOUS fulfil. A route callback that awaits anything (`route.fetch()`
    // among them) fails suites that already passed on this machine.
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.locator('li[data-tuple-kind]').first().waitFor({ timeout: 15_000 });
    return page;
  }

  it('renders every kind through the SAME grid template', async () => {
    const page = await open();
    try {
      // THE CLAIM, and it is read off the computed style rather than off a class
      // name. `grid-template-columns` is what the browser RESOLVED, so a second
      // grid reintroduced under any name — or a row that quietly stopped being a
      // grid below its breakpoint — fails here. A class-name assertion would
      // pass on two constants holding the same string, which is the state the
      // board was in before `PLAN_ROW_TRACKS` diverged from `ROW_TRACKS`.
      const templates = await page.locator('li[data-tuple-kind]').evaluateAll(
        (els) => els.map((e) => ({
          kind: e.getAttribute('data-tuple-kind'),
          cols: getComputedStyle(e).gridTemplateColumns,
        })));
      // All five board-emitted kinds are present, so the agreement below is
      // about a real spread rather than about one row agreeing with itself.
      const kinds = new Set(templates.map((t) => t.kind));
      expect([...kinds].sort()).toEqual(['branch', 'plan', 'pr', 'ticket']);
      // ONE resolved template across every row on the page.
      const distinct = new Set(templates.map((t) => t.cols));
      expect([...distinct], `kinds: ${templates.map((t) => t.kind).join()}`).toHaveLength(1);
      // And it is a SEVEN-track grid, not a one-column fallback that would make
      // every row trivially agree — the weaker implementation this pairs against.
      expect([...distinct][0].split(' ')).toHaveLength(7);
    } finally {
      await page.close();
    }
  });

  it('gives a ticket row no branch tracks to wear', async () => {
    const page = await open();
    try {
      const ticket = page.locator('li[data-tuple-kind="ticket"]');
      await ticket.waitFor({ timeout: 10_000 });
      // THE DEFECT, from both sides. A ticket has no branch, no wave and no
      // worker — and it used to render the columns for all three because it was
      // laid on `ROW_TRACKS`.
      expect(await ticket.locator('[data-branch]').count()).toBe(0);
      expect(await ticket.locator('[data-wave]').count()).toBe(0);
      // And the cell that used to hold a plan PHASE on a row that is not a plan
      // now holds the KIND, in a word, which is the fact that cell was always
      // failing to state.
      expect(await ticket.locator('[data-phase]').count()).toBe(0);
      // CASE-INSENSITIVE, because slot 2 wears Tailwind's `uppercase` on the
      // board and the authored word is `Story`. Asserting the styled form would
      // make this a claim about a CSS utility rather than about the kind being
      // stated — the same reason the harness suite lowercases, arrived at from
      // the other direction: there no stylesheet loads, so it reads `Story`.
      expect((await ticket.locator('[data-kind]').innerText()).toLowerCase()).toBe('story');
    } finally {
      await page.close();
    }
  });

  it('leads a PR row with the PR and links its branch as an artifact', async () => {
    const page = await open();
    try {
      const pr = page.locator('li[data-tuple-kind="pr"]');
      await pr.waitFor({ timeout: 10_000 });
      // SLOT 3 IS THE ITEM. A PR's name is its number and its vehicle is the
      // branch — the row leads with what the reader is deciding about.
      const name = pr.locator('[role="gridcell"]').nth(2);
      expect(await name.innerText()).toContain('58');
      expect(await name.locator('a[data-tuple-link="pr"]').count()).toBe(1);
      // SLOT 4 IS THE VEHICLE, and the branch is IN it — an artifact link, not
      // the subject. Paired against the weaker implementation that drops the
      // branch entirely to make the PR lead.
      const links = pr.locator('[role="gridcell"]').nth(3);
      expect(await links.locator('a[data-tuple-link="branch"]').count()).toBe(1);
      expect(await links.locator('[data-branch="feature/reviewed"]').count()).toBe(1);
      // THREE DESTINATIONS, all different — the plan, the branch, the PR.
      const hrefs = await pr.locator('a[data-tuple-link]').evaluateAll(
        (els) => els.map((e) => e.getAttribute('href')));
      expect(new Set(hrefs).size).toBe(3);
    } finally {
      await page.close();
    }
  });

  it('keeps a merge conflict readable on the branch it belongs to', async () => {
    const page = await open();
    try {
      // THE NORMAL CASE, NOT AN EDGE: 67 of 80 live rows carry both a branch
      // and a PR. A conflicting one is kind `branch`, because no PR resolves a
      // conflict and the reader has to go rebase.
      const branch = page.locator('li[data-tuple-kind="branch"]')
        .filter({ has: page.locator('[data-branch="feature/conflicted"]') });
      await branch.waitFor({ timeout: 10_000 });
      // THE CONFLICT IS ON THE ROW, in the status slot, in a word.
      expect(await branch.locator('[data-pr-state="conflicts"]').innerText()).toBe('conflicts');
      // AND THE ROW LEADS WITH THE BRANCH — which is where the reader must go.
      // The pairing: a row that says `conflicts` while leading with the PR
      // sends them to a page that cannot fix it.
      // READ FROM `data-branch`, not from the rendered text. A branch name is
      // folded in the MIDDLE when the slot cannot hold it — `splitBranch` hands
      // the browser two spans so the last twelve characters always survive —
      // and `innerText` reports a newline between them: `featur\ne/conflicted`.
      // The fold is a fact about the slot's width and belongs to the visual
      // channel alone, which is why the halves are `aria-hidden` and the whole
      // name rides on the attribute. A text assertion here would be a claim
      // about the viewport rather than about which fact leads.
      const name = branch.locator('[role="gridcell"]').nth(2);
      expect(await name.locator('[data-branch]').getAttribute('data-branch'))
        .toBe('feature/conflicted');
      // The PR's NUMBER is still on the row, beside the condition — context
      // rather than a route, because the route is the branch.
      expect(await branch.innerText()).toContain('57');
    } finally {
      await page.close();
    }
  });

  it('states the plan\'s phase on the PLAN row and nowhere else', async () => {
    const page = await open();
    try {
      // 71 branch rows printed their plan's phase — 36 `Development`, 26
      // `Endgame`, 9 `Design` — a fact about the plan on a row about something
      // else. Slot 5 on the PLAN row is where that fact is true.
      const planRow = page.locator('li[data-tuple-kind="plan"]');
      await planRow.first().waitFor({ timeout: 10_000 });
      expect(await planRow.first().locator('[data-phase]').count()).toBe(1);
      // NO ROW OF ANY OTHER KIND carries one. Asserted across the whole page
      // rather than on one row: the defect was 71 rows, and a per-row check
      // passes on the 72nd.
      for (const kind of ['branch', 'pr', 'ticket']) {
        expect(
          await page.locator(`li[data-tuple-kind="${kind}"] [data-phase]`).count(),
          `${kind} carries a phase that is not its own`,
        ).toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('says what kind every row is, without hovering', async () => {
    const page = await open();
    try {
      // `innerText` rather than `textContent`, because the question is what a
      // reader SEES: it is computed from layout and reports "" for a hidden
      // box, so a kind moved back into a `title` fails here. That is the
      // tooltip-as-label defect, and it is the reason the board renders a word
      // at all rather than only an icon.
      const words = await page.locator('li[data-tuple-kind] [data-kind]')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.trim()));
      expect(words.length).toBeGreaterThanOrEqual(4);
      expect(words.every(Boolean), `blank kind among: ${JSON.stringify(words)}`).toBe(true);
      // And they are the SAME SORT OF WORD on every row — the property the
      // four-meanings column failed at, where the cell read a wave name, a plan
      // phase, nothing, or a plan phase on a ticket depending on a wave count
      // the reader cannot see.
      expect(new Set(words).size).toBeLessThanOrEqual(4);
      const KINDS = ['plan', 'branch', 'pr', 'story', 'release', 'build', 'agent'];
      for (const w of new Set(words)) {
        expect(KINDS, `kind word: ${w}`).toContain(w.toLowerCase());
      }
    } finally {
      await page.close();
    }
  });

  it('announces a folded branch name WHOLE, not in halves', async () => {
    const page = await open();
    try {
      // A long branch folds in the MIDDLE — `splitBranch` hands the browser two
      // spans so the last twelve characters always survive, because six
      // branches here share twenty-four characters of prefix and end-truncation
      // renders them identically.
      //
      // THE FOLD IS VISUAL ONLY, and this is the assertion that keeps it so.
      // The halves are flex ITEMS, and the accessible-name algorithm joins
      // adjacent boxes with a space: `BranchName` measured the row announcing
      // `feat ure/reviewed`, a name no host would recognise and none a reader
      // could search for. Hiding the halves fixes that — and takes the name
      // with it, which is the defect on the other side and the one the collapse
      // shipped for one commit. Both are asserted here, because a fix for
      // either alone passes half of this.
      const link = page.locator('li[data-tuple-kind="branch"] a[data-tuple-link="branch"]').first();
      await link.waitFor({ timeout: 10_000 });
      const heard = await link.getAttribute('aria-label');
      expect(heard).toBe('feature/conflicted');
      // NOT ASSEMBLED FROM THE HALVES: no space, no newline, nothing the fold
      // could have introduced.
      expect(heard).not.toMatch(/\s/);
      // And the halves really are hidden, so the label is what is announced
      // rather than a second reading beside it.
      expect(await link.locator('[aria-hidden="true"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('keeps every section\'s membership unchanged', async () => {
    const page = await open();
    try {
      // MEMBERSHIP IS OUT OF SCOPE, and this is what says so. The collapse
      // changes how a row RENDERS; which section it appears in is a separate
      // decision, and a rendering change that quietly moved a row between
      // groups would be the most expensive kind of regression here — the
      // sections are what a reader scans first.
      const waiting = page.locator('ul[role="grid"][aria-label^="Waiting on you"]');
      // Two branches and one ticket, exactly as the fleet places them.
      expect(await waiting.locator('li[data-tuple-kind="branch"]').count()).toBe(1);
      expect(await waiting.locator('li[data-tuple-kind="pr"]').count()).toBe(1);
      expect(await waiting.locator('li[data-tuple-kind="ticket"]').count()).toBe(1);
      // And the plan row is in NOT STARTED, where plan rows are drawn — not in
      // the section its branch's group would put it.
      expect(await waiting.locator('li[data-tuple-kind="plan"]').count()).toBe(0);
      const notStarted = page.locator('ul[role="grid"][aria-label^="Not started"]');
      expect(await notStarted.locator('li[data-tuple-kind="plan"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});
