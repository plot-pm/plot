import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, expandAgentFolds, type Catalogue } from '../catalogue/index.js';
import { type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * THE BOARD FILTERS TO MY WORK — the checkbox, measured in a browser.
 *
 * Both arms, because **a filter that hides nothing looks identical to one that
 * works** on a single-contributor estate — #967's own finding, and the reason
 * the fixture below has MIXED ownership rather than a plausible one. An
 * implementation that ticked the box and did nothing would pass every assertion
 * about the control existing, so each is asserted from both sides: what the
 * filter removed, and that unticking brings back every row it removed.
 *
 * The identity is stated on the BOARD payload, where the server carries it. A
 * fixture that left it empty would be testing the unconfigured case while
 * looking like it tested the filter.
 */
const ME = 'gardener';
const THEM = 'neighbour';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you', ageMinutes: 10,
  waitingOn: 'you', note: 'PR green', pr: null, branchUrl: '', waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, repair: null, deferredReason: '',
  ...over,
} as unknown as AgentRow);

/** A row with a PR somebody authored — the only reading that names an owner. */
const authored = (branch: string, author: string, number: number): AgentRow =>
  row({
    branch,
    pr: { number, url: `https://github.com/tiny/garden/pull/${number}`, draft: false, state: 'green', author },
  } as Partial<AgentRow>);

/**
 * FOUR ROWS, THREE KINDS OF OWNERSHIP. The mix is the fixture's whole point:
 *
 *   `feature/mine`        my PR — kept by both arms
 *   `feature/theirs`      somebody else's PR — the ONLY row the filter hides
 *   `feature/nobodys`     no PR at all, so no owner — kept, and the row a
 *                         filter written as "keep what matches me" would drop
 *   `feature/unsigned`    a PR whose author the host never answered (`''`) —
 *                         kept, because a missing reading is not a claim
 */
const MINE = 'feature/mine';
const THEIRS = 'feature/theirs';
const NOBODYS = 'feature/nobodys';
const UNSIGNED = 'feature/unsigned';

function fleet(): Fleet {
  const rows: AgentRow[] = [
    authored(MINE, ME, 11),
    authored(THEIRS, THEM, 12),
    row({ branch: NOBODYS, pr: null }),
    authored(UNSIGNED, '', 14),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    issues: [], issueAnswer: 'answered', issueError: null,
    summary: { plans: 1, waves: 1, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
}

describe('the board filters to my work', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  /**
   * @param hostUser - who the board says is reading. Empty is the honest
   *   "not configured" answer and is a case of its own below.
   */
  async function open(hostUser = ME): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: {
        fleet: fleet(),
        // THE IDENTITY IS PART OF THE STATE, the rule the catalogue states for
        // capabilities. A board that names nobody cannot filter, so a fixture
        // that omitted this would measure the unconfigured case by accident.
        board: buildBoard({
          server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser },
        }),
      },
    });
    await page.getByText('Waiting on you').first().waitFor({ timeout: 15_000 });
    await reveal(page);
    return page;
  }

  /**
   * Open the section and every fold inside it.
   *
   * The FOLD is not this test's subject, and the fixture deliberately sits in a
   * section that starts open — but `COLLAPSED_BY_DEFAULT` is a preference that
   * has moved before, and a filter test that silently measured a folded section
   * would report the filter hiding rows the fold had taken.
   */
  async function reveal(page: Page): Promise<void> {
    const toggle = page.locator('[data-group-toggle="waiting-on-you"]');
    if (await toggle.count() > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click();
    }
    await expandAgentFolds(page);
  }

  /** Which branches are on screen, by the attribute every row carries. */
  const branches = async (page: Page): Promise<string[]> =>
    page.locator('[data-branch]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-branch') ?? '').filter(Boolean));

  const checkbox = (page: Page) => page.locator('[data-mine-toggle]');

  it('starts OFF, showing every row', async () => {
    const page = await open();
    try {
      // A FIRST VISIT SHOWS EVERYTHING. Hiding rows from a reader who never
      // asked is a board that lies by omission — and the asymmetry with the
      // section fold, which DOES default to hiding, is deliberate.
      await expect.poll(() => checkbox(page).isChecked()).toBe(false);
      const shown = await branches(page);
      for (const b of [MINE, THEIRS, NOBODYS, UNSIGNED]) expect(shown).toContain(b);
    } finally {
      await page.close();
    }
  });

  it('hides the rows isMine returned false for, and only those', async () => {
    const page = await open();
    try {
      const before = await branches(page);
      expect(before).toContain(THEIRS);

      await checkbox(page).check();
      await expect.poll(async () => (await branches(page)).includes(THEIRS)).toBe(false);

      const after = await branches(page);
      // THE ONE ROW SOMEBODY ELSE OWNS IS GONE.
      expect(after).not.toContain(THEIRS);
      // AND THE OTHER THREE ARE NOT. A row with no owner and a row whose author
      // the host never answered both stay: `isMine` answers false only for a row
      // that is somebody else's, never for one it cannot place. An implementation
      // keeping "only what matches me" passes the assertion above and fails here.
      expect(after).toContain(MINE);
      expect(after).toContain(NOBODYS);
      expect(after).toContain(UNSIGNED);
    } finally {
      await page.close();
    }
  });

  it('restores EVERY row when unticked — including the rows that were nobody\'s', async () => {
    const page = await open();
    try {
      const before = (await branches(page)).sort();
      await checkbox(page).check();
      await expect.poll(async () => (await branches(page)).includes(THEIRS)).toBe(false);

      await checkbox(page).uncheck();
      await expect.poll(async () => (await branches(page)).includes(THEIRS)).toBe(true);
      // THE FULL SET, compared against what was on screen before the filter ran
      // rather than against a list written here: a test naming its own expected
      // rows would pass while the filter quietly dropped a row the fixture gained.
      expect((await branches(page)).sort()).toEqual(before);
    } finally {
      await page.close();
    }
  });

  it('remembers the choice across a reload, and keeps it out of the URL', async () => {
    const page = await open();
    try {
      const url = page.url();
      await checkbox(page).check();
      await expect.poll(async () => (await branches(page)).includes(THEIRS)).toBe(false);

      // NOT IN THE QUERY STRING. A link that silently hid rows belonging to
      // whoever opened it is worse than a link that remembers nothing.
      expect(page.url()).toBe(url);

      await page.reload();
      await page.getByText('Waiting on you').first().waitFor({ timeout: 15_000 });
      await reveal(page);
      await expect.poll(() => checkbox(page).isChecked()).toBe(true);
      // AND IT IS STILL FILTERING after the reload — a checkbox that came back
      // ticked over an unfiltered list would be the state restored and the
      // filter not applied.
      expect(await branches(page)).not.toContain(THEIRS);
    } finally {
      await page.close();
    }
  });

  it('renders the default view when localStorage cannot be read', async () => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: {
        fleet: fleet(),
        board: buildBoard({
          server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME },
        }),
      },
    });
    try {
      // `localStorage` THROWS ON ACCESS in a blocked-cookie context, which is
      // not the same as returning null. A board that rendered nothing because it
      // could not remember a checkbox is the worse answer, so the failure path
      // yields the default — off, showing everything.
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() { throw new Error('access denied'); },
        });
      });
      await page.reload();
      await page.getByText('Waiting on you').first().waitFor({ timeout: 15_000 });
      await reveal(page);

      await expect.poll(() => checkbox(page).isChecked()).toBe(false);
      const shown = await branches(page);
      for (const b of [MINE, THEIRS, NOBODYS, UNSIGNED]) expect(shown).toContain(b);
    } finally {
      await page.close();
    }
  });

  it('hides nothing when the board names no reader', async () => {
    const page = await open('');
    try {
      // THE WHOLE-BOARD FAILURE, asserted. `''` is the honest "not configured"
      // value — an unreadable `hosts.yml`, every Bitbucket repository — and a
      // filter treating it as matching nothing would empty the view for those
      // readers entirely.
      await checkbox(page).check();
      await expect.poll(() => checkbox(page).isChecked()).toBe(true);
      const shown = await branches(page);
      for (const b of [MINE, THEIRS, NOBODYS, UNSIGNED]) expect(shown).toContain(b);
      // AND IT SAYS WHY it can do nothing, rather than ticking and changing
      // nothing — which reads as a broken filter.
      await expect.poll(() => page.locator('[data-mine-filter][data-mine-known="0"]').count())
        .toBe(1);
    } finally {
      await page.close();
    }
  });
});
