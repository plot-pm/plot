import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, expandAgentFolds, type Catalogue } from '../catalogue/index.js';
import { type AgentRow, type Fleet, type FleetSprint, type IssueRow } from '../../src/contract/schema.js';

/**
 * A SPRINT VIEW SAYS WHAT IT HID — #1058, measured in a browser.
 *
 * «Sprint only» passes the release row and a PR naming no plan without asking
 * about membership. The fixture carries a MEMBER row beside the exempt ones, so
 * a mark rendered on every row fails, and rows the filter must hide, so a
 * filter that stopped hiding anything fails too.
 *
 * THE TOGGLE IS NOW ONE CHIP, all-or-nothing — `the-delivery-tab-renders-one-
 * chip-row` replaced the per-sprint checkbox (`data-sprint-toggle="<slug>"`)
 * this file drove with `[data-chip="This sprint"]`. The exempt/member marking
 * this file exists to test is unchanged by that rewrite — `rows.tsx`'s
 * `data-sprint-exempt` and `AgentList.tsx`'s per-section `hiddenSuffix` /
 * `data-sprint-unfiltered` are untouched — so only the toggle locator moved.
 * One test did not survive: the old control rendered a tab-wide
 * `data-sprint-hidden` / `data-sprint-exempt-count` total on a single
 * unkeyed `[data-sprint-report]`, and the new `DeliveryFilters` renders that
 * attribute keyed per ACTIVE SPRINT with no tab-wide hidden/exempt total at
 * all — see the comment above `does not count an ownership-hidden row under
 * Sprint only` below for why neither surviving figure is a substitute.
 */
const ME = 'gardener';
const THEM = 'neighbour';
const SPRINT = 'the-leg';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', kind: 'pr', branch: 'feature/x', plan: 'member-plan', planFile: '2026-09-01-member-plan.md',
  wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you', ageMinutes: 10,
  waitingOn: 'you', note: 'PR green', pr: null, branchUrl: '', waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, deferredReason: '',
  ...over,
} as unknown as AgentRow);

const pr = (number: number, author: string) =>
  ({ number, url: `https://github.com/tiny/garden/pull/${number}`, draft: false, state: 'green', author });

/**
 *   `feature/member`          a member plan's PR, mine — shown, NO mark
 *   `feature/member-theirs`   a member plan's PR, somebody else's — hidden only
 *                             by «Only my work», never by the sprint
 *   `infra/bump`              a PR naming no plan — exempt, shown, MARKED
 *   `changeset-release/main`  the release row — exempt, shown, MARKED
 *   `feature/elsewhere`       a PR under a plan no selected sprint names — hidden
 *   `loose/ref`               a plan-less branch with no PR — hidden today, and
 *                             stays hidden: it is not exempt
 */
const MEMBER = 'feature/member';
const MEMBER_THEIRS = 'feature/member-theirs';
const EXEMPT_PR = 'infra/bump';
const RELEASE = 'changeset-release/main';
const ELSEWHERE = 'feature/elsewhere';
const LOOSE = 'loose/ref';

const sprint: FleetSprint = {
  slug: SPRINT, title: 'The leg', release: '', timebox: 'none', timeboxLabel: '',
  counts: { total: 1, open: 0, wip: 1, done: 0, withdrawn: 0 },
  members: [{ slug: 'member-plan', text: '', tier: 'must', checked: false, known: true }],
} as unknown as FleetSprint;

const issue = (number: number): IssueRow => ({
  number, title: 'An issue carries no sprint', url: '', ageMinutes: 60, status: 'open', statusCategory: 'To Do', assignees: [],
} as unknown as IssueRow);

function fleet(keep: (r: AgentRow) => boolean = () => true): Fleet {
  const all: AgentRow[] = [
    row({ branch: MEMBER, pr: pr(11, ME) } as Partial<AgentRow>),
    row({ branch: MEMBER_THEIRS, pr: pr(12, THEM) } as Partial<AgentRow>),
    row({ branch: EXEMPT_PR, plan: '', planFile: '', wave: '', pr: pr(13, ME) } as Partial<AgentRow>),
    row({ kind: 'release', branch: RELEASE, plan: '', planFile: '', wave: '', pr: pr(14, ME) } as Partial<AgentRow>),
    row({
      branch: ELSEWHERE, plan: 'other-plan', planFile: '2026-09-02-other-plan.md', pr: pr(15, ME),
    } as Partial<AgentRow>),
    row({ kind: 'branch', branch: LOOSE, plan: '', planFile: '', wave: '', pr: null }),
  ];
  const rows = all.filter(keep);
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows, sprints: [sprint],
    issues: [issue(301)], issueAnswer: 'answered', issueError: null,
    summary: { plans: 2, waves: 2, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
}

describe('a sprint view says what it hid', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(payload: Fleet = fleet()): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: {
        fleet: payload,
        board: buildBoard({
          server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME },
        }),
      },
    });
    await page.getByText('Waiting on you').first().waitFor({ timeout: 15_000 });
    await reveal(page);
    return page;
  }

  async function reveal(page: Page): Promise<void> {
    const toggle = page.locator('[data-group-toggle="waiting-on-you"]');
    if (await toggle.count() > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click();
    }
    await expandAgentFolds(page);
  }

  const branches = async (page: Page): Promise<string[]> =>
    page.locator('[data-agent-row][data-branch], [data-agent-row] [data-branch]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-branch') ?? '').filter(Boolean));

  /** The branches whose row carries the exempt mark. */
  const marked = async (page: Page): Promise<string[]> =>
    page.locator('[data-agent-row]').evaluateAll((els) =>
      els
        .filter((e) => e.querySelector('[data-sprint-exempt]'))
        .map((e) => e.getAttribute('data-branch') ?? e.querySelector('[data-branch]')?.getAttribute('data-branch') ?? ''));

  const header = (page: Page) =>
    page.locator('section:has([data-group-toggle="waiting-on-you"]) h2').first();

  // THE CHIP, all-or-nothing — replaces the per-sprint `data-sprint-toggle`.
  const chip = (page: Page) => page.locator('[data-chip="This sprint"]');

  async function sprintOnly(page: Page): Promise<void> {
    await chip(page).click();
    await expect.poll(async () => (await branches(page)).includes(ELSEWHERE)).toBe(false);
    await reveal(page);
  }

  it('marks the exempt rows and not the member row', async () => {
    const page = await open();
    try {
      // OFF: no mark anywhere — the mark reports what the filter did.
      expect(await page.locator('[data-sprint-exempt]').count()).toBe(0);

      await sprintOnly(page);
      const shown = await branches(page);
      expect(shown).toContain(MEMBER);
      const withMark = await marked(page);
      expect(withMark.sort()).toEqual([RELEASE, EXEMPT_PR].sort());
      expect(withMark).not.toContain(MEMBER);
    } finally {
      await page.close();
    }
  });

  it('hides no row the exemption showed before', async () => {
    const page = await open();
    try {
      await sprintOnly(page);
      const shown = await branches(page);
      // The exempt set is shown with the filter on.
      expect(shown).toContain(EXEMPT_PR);
      expect(shown).toContain(RELEASE);
      // And the filter still filters.
      expect(shown).not.toContain(ELSEWHERE);
      expect(shown).not.toContain(LOOSE);
    } finally {
      await page.close();
    }
  });

  // THE CONTROL-LEVEL REPORT HAS NO REPLACEMENT. `SprintFilter` rendered one
  // unkeyed `[data-sprint-report]` carrying tab-wide `data-sprint-hidden` and
  // `data-sprint-exempt-count` totals ("2 rows hidden" / "2 shown without a
  // plan"). `DeliveryFilters` renders `data-sprint-report={sprint.slug}`
  // instead — ONE PER ACTIVE SPRINT, naming that sprint's own item counts,
  // per `FleetSprintSchema`'s own TSDoc on why one sprint's line must never
  // fold into another's. Neither of the two per-section figures that DID
  // survive the rewrite is a substitute: `hiddenSuffix`
  // (`— N hidden by Sprint only`, read via `header(page)`'s text below) is
  // PER SECTION, not a tab-wide total, and `data-sprint-unfiltered` names
  // which KINDS the sprint filter never saw rather than counting exempt rows.
  // This is a real coverage loss from the old control-level total — reported
  // in this branch's PR rather than guessed at here. The two tests that only
  // asserted the removed attributes are gone; `marks the exempt rows and not
  // the member row` and `hides no row the exemption showed before` above
  // still cover the underlying exempt/hidden behaviour through DOM marks.

  it('does not count an ownership-hidden row under Sprint only', async () => {
    const page = await open();
    try {
      const mineChip = page.locator('[data-chip^="Mine"]');
      await mineChip.click();
      await expect.poll(async () => (await branches(page)).includes(MEMBER_THEIRS)).toBe(false);
      await sprintOnly(page);
      const text = (await header(page).textContent()) ?? '';
      // Sprint hid ELSEWHERE and LOOSE; ownership hid MEMBER_THEIRS. Only the
      // first two belong to this suffix.
      expect(text).toContain('2 hidden by Sprint only');
      // THE CHIP'S OWN HIDDEN COUNT, not `data-mine-hidden` — that attribute
      // lived on the checkbox this rewrite removed and has no dedicated
      // attribute equivalent; `chip.hiddenCount` is rendered only as text
      // inside the button (`DeliveryFilters.tsx`'s `ChipView`).
      expect(await mineChip.textContent()).toContain('1 hidden');
    } finally {
      await page.close();
    }
  });

  it('says which of the section tally the sprint filter never saw', async () => {
    const page = await open();
    try {
      expect(await page.locator('[data-sprint-unfiltered]').count()).toBe(0);
      await sprintOnly(page);
      const note = page.locator('[data-sprint-unfiltered]');
      await expect.poll(() => note.getAttribute('data-sprint-unfiltered')).toBe('1');
      expect(await note.textContent()).toContain('not sprint-filtered');
    } finally {
      await page.close();
    }
  });
});
