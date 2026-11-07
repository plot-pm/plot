import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import type { TicketLaneGroups, TicketLaneRow } from '../../src/contract/schema.js';
import { withTicketFacts } from '../catalogue/ticket-lanes.js';

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
        // `issueAnswer` here, and NOT on the `fleet` stub below, is the point of
        // this scenario: Discovery reads `/api/board`, never a Delivery-tab-only
        // fleet poll, so an `unsupported` fleet must not leave the buttons refused.
        board: buildBoard({
          tickets: withTicketFacts(TICKETS),
          idea: { available: true, reason: '' },
          story: { available: true, reason: '' },
          issueAnswer: 'answered',
        }),
        fleet: buildFleet({ issueAnswer: 'unsupported' }),
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

  const card = (page: Page, id: string) => page.locator(`#ticket-${id}`);

  it('shows the shorthand-prefixed title, a state pill and its opened age on an Open ticket', async () => {
    const page = await open();
    try {
      await expect.poll(() => card(page, '1688').count(), { timeout: 10_000 }).toBe(1);
      expect((await card(page, '1688').textContent())?.replace(/\s+/g, ' ').trim()).toContain(
        '1688: The Jira project scope: ship the connector',
      );
      expect(await card(page, '1688').locator('[data-state-pill]').count()).toBeGreaterThan(0);
      // The age names its event; the `owner/repo#N` reference shows in the modal, not on the card.
      expect(await card(page, '1688').locator('[data-since="opened"]').count()).toBe(1);
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

  it('does not disable Create plan or Create story on a fresh load — the Discovery tab never polled the fleet', async () => {
    const page = await open();
    try {
      await expect.poll(() => card(page, '1688').count(), { timeout: 10_000 }).toBe(1);
      await expect.poll(() => card(page, '1688').locator('[data-create-plan="1688"]').count()).toBe(1);
      await expect.poll(() => card(page, '1688').locator('[data-create-story="1688"]').count()).toBe(1);
      expect(await card(page, '1688').locator('[data-create-plan="1688"]').getAttribute('aria-disabled')).toBeNull();
      expect(await card(page, '1688').locator('[data-create-story="1688"]').getAttribute('aria-disabled')).toBeNull();
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

  it('offers no action on a Done ticket, and shows its state', async () => {
    const page = await open();
    try {
      await expect.poll(() => card(page, '1685').count(), { timeout: 10_000 }).toBe(1);
      expect(await card(page, '1685').locator('[data-create-plan]').count()).toBe(0);
      expect(await card(page, '1685').locator('[data-create-story]').count()).toBe(0);
      expect(await card(page, '1685').locator('[data-state-pill]').count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });
});
