import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The framework-agnostic harness the node:test suite also uses: spawn the built
// artifact (real server + real plot-config.sh / plot-plan-meta.sh helpers).
import { startServer, fetchBoard } from '../helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

describe('tiny-garden: data layer (built artifact + real helpers)', () => {
  let server: { port: number; kill: () => void };

  beforeAll(async () => {
    server = await startServer(FIXTURE);
  });
  afterAll(() => server?.kill());

  const bySlug = (board: any): Record<string, any> =>
    Object.fromEntries(board.columns.flatMap((c: any) => c.cards).map((c: any) => [c.slug, c]));

  it('parses the prose CLAUDE.md config and collects every board-eligible plan', async () => {
    // If plot-config.sh mis-parsed the backtick+prose "Plan directory" value,
    // no plans would be found — so these counts also guard the #42 fix.
    const board = await fetchBoard(server.port);
    const counts = Object.fromEntries(board.columns.map((c: any) => [c.phase, c.cards.length]));
    // Workflow phases, not plan states: the fixture's 2 Draft plans are still
    // being shaped, so they are Discovery; its 2 Approved ones are Development,
    // whether or not a branch has started — approved-but-unstarted is work
    // waiting for an agent, not design in progress. The Design column is empty
    // because no fixture plan is in the Design phase. Its 3 Delivered ones are
    // Testing, because Development ends at the merge. This is the measured case
    // the plan names: approved-unstarted plans move OUT of Design.
    expect(counts).toEqual({ Discovery: 2, Design: 0, Development: 2, Testing: 3, Released: 1 });
  });

  it('excludes the Rejected plan from every column', async () => {
    const board = await fetchBoard(server.port);
    const slugs = board.columns.flatMap((c: any) => c.cards.map((x: any) => x.slug));
    expect(slugs).toHaveLength(8);
    expect(slugs).not.toContain('lettuce-bolted');
  });

  it('carries card.sprint for sprints that have NO file — they are facts, not filter options', async () => {
    // The fixture has ONE sprint file (`active/spring-planting.md`). The plans
    // reference three more inline — `summer-harvest`, the long one, and so on —
    // and those values stay on the cards: a plan's `Sprint:` field is history
    // and does not clear when its sprint ends.
    //
    // What changed 2026-08-26 is that they are no longer FILTER OPTIONS. The
    // filter derives from `board.sprints` alone, so a sprint with no file under
    // `active/` is not offered. See `sprintFilterOptions`: measured hours after
    // the W35 sprint closed, the filter listed three sprints, all Closed, while
    // the Agents header read *No active sprint*.
    const board = await fetchBoard(server.port);
    expect(board.sprints.map((s) => s.slug)).toEqual(['spring-planting']);
    const cards = bySlug(board);
    expect(cards['plant-tomatoes'].sprint).toBe('spring-planting');
    expect(cards['fix-leaky-hose'].sprint).toBe('spring-planting');
    expect(cards['strawberry-netting'].sprint).toBe('summer-harvest');
    // The deliberately long badge value.
    expect(cards['zucchini-glut'].sprint).toBe(
      'the-great-heirloom-tomato-and-zucchini-overplanting-recovery-initiative',
    );
  });

  it('renders unrecognized (chore) and absent types as "unknown"', async () => {
    const board = await fetchBoard(server.port);
    const cards = bySlug(board);
    expect(cards['zucchini-glut'].type).toBe('unknown'); // type: chore
    expect(cards['pumpkin-patch'].type).toBe('unknown'); // no type field
  });

  it('discovers stories from the directory', async () => {
    const board = await fetchBoard(server.port);
    expect(board.stories.map((s: any) => s.slug).sort()).toEqual([
      'berry-patch',
      'orchard',
      'raised-beds',
    ]);
  });
});
