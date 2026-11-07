import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page, type Request } from 'playwright';
import { openCatalogue, board, fleet, story, type Catalogue } from '../catalogue/index.js';
import type { StoryCard, TicketLaneGroups } from '../../src/contract/schema.js';

/**
 * A STORY CARD RENDERS THE CARD GRAMMAR — what only a rendered page can settle.
 *
 * `storyCardFacts` decides the facts and `presentCard` the words, both asserted
 * without a browser. This owns what a page states: the story card draws the
 * same three sections as a plan card, its ticket number links the ticket, a
 * long relation collapses to one count, *Add plan* posts the slug alone, and a
 * ticket a story answers offers no *Create story*.
 */
const ISSUES = 'https://github.com/plot-pm/plot/issues/';

/** The story #3170 names, with two plans in two sprints and a status behind them. */
const NOTHING_RUNS: StoryCard = story({
  slug: 'nothing-runs', title: 'Nothing changed, nothing runs', status: 'draft', author: 'jwloka', issue: '#3170',
  plans: [
    { slug: 'a', title: 'Plan A', phase: 'delivered', sprint: 's1' },
    { slug: 'b', title: 'Plan B', phase: 'delivered', sprint: 's2' },
  ],
});
// The builder reads `issue:` with no repository address; the server reads it with one.
const LINKED: StoryCard = {
  ...NOTHING_RUNS,
  facts: NOTHING_RUNS.facts && {
    ...NOTHING_RUNS.facts,
    identity: { ...NOTHING_RUNS.facts.identity, key: '3170' },
    lineage: { ...NOTHING_RUNS.facts.lineage, tickets: { value: [{ kind: 'ticket', key: '3170', title: '3170', lane: null }] } },
  },
};

/** A story with 62 plans across 9 sprints. */
const UMBRELLA: StoryCard = story({
  slug: 'umbrella', title: 'The umbrella', status: 'active',
  plans: Array.from({ length: 62 }, (_, i) => ({ slug: `p${i}`, title: `Plan ${i}`, phase: i < 60 ? 'delivered' : 'approved', sprint: `s${i % 9}` })),
});

/** A live story with no plans: Add plan is its primary. */
const BARE: StoryCard = story({ slug: 'bare', title: 'A story with no plans', status: 'draft' });

const TICKETS: TicketLaneGroups = {
  open: [{
    id: '3170', title: 'Nothing changed, nothing runs', url: `${ISSUES}3170`, createdAt: new Date().toISOString(),
    body: null, status: 'Open', statusCategory: 'To Do', closedAt: null,
  }],
  'in-progress': [],
  done: [],
  moreCount: 0,
};

describe('a story card renders the card grammar', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const open = async (route?: Record<string, (r: import('playwright').Route) => unknown>): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      ...(route ? { route } : {}),
      over: {
        board: board({
          stories: [LINKED, UMBRELLA, BARE],
          storyLanes: [{ lane: 'Draft', stories: [LINKED, BARE] }, { lane: 'Active', stories: [UMBRELLA] }],
          tickets: TICKETS,
          ticketStories: { value: { 3170: [{ kind: 'story', slug: 'nothing-runs', title: 'Nothing changed, nothing runs', status: 'draft', archived: false }] } },
          issueUrlBase: ISSUES,
          idea: { available: true, reason: '' },
          story: { available: true, reason: '' },
          issueAnswer: 'answered',
        }),
        fleet: fleet(),
      },
      tab: 'discovery',
      viewport: { width: 1400, height: 1400 },
    });
    await page.locator('#story-nothing-runs').waitFor({ timeout: 10_000 });
    return page;
  };

  it('draws the three sections, leads with the story icon and the ticket number, and opens only from its title', async () => {
    const page = await open();
    try {
      const cardEl = page.locator('#story-nothing-runs');
      const order = await cardEl.locator('[data-section]').evaluateAll((els) =>
        els.map((el) => ({ section: el.getAttribute('data-section'), top: el.getBoundingClientRect().top }))
          .sort((a, b) => a.top - b.top).map((t) => t.section));
      expect(order).toEqual(['header', 'status', 'footer']);
      expect(await cardEl.locator('[data-section="header"] [data-kind-icon="story"]').getAttribute('aria-label')).toBe('Story');
      const number = cardEl.locator('[data-title-number]');
      expect(await number.innerText()).toMatch(/^#3170/);
      expect(await number.getAttribute('href')).toBe(`${ISSUES}3170`);
      expect(await cardEl.locator('[data-state-pill]').innerText()).toContain('Draft');
      expect(await cardEl.locator('[data-alert="status-behind"]').innerText()).toBe('status behind: plans delivered');
      expect(await cardEl.locator('[data-assignees]').getAttribute('aria-label')).toBe('@jwloka');
      // No whole-card button: the title is the card's only open control.
      expect(await page.locator('button:has(#story-nothing-runs), button #story-nothing-runs').count()).toBe(0);
      await cardEl.locator('[data-card-title]').click();
      await page.getByRole('dialog', { name: 'Story: Nothing changed, nothing runs' }).waitFor({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  it('collapses 62 plans and 9 sprints to one count each, at the height of a card with two', async () => {
    const page = await open();
    try {
      const umbrella = page.locator('#story-umbrella');
      expect(await umbrella.locator('[data-expander="lineage-plans"]').innerText()).toContain('62 plans');
      expect(await umbrella.locator('[data-expander="lineage-sprints"]').innerText()).toContain('9 sprints');
      expect(await umbrella.locator('[data-work-bar]').getAttribute('data-work-bar')).toBe('fill');
      const heights = await Promise.all(['#story-umbrella', '#story-nothing-runs'].map((id) =>
        page.locator(id).evaluate((el) => el.getBoundingClientRect().height)));
      expect(Math.abs(heights[0] - heights[1])).toBeLessThan(1);
      await umbrella.locator('[data-expander="lineage-plans"]').click();
      const list = page.getByRole('dialog', { name: '62 plans' });
      await list.waitFor({ timeout: 5_000 });
      expect(await list.locator('li').count()).toBe(62);
    } finally {
      await page.close();
    }
  });

  it('Add plan posts the story slug and nothing else', async () => {
    const posted: Request[] = [];
    const page = await open({
      '**/api/story-plan': (r) => {
        posted.push(r.request());
        return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, slug: 'bare' }) });
      },
      '**/api/story-plan/bare': (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'running', message: '', log: '' }) }),
    });
    try {
      const add = page.locator('#story-bare [data-action-slot="primary"] button');
      expect(await add.innerText()).toBe('Add plan');
      await add.click();
      expect(await add.innerText()).toBe('Add plan — Draft in bare?');
      await add.click();
      await expect.poll(() => posted.length, { timeout: 5_000 }).toBe(1);
      expect(posted[0].postDataJSON()).toEqual({ slug: 'bare' });
      // A story with plans offers Add plan as a secondary.
      expect(await page.locator('#story-nothing-runs [data-action-slot="secondary"] [data-add-plan]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('a ticket a story answers links that story and offers no Create story', async () => {
    const page = await open();
    try {
      const ticket = page.locator('[data-ticket-card="3170"]');
      await ticket.waitFor({ timeout: 5_000 });
      expect(await ticket.locator('[data-ticket-story="nothing-runs"]').innerText()).toBe('Story: Nothing changed, nothing runs');
      expect(await ticket.locator('[data-create-story]').count()).toBe(0);
      expect(await ticket.locator('[data-create-plan]').count()).toBe(1);
    } finally {
      await page.close();
    }
    // While the index is unknown, no ticket offers Create story and each says why.
    const unread = await cat.open('an-empty-estate', {
      over: {
        board: board({ tickets: TICKETS, ticketStories: { unknown: 'failed' }, idea: { available: true, reason: '' }, story: { available: true, reason: '' }, issueAnswer: 'answered' }),
        fleet: fleet(),
      },
      tab: 'discovery',
    });
    try {
      const ticket = unread.locator('[data-ticket-card="3170"]');
      await ticket.waitFor({ timeout: 10_000 });
      expect(await ticket.locator('[data-ticket-stories="unknown"]').innerText()).toBe('stories unknown');
      expect(await ticket.locator('[data-create-story]').count()).toBe(0);
    } finally {
      await unread.close();
    }
  });
});
