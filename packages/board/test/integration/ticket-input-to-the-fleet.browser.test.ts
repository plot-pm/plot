import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, board as buildBoard, expandAgentFolds, fleet as buildFleet, scenario, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * A ticket assigned to the reader that no plan names is SEEN in You › Input to the fleet.
 * The placement rule is asserted in `delivery-placement.test.ts`; this proves the
 * shipped artifact renders it, and that a planned ticket does not render there.
 */
const ME = 'gardener';
const THEM = 'neighbour';
const source = { service: 'github', match: 'host-login' as const };

const ticket = (number: number, title: string, assignees: string[], extra: Record<string, unknown> = {}) => ({
  kind: 'ticket' as const, number: String(number), title, url: '', ageMinutes: number,
  status: 'open', statusCategory: 'To Do', assignees, ...extra,
});

describe('a ticket reaches Input to the fleet (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const withTickets = (): Fleet => {
    const { agents: _a, summary: _s, ...envelope } = scenario('ten-rows-one-kind-each').fleet;
    const tickets = [
      ticket(501, 'Mine and unplanned', [ME]),
      ticket(502, 'Mine but planned', [ME], { planned: true }),
      ticket(503, 'Someone else\'s', [THEM]),
    ];
    return buildFleet({
      ...envelope,
      issueAnswer: 'answered',
      issues: tickets,
      waiting: { tickets, shown: 3, hidden: 0, complete: true, notice: null, source },
    } as unknown as Partial<Fleet>);
  };

  it('places an unplanned assigned ticket and leaves the planned and the foreign one out', async () => {
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: {
        fleet: withTickets(),
        board: buildBoard({
          server: {
            restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME,
            people: { [ME]: ME, [THEM]: THEM },
          },
        }),
      },
    });
    try {
      await page.locator('[data-delivery-section="you"]').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const section = page.locator('[data-group="input-to-the-fleet"]');
      await section.locator('[data-issue-row="501"]').waitFor({ timeout: 10_000 });
      expect(await section.locator('[data-issue-row="502"]').count()).toBe(0);
      expect(await section.locator('[data-issue-row="503"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
