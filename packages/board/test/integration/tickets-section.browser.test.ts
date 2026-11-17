import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, board as buildBoard, fleet as buildFleet, scenario, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * The Tickets section: header, five rows, a fold and the show all control, as the shipped artifact renders them.
 * Counts and labels are asserted in `tickets-section.test.ts`; this proves they reach the screen and that the folds are keyboard-operable buttons.
 */
const ME = 'gardener';
const THEM = 'neighbour';
const source = { service: 'github', match: 'host-login' as const };

const ticket = (number: number, title: string, assignees: string[], extra: Record<string, unknown> = {}) => ({
  kind: 'ticket' as const, number: String(number), title, url: '', ageMinutes: number,
  status: 'open', statusCategory: 'To Do', assignees, ...extra,
});

describe('the Tickets section (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const six = Array.from({ length: 6 }, (_, i) => ticket(i + 1, `Mine ${i + 1}`, [ME]));
  const others = [ticket(601, 'Nobody\'s ticket', []), ticket(602, 'Neighbour\'s ticket', [THEM])];

  const open = async () => {
    const { agents: _a, summary: _s, ...envelope } = scenario('ten-rows-one-kind-each').fleet;
    const fleet = buildFleet({
      ...envelope,
      issueAnswer: 'answered',
      issues: [...six, ...others],
      waiting: { tickets: six, shown: 6, hidden: 2, unassigned: 1, assignedToOthers: 1, complete: true, notice: null, source },
    } as unknown as Partial<Fleet>);
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: {
        fleet,
        board: buildBoard({
          server: {
            restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME,
            people: { [ME]: ME, [THEM]: THEM },
          },
        }),
      },
    });
    await page.locator('section#tickets').waitFor({ timeout: 15_000 });
    return page;
  };

  it('shows the header, five of six rows and a fold that opens the sixth', async () => {
    const page = await open();
    try {
      const section = page.locator('section#tickets');
      await expect.poll(() => section.locator('[data-tickets-header]').innerText())
        .toContain('6 assigned to you with no plan');
      await expect.poll(() => section.locator('li[data-issue-row]').count()).toBe(5);
      const fold = section.locator('button[data-tickets-fold]');
      await expect.poll(() => fold.innerText()).toBe('… 1 more · show');
      await expect.poll(() => fold.getAttribute('aria-expanded')).toBe('false');
      await fold.click();
      await expect.poll(() => section.locator('li[data-issue-row]').count()).toBe(6);
      await expect.poll(() => fold.getAttribute('aria-expanded')).toBe('true');
    } finally {
      await page.close();
    }
  }, 60_000);

  it.each(['Enter', 'Space'])('both fold buttons answer %s and flip aria-expanded', async (key) => {
    const page = await open();
    try {
      const section = page.locator('section#tickets');
      const keyName = key === 'Space' ? ' ' : 'Enter';
      const showAll = section.locator('button[data-tickets-show-all]');
      await showAll.focus();
      await page.keyboard.press(keyName);
      await expect.poll(() => showAll.getAttribute('aria-expanded')).toBe('true');
      const fold = section.locator('button[data-tickets-fold]');
      await fold.focus();
      await page.keyboard.press(keyName);
      await expect.poll(() => fold.getAttribute('aria-expanded')).toBe('true');
      await page.keyboard.press(keyName);
      await expect.poll(() => fold.getAttribute('aria-expanded')).toBe('false');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('keeps another reader\'s ticket behind show all', async () => {
    const page = await open();
    try {
      const section = page.locator('section#tickets');
      await section.locator('button[data-tickets-fold]').click();
      expect(await section.locator('[data-issue-row="602"]').count()).toBe(0);
      await section.locator('button[data-tickets-show-all]').click();
      await expect.poll(() => section.locator('[data-issue-row="602"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);
});
