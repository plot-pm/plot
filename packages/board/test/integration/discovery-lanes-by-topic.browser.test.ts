import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, fleet as buildFleet, story as buildStory, type Catalogue } from '../catalogue/index.js';
import type { TicketLaneGroups, TicketLaneRow } from '../../src/contract/schema.js';

/**
 * THE LANES FILTER BY TOPIC — the browser half. The rows a topic keeps are
 * asserted in `packages/domain/test/lanes-for-topic.test.ts`; this proves the
 * shipped artifact narrows both lane kinds, says so in an emptied lane, and
 * restores every row on Clear.
 */
const ticketRow = (over: Partial<TicketLaneRow> = {}): TicketLaneRow => ({
  id: '1688',
  title: 'The Jira project scope: ship the connector',
  url: 'https://github.com/plot-pm/plot/issues/1688',
  createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  body: null,
  status: 'Open',
  statusCategory: 'To Do',
  closedAt: null,
  ...over,
});

const TICKETS: TicketLaneGroups = {
  open: [ticketRow({ id: '1688', title: 'Matching ticket' }), ticketRow({ id: '1689', title: 'Unlisted ticket' })],
  'in-progress': [ticketRow({ id: '1690', title: 'Other ticket', statusCategory: 'In Progress' })],
  done: [],
  moreCount: 0,
};

const STORY_LANES = [
  {
    lane: 'Active' as const,
    stories: [buildStory({ slug: 'berry', title: 'Berry story' }), buildStory({ slug: 'plum', title: 'Plum story' })],
  },
  { lane: 'Draft' as const, stories: [buildStory({ slug: 'fig', title: 'Fig story', status: 'draft' })] },
];

const TOPICS = [
  { topic: 'berry', score: 1, count: 2, storySlugs: ['berry'], ticketKeys: ['1688'] },
  { topic: 'solo', score: 1, count: 1, storySlugs: ['plum'], ticketKeys: [] },
];

describe('the lanes filter by topic', () => {
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
          topics: TOPICS,
          idea: { available: true, reason: '' },
          story: { available: true, reason: '' },
        }),
        fleet: buildFleet({ issueAnswer: 'answered' }),
      },
      tab: 'discovery',
      viewport: { width: 1400, height: 1400 },
    });

  const tickets = (page: Page) => page.locator('[data-ticket-card]');
  const chip = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });
  const text = (page: Page) => page.locator('body').innerText();

  it('narrows a story lane and a ticket lane to the rows the topic names, and Clear restores both', async () => {
    const page = await open();
    try {
      await expect.poll(() => tickets(page).count(), { timeout: 10_000 }).toBe(3);
      await chip(page, 'berry').click();
      await expect.poll(() => tickets(page).count()).toBe(1);
      expect(await page.locator('[data-ticket-card="1688"]').count()).toBe(1);
      const shown = await text(page);
      expect(shown).toContain('Berry story');
      expect(shown).not.toContain('Plum story');
      expect(shown).not.toContain('Fig story');
      await page.getByRole('button', { name: 'Clear' }).click();
      await expect.poll(() => tickets(page).count()).toBe(3);
      const restored = await text(page);
      expect(restored).toContain('Plum story');
      expect(restored).toContain('Fig story');
    } finally {
      await page.close();
    }
  });

  it('says the topic hides a lane it emptied, and keeps the ordinary message for a lane that was empty', async () => {
    const page = await open();
    try {
      await expect.poll(() => tickets(page).count(), { timeout: 10_000 }).toBe(3);
      expect(await text(page)).toContain('No tickets in this lane.');
      expect(await text(page)).not.toContain('This topic hides');
      await chip(page, 'solo').click();
      await expect.poll(() => tickets(page).count()).toBe(0);
      const shown = await text(page);
      expect(shown.match(/This topic hides every ticket in this lane\./g)?.length).toBe(2);
      expect(shown).toContain('No tickets in this lane.');
      expect(shown).toContain('This topic hides every story in this lane.');
    } finally {
      await page.close();
    }
  });
});
