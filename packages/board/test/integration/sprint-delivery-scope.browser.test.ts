import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, board as buildBoard, type Catalogue } from '../catalogue/index.js';
import { type Fleet, type FleetSprint, type Slice } from '../../src/contract/schema.js';

/**
 * THE MY SPRINT CHIP RENAMES AND NARROWS THE DELIVERY SECTION.
 *
 * Chip off: `Release delivery`, every plan. Chip on: `Sprint delivery · <title>`
 * and only the owned sprint's plans. The titles and plan lists are decided in
 * `sprint-delivery.ts`; this test proves the page shows them.
 */
const ME = 'gardener';

const sprint = (slug: string, title: string, owner: string, members: string[]): FleetSprint => ({
  slug, title, release: '', timebox: 'none', timeboxLabel: '', ownerHandle: owner,
  counts: { total: members.length, open: 0, wip: 0, done: members.length, withdrawn: 0 },
  members: members.map((m) => ({ slug: m, text: '', tier: 'must', checked: false, known: true })),
} as unknown as FleetSprint);

const mergedSlice = (plan: string): Slice => ({
  plan, name: 'a', branches: [], verdict: 'complete', section: 'done', complete: true, planSliceCount: 1, merge: 'merged',
}) as unknown as Slice;

const fleet = (): Fleet => ({
  generatedAt: new Date().toISOString(),
  ageSeconds: 1, ready: true, error: null, rows: [],
  slices: [mergedSlice('plan-mine'), mergedSlice('plan-theirs')],
  sprints: [sprint('mine', 'My Sprint', ME, ['plan-mine']), sprint('theirs', 'Their Sprint', 'someone', ['plan-theirs'])],
  issues: [], issueAnswer: 'answered', issueError: null,
  summary: { plans: 2, waves: 2, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
  prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
}) as unknown as Fleet;

describe('the My sprint chip over the Delivery section', () => {
  let cat: Catalogue;
  beforeAll(async () => { cat = await openCatalogue(); }, 60_000);
  afterAll(async () => { await cat?.close(); });

  it('renames the section and lists only the owned sprint plans', async () => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: {
        fleet: fleet(),
        board: buildBoard({ server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME, people: { [ME]: ME } } }),
      },
    });
    const title = page.locator('[data-delivery-section="release-delivery"]');
    await title.waitFor({ timeout: 15_000 });
    expect(await title.textContent()).toContain('Release delivery');
    expect(await page.locator('[data-plan-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-plan-row')).sort()))
      .toEqual(['plan-mine', 'plan-theirs']);

    await page.locator('[data-chip="My sprint"]').click();
    await expect.poll(async () => (await title.textContent()) ?? '', { timeout: 10_000 }).toContain('Sprint delivery · My Sprint');
    expect(await page.locator('[data-plan-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-plan-row'))))
      .toEqual(['plan-mine']);

    await page.locator('[data-chip="My sprint"]').click();
    await expect.poll(async () => (await title.textContent()) ?? '', { timeout: 10_000 }).toContain('Release delivery');
  }, 60_000);
});
