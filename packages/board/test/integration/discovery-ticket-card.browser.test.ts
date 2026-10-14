import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import type { TicketLaneGroups, TicketLaneRow } from '../../src/contract/schema.js';

/**
 * THE DISCOVERY TICKET CARD SHOWS ITS NUMBER, STATE AND AGE — the browser half.
 * The card's text and action-visibility rules are asserted in
 * `test/ticket-card.test.ts`; this proves the shipped artifact renders the
 * card and wires the two actions on an Open and an In progress row, and
 * offers neither on a Done row.
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
  open: [ticketRow({ id: '1688' })],
  'in-progress': [ticketRow({ id: '1690', title: 'The lanes filter by topic', statusCategory: 'In Progress' })],
  done: [
    ticketRow({
      id: '1685',
      title: 'The board artifact is built',
      statusCategory: 'Done',
      closedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  ],
  moreCount: 0,
};

describe('the Discovery ticket card shows its number, state and age', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      over: {
        board: buildBoard({
          tickets: TICKETS,
          idea: { available: true, reason: '' },
          story: { available: true, reason: '' },
        }),
        fleet: buildFleet({ issueAnswer: 'answered' }),
      },
      tab: 'discovery',
      viewport: { width: 1400, height: 1400 },
    });
    await page.route('**/api/idea', (route) =>
      route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, number: 1688 }) }));
    await page.route('**/api/idea/*', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'running', message: '', log: '' }) }));
    await page.route('**/api/story', (route) =>
      route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, number: 1688 }) }));
    await page.route('**/api/story/*', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'running', message: '', log: '' }) }));
    return page;
  };

  const card = (page: Page, id: string) => page.locator(`[data-ticket-card="${id}"]`);

  it('shows the icon, the shorthand-prefixed title and the reference-and-age line on an Open ticket', async () => {
    const page = await open();
    try {
      await expect.poll(() => card(page, '1688').count(), { timeout: 10_000 }).toBe(1);
      expect((await card(page, '1688').textContent())?.replace(/\s+/g, ' ').trim()).toContain(
        '1688: The Jira project scope: ship the connector',
      );
      expect(await card(page, '1688').locator('[data-ticket-card-icon="open"]').count()).toBe(1);
      const subtitle = await card(page, '1688').locator('p').textContent();
      expect(subtitle).toContain('plot-pm/plot#1688');
      expect(subtitle).toContain('opened');
    } finally {
      await page.close();
    }
  });

  it('offers Create plan and Create story on an Open ticket', async () => {
    const page = await open();
    try {
      await expect.poll(() => card(page, '1688').count(), { timeout: 10_000 }).toBe(1);
      await expect.poll(() => card(page, '1688').locator('[data-create-plan]').count()).toBe(1);
      await expect.poll(() => card(page, '1688').locator('[data-create-story]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers both actions on an In progress ticket too', async () => {
    const page = await open();
    try {
      await expect.poll(() => card(page, '1690').count(), { timeout: 10_000 }).toBe(1);
      await expect.poll(() => card(page, '1690').locator('[data-create-plan]').count()).toBe(1);
      await expect.poll(() => card(page, '1690').locator('[data-create-story]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers no action on a Done ticket, and shows the closed icon', async () => {
    const page = await open();
    try {
      await expect.poll(() => card(page, '1685').count(), { timeout: 10_000 }).toBe(1);
      expect(await card(page, '1685').locator('[data-create-plan]').count()).toBe(0);
      expect(await card(page, '1685').locator('[data-create-story]').count()).toBe(0);
      expect(await card(page, '1685').locator('[data-ticket-card-icon="closed"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});
