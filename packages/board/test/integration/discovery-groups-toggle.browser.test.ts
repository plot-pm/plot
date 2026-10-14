import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, fleet as buildFleet, story as buildStory, type Catalogue } from '../catalogue/index.js';
import type { TicketLaneGroups, TicketLaneRow } from '../../src/contract/schema.js';

/**
 * THE DISCOVERY GROUPS HAVE A TOGGLE — the browser half. What each group shows
 * and counts is asserted in `packages/domain/test/discovery-groups.test.ts`;
 * this proves the shipped artifact renders the headings and the control, keeps
 * `?show=` in the address, and keeps it next to `?archived=1`.
 */
const ticketRow = (id: string, over: Partial<TicketLaneRow> = {}): TicketLaneRow => ({
  id,
  title: `Ticket ${id}`,
  url: `https://github.com/plot-pm/plot/issues/${id}`,
  createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  body: null,
  status: 'Open',
  statusCategory: 'To Do',
  closedAt: null,
  ...over,
});

// 2 open + 1 in progress + 7 done: ten rows, seven of them in Done behind *Show all done*.
const TICKETS: TicketLaneGroups = {
  open: [ticketRow('1688'), ticketRow('1689')],
  'in-progress': [ticketRow('1690', { statusCategory: 'In Progress' })],
  done: Array.from({ length: 7 }, (_, i) => ticketRow(`17${i}`, { status: 'Closed', statusCategory: 'Done' })),
  moreCount: 0,
};

// 2 active + 6 done: eight stories, six in Done behind *Show all done*.
const STORY_LANES = [
  { lane: 'Active' as const, stories: [buildStory({ slug: 'berry', title: 'Berry story' }), buildStory({ slug: 'plum', title: 'Plum story' })] },
  {
    lane: 'Done' as const,
    stories: Array.from({ length: 6 }, (_, i) => buildStory({ slug: `done-${i}`, title: `Done story ${i}`, status: 'done' })),
  },
];

const TOPICS = [{ topic: 'berry', score: 1, count: 2, storySlugs: ['berry'], ticketKeys: ['1688'] }];

describe('the Discovery groups have a toggle', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  // A page opened on `?tab=discovery`, then sent to `extra` as a fresh load.
  const open = async (extra = ''): Promise<Page> => {
    const page = await openPlain();
    if (extra) await page.goto(`${page.url().split('?')[0]}?tab=discovery&${extra.replace(/^\?/, '')}`);
    return page;
  };
  const openPlain = async (): Promise<Page> =>
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

  const group = (page: Page, which: 'tickets' | 'stories') => page.locator(`[data-discovery-group="${which}"]`);
  const choose = (page: Page, name: string) => page.getByRole('group', { name: 'Show' }).getByRole('button', { name }).click();
  const search = (page: Page) => page.evaluate(() => location.search);
  const archived = (page: Page) => page.getByLabel('Show archived');

  it('puts a count over each group that holds every row, and does not move when Show all done opens', async () => {
    const page = await open();
    try {
      await expect.poll(() => group(page, 'tickets').count(), { timeout: 10_000 }).toBe(1);
      expect(await group(page, 'tickets').innerText()).toBe('Tickets (10)');
      expect(await group(page, 'stories').innerText()).toBe('Stories (8)');
      await page.getByRole('button', { name: /^Show all done/ }).first().click();
      await page.getByRole('button', { name: /^Show all done/ }).first().click();
      expect(await group(page, 'tickets').innerText()).toBe('Tickets (10)');
      expect(await group(page, 'stories').innerText()).toBe('Stories (8)');
    } finally {
      await page.close();
    }
  });

  it('counts the rows a selected topic keeps', async () => {
    const page = await open();
    try {
      await expect.poll(() => group(page, 'tickets').count(), { timeout: 10_000 }).toBe(1);
      await page.getByRole('button', { name: /^berry/ }).click();
      await expect.poll(() => group(page, 'tickets').innerText()).toBe('Tickets (1)');
      expect(await group(page, 'stories').innerText()).toBe('Stories (1)');
    } finally {
      await page.close();
    }
  });

  it('switches through all three options and writes ?show= for two of them', async () => {
    const page = await open();
    try {
      await expect.poll(() => group(page, 'tickets').count(), { timeout: 10_000 }).toBe(1);
      await choose(page, 'Tickets');
      await expect.poll(() => group(page, 'stories').count()).toBe(0);
      expect(await group(page, 'tickets').count()).toBe(1);
      expect(await search(page)).toBe('?tab=discovery&show=tickets');
      await choose(page, 'Stories');
      await expect.poll(() => group(page, 'tickets').count()).toBe(0);
      expect(await group(page, 'stories').count()).toBe(1);
      expect(await search(page)).toBe('?tab=discovery&show=stories');
      await choose(page, 'Both');
      await expect.poll(() => group(page, 'tickets').count()).toBe(1);
      expect(await group(page, 'stories').count()).toBe(1);
      expect(await search(page)).toBe('?tab=discovery');
    } finally {
      await page.close();
    }
  });

  it('counts only the groups on screen in the tag cloud', async () => {
    const page = await open();
    try {
      await expect.poll(() => group(page, 'tickets').count(), { timeout: 10_000 }).toBe(1);
      const chip = page.getByRole('button', { name: /^berry/ });
      expect(await chip.innerText()).toContain('2');
      await choose(page, 'Tickets');
      await expect.poll(async () => (await chip.innerText()).replace(/\D/g, '')).toBe('1');
    } finally {
      await page.close();
    }
  });

  it('reads ?show= on a reload and treats an unknown value as Both', async () => {
    const stories = await open('?show=stories');
    try {
      await expect.poll(() => group(stories, 'stories').count(), { timeout: 10_000 }).toBe(1);
      expect(await group(stories, 'tickets').count()).toBe(0);
      expect(await stories.getByRole('button', { name: 'Stories', exact: true }).getAttribute('aria-pressed')).toBe('true');
    } finally {
      await stories.close();
    }
    const unknown = await open('?show=all');
    try {
      await expect.poll(() => group(unknown, 'tickets').count(), { timeout: 10_000 }).toBe(1);
      expect(await group(unknown, 'stories').count()).toBe(1);
    } finally {
      await unknown.close();
    }
  });

  it('keeps ?show=stories through Show archived off, and Both keeps archived', async () => {
    const page = await open('?show=stories&archived=1');
    try {
      await expect.poll(() => group(page, 'stories').count(), { timeout: 10_000 }).toBe(1);
      await archived(page).uncheck();
      await expect.poll(() => search(page)).toBe('?tab=discovery&show=stories');
      expect(await group(page, 'tickets').count()).toBe(0);
      await archived(page).check();
      await expect.poll(() => search(page)).toContain('show=stories');
      expect(await search(page)).toContain('archived=1');
      await choose(page, 'Both');
      await expect.poll(() => search(page)).not.toContain('show=');
      expect(await search(page)).toContain('archived=1');
    } finally {
      await page.close();
    }
  });
});
