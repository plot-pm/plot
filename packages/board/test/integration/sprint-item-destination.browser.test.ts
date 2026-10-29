import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from 'playwright';
import { openCatalogue, board, card, column, fleet, sprint, story, type Catalogue } from '../catalogue/index.js';

/**
 * A SPRINT MEMBER WITH NO CARD RENDERS AS TEXT, NEVER A DEAD BUTTON.
 *
 * `sprintItemDestination` replaced `planFileFromFleet` as `SprintModal`'s
 * source of truth for whether a member is clickable (see
 * `packages/domain/src/rules/sprint-item-destination.ts`). The member this
 * file drives is `known: false` AND absent from `board.columns`' cards, which
 * is the one combination `sprintItemDestination` refuses regardless of
 * `known` — a stale slug the fallback it replaced could still have matched by
 * accident, because that fallback read the FLEET rather than the board's own
 * card set.
 *
 * `SprintModal` is reached through the SAME chain on both tabs: a story card's
 * sprint link opens it, by `slug`, looked up in `board.sprints`
 * (`App.tsx`'s `onOpenSprint`). Planning reaches the story through a plan
 * card's story badge (`PlanCard.tsx`) and `StoryModal`'s own sprint list;
 * Discovery shows the sprint list directly on the story card
 * (`StoriesTab.tsx`). Both end at the one `SprintModal` instance this file
 * asserts against.
 *
 * "Fresh and after a Delivery visit" is the plan's own regression shape for
 * this estate: a stale `/api/fleet` payload must not leak into a decision the
 * board itself can answer from its own cards.
 */
const SPRINT_SLUG = 'a-sprint';
const KNOWN_SLUG = 'known-plan';
const UNKNOWN_SLUG = 'renamed-or-deleted-plan';
const STORY_SLUG = 'a-story';
const CARD_PATH = (slug: string) => `docs/plans/2026-08-27-${slug}.md`;

const sprintCard = () =>
  sprint({
    slug: SPRINT_SLUG,
    title: 'A sprint',
    phase: 'active',
    members: [
      { slug: KNOWN_SLUG, text: '', tier: 'must', checked: false, known: true },
      { slug: UNKNOWN_SLUG, text: '', tier: 'must', checked: false, known: false },
    ],
  });

const planCard = () =>
  card({
    slug: KNOWN_SLUG, title: KNOWN_SLUG, type: 'bug', phase: 'Development',
    path: CARD_PATH(KNOWN_SLUG), phaseDate: '2026-08-27', story: STORY_SLUG,
  });

const storyCard = () =>
  story({
    slug: STORY_SLUG, title: 'A story',
    sprints: [{ slug: SPRINT_SLUG, planCount: 1 }],
  });

describe('a sprint member with no card renders as text, not a button', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const sprintModal = (page: Page) => page.getByRole('dialog', { name: /Sprint:/ });

  /** The unknown member's row, located by the slug it names rather than by role. */
  const unknownRow = (page: Page) => sprintModal(page).locator('li', { hasText: UNKNOWN_SLUG });

  /** Open a page whose board carries one plan card, one story and one sprint. */
  const open = async (tab?: string): Promise<Page> =>
    cat.open('an-empty-estate', {
      tab,
      over: {
        board: board({
          columns: [column({ phase: 'Development', cards: [planCard()] })],
          stories: [storyCard()],
          sprints: [sprintCard()],
          storyLanes: [{ lane: 'Active', stories: [storyCard()] }],
        }),
        fleet: fleet(),
      },
    });

  const assertUnknownMemberIsText = async (page: Page) => {
    const row = unknownRow(page);
    await expect.poll(() => row.count(), { timeout: 10_000 }).toBe(1);
    expect(await row.getByRole('button', { name: UNKNOWN_SLUG }).count()).toBe(0);
    expect(await row.locator('[title="Plan not found in board"]').count()).toBe(1);
    // The known sibling, in the same modal, gets a button — proof the test
    // reaches real `sprintItemDestination` output rather than a modal that
    // renders every member as text.
    const known = sprintModal(page).locator('li', { hasText: KNOWN_SLUG });
    expect(await known.getByRole('button', { name: KNOWN_SLUG }).count()).toBe(1);
  };

  it('on the Planning tab, fresh: a story badge opens the story, whose sprint link opens the sprint', async () => {
    const page = await open('planning');
    try {
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
      await page.getByTitle(`Open the ${STORY_SLUG} story`).click();
      await page.getByRole('button', { name: SPRINT_SLUG }).click();
      await assertUnknownMemberIsText(page);
    } finally { await page.close(); }
  });

  it('on the Planning tab, after a Delivery visit: the same chain still refuses a destination', async () => {
    const page = await open('planning');
    try {
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Delivery' }).click();
      await page.getByRole('button', { name: 'Planning' }).click();
      await page.getByTitle(`Open the ${STORY_SLUG} story`).click();
      await page.getByRole('button', { name: SPRINT_SLUG }).click();
      await assertUnknownMemberIsText(page);
    } finally { await page.close(); }
  });

  it('on the Discovery tab, fresh: the story card itself lists the sprint', async () => {
    const page = await open('discovery');
    try {
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: SPRINT_SLUG }).click();
      await assertUnknownMemberIsText(page);
    } finally { await page.close(); }
  });

  it('on the Discovery tab, after a Delivery visit: the same card still refuses a destination', async () => {
    const page = await open('discovery');
    try {
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Delivery' }).click();
      await page.getByRole('button', { name: 'Discovery' }).click();
      await page.getByRole('button', { name: SPRINT_SLUG }).click();
      await assertUnknownMemberIsText(page);
    } finally { await page.close(); }
  });
});
