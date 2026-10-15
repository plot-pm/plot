import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, fleet as buildFleet, story as buildStory, type Catalogue } from '../catalogue/index.js';
import type { TicketLaneGroups, TicketLaneRow } from '../../src/contract/schema.js';

/**
 * DISCOVERY FILTERS TO MY WORK — the checkbox, widened from Planning onto the
 * Discovery tab (`discovery-filters-to-only-my-work`).
 *
 * Mixed ownership, the lesson `mine-filter.browser.test.ts` states at length: a
 * fixture that is all-mine cannot distinguish a working filter from one that
 * hides nothing. One story and one ticket are the reader's, one of each is a
 * colleague's, and one of each names nobody — the last pair must survive both
 * arms, same as an unclaimed branch row does on the Planning tab.
 */
const ME = 'gardener';
const THEM = 'neighbour';

const ticketRow = (over: Partial<TicketLaneRow> = {}): TicketLaneRow => ({
  id: '1',
  title: 'A ticket',
  url: 'https://github.com/plot-pm/plot/issues/1',
  createdAt: null,
  body: null,
  status: 'Open',
  statusCategory: 'To Do',
  closedAt: null,
  ...over,
});

const TICKETS: TicketLaneGroups = {
  open: [
    ticketRow({ id: '1', title: 'My ticket', owner: ME }),
    ticketRow({ id: '2', title: 'Their ticket', owner: THEM }),
    ticketRow({ id: '3', title: 'Nobodys ticket', owner: null }),
  ],
  'in-progress': [],
  done: [],
  moreCount: 0,
};

const STORY_LANES = [
  {
    lane: 'Active' as const,
    stories: [
      buildStory({ slug: 'mine', title: 'My story', author: ME }),
      buildStory({ slug: 'theirs', title: 'Their story', author: THEM }),
      buildStory({ slug: 'nobodys', title: 'Nobodys story', author: '' }),
    ],
  },
];

describe('the discovery tab filters to my work', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (): Promise<Page> =>
    cat.open('an-empty-estate', {
      over: {
        board: buildBoard({
          tickets: TICKETS,
          storyLanes: STORY_LANES,
          idea: { available: true, reason: '' },
          story: { available: true, reason: '' },
          server: {
            restartCommand: 'pnpm board',
            port: 4711,
            branch: 'main',
            repo: 'garden',
            hostUser: ME,
            people: { [ME]: ME, [THEM]: THEM },
          },
        }),
        fleet: buildFleet({ issueAnswer: 'answered' }),
      },
      tab: 'discovery',
      viewport: { width: 1400, height: 1400 },
    });

  const text = (page: Page) => page.locator('body').innerText();
  const toggle = (page: Page) => page.locator('[data-mine-toggle]');

  it('starts off, showing every story and ticket', async () => {
    const page = await open();
    try {
      await expect.poll(() => page.locator('[data-ticket-card]').count(), { timeout: 10_000 }).toBe(3);
      await expect.poll(() => toggle(page).isChecked()).toBe(false);
      const shown = await text(page);
      for (const t of ['My story', 'Their story', 'Nobodys story']) expect(shown).toContain(t);
      for (const t of ['My ticket', 'Their ticket', 'Nobodys ticket']) expect(shown).toContain(t);
    } finally {
      await page.close();
    }
  });

  it('hides only the colleague\'s story and ticket when checked, and restores both on uncheck', async () => {
    const page = await open();
    try {
      await expect.poll(() => page.locator('[data-ticket-card]').count(), { timeout: 10_000 }).toBe(3);

      await toggle(page).check();
      await expect.poll(async () => (await text(page)).includes('Their story')).toBe(false);
      let shown = await text(page);
      expect(shown).not.toContain('Their ticket');
      expect(shown).toContain('My story');
      expect(shown).toContain('My ticket');
      // A ROW NAMING NOBODY STAYS — the rule cannot place it, so it is kept.
      expect(shown).toContain('Nobodys story');
      expect(shown).toContain('Nobodys ticket');

      await toggle(page).uncheck();
      await expect.poll(async () => (await text(page)).includes('Their story')).toBe(true);
      shown = await text(page);
      expect(shown).toContain('Their ticket');
    } finally {
      await page.close();
    }
  });
});
