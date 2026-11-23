import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { expandTickets } from '../catalogue/index.js';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
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
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Design', planState: 'design', group: 'not-started', ageMinutes: null,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, deferredReason: '',
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
      group: 'waiting-on-you', state: 'wip', phase: 'Development', planState: 'approved',
      ageMinutes: 25 * 1440, waitingDays: null, waitingOn: 'you' as const,
      note: 'conflict — rebase needed', kind: 'branch' as const,
      pr: { number: 57, url: 'https://github.com/tiny/garden/pull/57', draft: false, state: 'conflicts' },
    }),
    // A PR row — anything with an open PR that is NOT conflicting.
    row({
      branch: 'feature/reviewed', branchUrl: `${GH}feature/reviewed`,
      group: 'waiting-on-you', state: 'wip', phase: 'Development', planState: 'approved',
      ageMinutes: 3 * 1440, waitingDays: null, waitingOn: 'you' as const,
      note: 'awaiting review', kind: 'pr' as const,
      pr: { number: 58, url: 'https://github.com/tiny/garden/pull/58', draft: false, state: 'green' },
    }),
    // A PLAN's unstarted branch, in NOT STARTED — which is where the board
    // draws a PLAN ROW above the branches it groups.
    row({
      plan: 'plant-tomatoes', planFile: '2026-03-01-plant-tomatoes.md',
      branch: 'feature/sow-seedlings', phase: 'Discovery', planState: 'draft', waitingDays: 5,
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

  async function open(): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: fleet() },
      viewport: { width: 1480, height: 1400 },
    });
    await page.locator('li[data-tuple-kind]').first().waitFor({ timeout: 15_000 });
    await expandAgentFolds(page);
    await expandTickets(page);
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
          work: e.closest('[data-section="work-items"]') !== null,
          cols: getComputedStyle(e).gridTemplateColumns,
        })));
      // Every board-emitted kind is present, so the agreement below is about a
      // real spread rather than about one row agreeing with itself. `wave` joined
      // the list when a plan grew a head and its branches became waves under it.
      const kinds = new Set(templates.map((t) => t.kind));
      // A branch that is the only branch of its slice is the slice's row, so no separate branch row exists.
      expect([...kinds].sort()).toEqual(['plan', 'pr', 'wave']);
      // SEVEN TRACKS on every row — the claim, and the form of it that nesting
      // cannot falsify.
      //
      // The resolved pixel string CANNOT be compared across rows any more, and
      // that is a fact about the layout rather than a weakening of the test.
      // Measured on this fixture, column 4 resolves to 842px, 817px or 792px —
      // 25px apart, which is `ml-6` plus the group's rule. Column 4 is a
      // FLEXIBLE track, so a row nested one level deeper spends 25px of it on
      // the indent while the fixed tracks stay exactly where they are. A row
      // inside a wave group therefore reports a different string for the same
      // template, and asserting `toHaveLength(1)` asserted that no row is ever
      // nested — which the wave model makes permanently false.
      //
      // COLUMN 3 (the NAME) joined column 4 as a per-row track on 2026-08-23:
      // it became `minmax(12rem, auto)`, so `auto` resolves to that row's own
      // content and a plan head with a long name reports a wider column 3 than a
      // branch row beneath it. That is the alignment `agent-rows-line-up`
      // established, and the operator deliberately gave it up so the name renders
      // in full (see `TUPLE_TRACKS` in TupleRow.tsx). Columns 3 AND 4 are
      // therefore both excluded below — the test no longer claims they agree
      // across rows, because they are no longer meant to.
      //
      // What a second grid smuggled in under another name would still fail:
      // the track COUNT, and the FIVE genuinely-fixed tracks, both checked below.
      // TWO GRIDS, one per kind of section: the Work items grid has SEVEN tracks (the marks lane and its six
      // columns), and every other section keeps EIGHT. Each is checked against its own fixed tracks below.
      const tracks = templates.map((t) => ({ kind: t.kind, work: t.work, cols: t.cols.split(' ') }));
      expect(tracks.some((t) => t.work), 'no Work items row rendered').toBe(true);
      for (const t of tracks) {
        expect(t.cols, `${t.kind} lays out on ${t.work ? 'seven' : 'eight'} tracks`).toHaveLength(t.work ? 7 : 8);
      }
      // And the fixed tracks agree EXACTLY — every track but the two flexible
      // ones (column 3 the name, column 4 the links). This is the pixel-level
      // agreement the assertion above was reaching for, asked of the columns
      // that carry it.
      // Column 7 (BY) sizes to who acts, like the name, so it joins the per-row tracks. In the Work items grid the
      // item (column 1) takes the indent and the status (column 3) grows past its bound where its pills need it.
      for (const work of [true, false]) {
        const flexible = new Set(work ? [1, 3] : [2, 3, 6]);
        const grid = tracks.filter((t) => t.work === work);
        const fixed = new Set(grid.map((t) => t.cols.filter((_, i) => !flexible.has(i)).join(' ')));
        expect(fixed.size, `kinds: ${grid.map((t) => t.kind).join()}`).toBeLessThanOrEqual(1);
      }
    } finally {
      await page.close();
    }
  });

  it('gives a ticket row no branch tracks to wear', async () => {
    const page = await open();
    try {
      const ticket = page.locator('section#tickets li[data-issue-row]').first();
      await ticket.waitFor({ timeout: 10_000 });
      // A ticket has no branch, no wave and no worker, and no plan phase.
      expect(await ticket.locator('[data-branch]').count()).toBe(0);
      expect(await ticket.locator('[data-slice]').count()).toBe(0);
      expect(await ticket.locator('[data-phase]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('leads a PR row with the PR and links its branch as an artifact', async () => {
    const page = await open();
    try {
      const pr = page.locator('li[data-tuple-kind="pr"]');
      await pr.waitFor({ timeout: 10_000 });
      // THE ITEM CELL LEADS. A PR's name is its number and its vehicle is the
      // branch — the row leads with what the reader is deciding about.
      const name = pr.locator('[data-row-cell="item"]');
      expect(await name.innerText()).toContain('58');
      expect(await name.locator('a[data-tuple-link="pr"]').count()).toBe(1);
      // THE ITEM'S LINKS HOLD THE VEHICLE, and the branch is IN them — an artifact
      // link, not the subject. Paired against the weaker implementation that drops
      // the branch entirely to make the PR lead.
      const links = pr.locator('[data-item-links]');
      expect(await links.locator('a[data-tuple-link="branch"]').count()).toBe(1);
      expect(await links.locator('[data-branch="feature/reviewed"]').count()).toBe(1);
      // THREE DESTINATIONS, all different — the PR, the branch and the plan.
      //
      // The Delivery tab draws no wave group or plan head, so the row stands
      // alone and names its plan itself. The branch is what the row must NOT
      // drop — slot 3 wears the PR number here rather than the branch, so
      // without it the row never names what it is a PR of.
      //
      // Both halves asserted, because the count alone passes on a row that kept
      // the plan and lost the branch — which is the failure this pairs against.
      const anchors = await pr.locator('a[data-tuple-link]').evaluateAll(
        (els) => els.map((e) => ({ what: e.getAttribute('data-tuple-link'), href: e.getAttribute('href') })));
      expect(new Set(anchors.map((l) => l.href)).size).toBe(3);
      expect(new Set(anchors.map((l) => l.what))).toEqual(new Set(['pr', 'branch', 'plan']));
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
      const branch = page.locator('li[data-tuple-kind="wave"]')
        .filter({ has: page.locator('[data-branch="feature/conflicted"]') });
      await branch.waitFor({ timeout: 10_000 });
      // THE CONFLICT IS ON THE ROW, in a word: a conflicting branch is a You
      // row, and its verb `Resolve` leads it in the kind slot.
      expect(await branch.locator('[data-you-verb]').innerText()).toBe('Resolve ›');
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
      const name = branch.locator('[role="gridcell"]').nth(3);
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
      // `Testing`, 9 `Design` — a fact about the plan on a row about something
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
      //
      // TICKET IS THE NAMED EXCEPTION. `ticket-rows-show-type-and-owner`
      // replaced the per-row word on every ticket in the Waiting-on-you block
      // with one sub-header above the block — the row still says what it is,
      // the sub-header just says it once rather than once per row. Checked
      // below, against the heading rather than the row.
      // A You row leads with its verb in the same slot, so it is asserted apart:
      // its word is the verb, never a blank and never a kind.
      // A Work items row names no kind: its item cell leads it, so it is asserted apart, and must name its item.
      const items = await page.locator('[data-section="work-items"] li[data-tuple-kind] [data-row-cell="item"]')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.trim()));
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every(Boolean), `blank item among: ${JSON.stringify(items)}`).toBe(true);
      expect(await page.locator('[data-section="work-items"] li[data-tuple-kind] [data-kind]').count()).toBe(0);
      const words = await page.locator('li[data-tuple-kind]:not([data-tuple-kind="ticket"]):not(:has([data-you-verb])) [data-kind]')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.trim()));
      const verbs = await page.locator('li[data-tuple-kind] [data-kind] [data-you-verb]')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.trim()));
      expect(verbs.length).toBeGreaterThanOrEqual(1);
      expect(verbs.every((v) => v.endsWith(' ›')), `verbs: ${JSON.stringify(verbs)}`).toBe(true);
      expect(words.length).toBeGreaterThanOrEqual(1);
      expect(words.every(Boolean), `blank kind among: ${JSON.stringify(words)}`).toBe(true);
      // The Tickets header replaces the per-row word, present and non-blank.
      await expect.poll(() =>
        page.locator('[data-tickets-header]').innerText()).toMatch(/\d+ assigned to you with no plan/);
      // And they are the SAME SORT OF WORD on every row — the property the
      // four-meanings column failed at, where the cell read a wave name, a plan
      // phase, nothing, or a plan phase on a ticket depending on a wave count
      // the reader cannot see.
      //
      // MEMBERSHIP CARRIES THAT CLAIM, and a count never did. This asserted
      // `size <= 4` beside the check below, which is the number of kinds this
      // fixture happened to render rather than a property of the column; a
      // plan growing a head and its branches becoming slices pushed it to 5
      // without changing anything the assertion was about. Every word being a
      // KIND is the whole claim — the failure it pairs against is a cell
      // holding a slice NAME or a plan PHASE, and neither is in the list.
      const KINDS = ['plan', 'branch', 'pr', 'ticket', 'slice', 'release', 'build', 'agent'];
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
      const link = page.locator('li[data-tuple-kind="wave"] a[data-tuple-link="branch"]').first();
      await link.waitFor({ timeout: 10_000 });
      const heard = await link.getAttribute('aria-label');
      expect(heard).toBe('feature/conflicted');
      // NOT ASSEMBLED FROM THE HALVES: no space, no newline, nothing the fold
      // could have introduced.
      expect(heard).not.toMatch(/\s/);
      // And the halves really are hidden, so the label is what is announced
      // rather than a second reading beside it.
      expect(await link.locator('[aria-hidden="true"]').count()).toBeGreaterThan(0);
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
      // The conflicting branch's slice has no agent, so the rule puts it under
      // You › Blocks delivery; the PR row is its own item at a gate; the ticket renders
      // in the Tickets section, outside the rule.
      const waiting = page.locator('ul[role="grid"][aria-label^="Blocks delivery"]');
      expect(await waiting.locator('li[data-tuple-kind="wave"]').count()).toBe(1);
      expect(await waiting.locator('li[data-tuple-kind="pr"]').count()).toBe(0);
      const gate = page.locator('ul[role="grid"][aria-label^="At a gate"]');
      expect(await gate.locator('li[data-tuple-kind="pr"]').count()).toBe(1);
      const tickets = page.locator('section#tickets');
      expect(await tickets.locator('li[data-issue-row]').count()).toBe(1);
      expect(await waiting.locator('li[data-tuple-kind="ticket"]').count()).toBe(0);
      // A PLAN ROW HEADS ITS OWN GROUP, in whichever section that group falls.
      //
      // This asserted the opposite — no plan row in WAITING ON YOU, the one
      // plan row only ever in NOT STARTED — and that was true while a plan row
      // was a thing the SERVER emitted for an unstarted `idea/` branch. Plan
      // heads are drawn wherever groups are now, so the two branches sharing
      // `a-plan` get a head here and `plant-tomatoes` gets one over there.
      //
      // The membership claim is unweakened, and it is the one this test is
      // named for: every branch, PR and ticket is in the section its group put
      // it in, and a head appears beside the rows it heads rather than in a
      // section of its own.
      expect(await waiting.locator('li[data-tuple-kind="plan"]').count()).toBe(1);
      const notStarted = page.locator('ul[role="grid"][aria-label^="Input to the fleet"]');
      expect(await notStarted.locator('li[data-tuple-kind="plan"]').count()).toBe(1);
      // And no row CROSSED: the branches stayed where their groups put them.
      expect(await notStarted.locator('li[data-tuple-kind="branch"]').count()).toBe(0);
      expect(await notStarted.locator('li[data-tuple-kind="ticket"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
