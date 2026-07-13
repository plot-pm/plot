import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The framework-agnostic harness the node:test suite also uses: spawn the built
// artifact (real server + real plot-config.sh / plot-plan-meta.sh helpers).
import { findFreePort, startServer, fetchBoard } from '../helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

describe('tiny-garden: data layer (built artifact + real helpers)', () => {
  let server: { port: number; kill: () => void };

  beforeAll(async () => {
    server = await startServer(FIXTURE, await findFreePort());
  });
  afterAll(() => server?.kill());

  const bySlug = (board: any): Record<string, any> =>
    Object.fromEntries(board.columns.flatMap((c: any) => c.cards).map((c: any) => [c.slug, c]));

  it('parses the prose CLAUDE.md config and collects every board-eligible plan', async () => {
    // If plot-config.sh mis-parsed the backtick+prose "Plan directory" value,
    // no plans would be found — so these counts also guard the #42 fix.
    const board = await fetchBoard(server.port);
    const counts = Object.fromEntries(board.columns.map((c: any) => [c.phase, c.cards.length]));
    expect(counts).toEqual({ Draft: 2, Approved: 2, Delivered: 3, Released: 1 });
  });

  it('excludes the Rejected plan from every column', async () => {
    const board = await fetchBoard(server.port);
    const slugs = board.columns.flatMap((c: any) => c.cards.map((x: any) => x.slug));
    expect(slugs).toHaveLength(8);
    expect(slugs).not.toContain('lettuce-bolted');
  });

  it('leaves board.sprints empty (no sprint directory) yet carries inline card.sprint', async () => {
    const board = await fetchBoard(server.port);
    expect(board.sprints).toEqual([]);
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
