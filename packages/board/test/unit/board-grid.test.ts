import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardView, boardGridColumns } from '../../src/app/components/Board.js';
import { BoardSchema } from '../../src/contract/schema.js';

// The board grid draws one xl track per declared column. A fixed track count
// leaves an empty track under the four default plan phases and wraps a sixth
// phase onto a second row.
const render = (names: readonly string[]): string =>
  renderToStaticMarkup(createElement(BoardView, {
    board: BoardSchema.parse({
      generatedAt: '2026-10-12T00:00:00Z',
      columns: names.map((phase) => ({ phase, cards: [] })),
      stories: [],
      sprints: [],
      checklist: null,
    }),
    sprintSel: [],
    storySel: [],
    pulse: 0,
    onStarting: () => {},
    onOpenPlan: () => {},
  }));

describe('the board grid', () => {
  it('sizes the xl tracks from the declared column count', () => {
    expect(boardGridColumns(4)).toBe('repeat(4, minmax(0, 1fr))');
    expect(boardGridColumns(6)).toBe('repeat(6, minmax(0, 1fr))');
  });

  it('renders four tracks for the four default plan phases', () => {
    const html = render(['Design', 'Development', 'Testing', 'Released']);
    expect(html).toContain('--board-columns:repeat(4, minmax(0, 1fr))');
    expect(html).toContain('xl:grid-cols-(--board-columns)');
    expect(html).not.toContain('xl:grid-cols-5');
  });

  it('renders six tracks for a six-phase map', () => {
    const html = render(['Idea', 'Design', 'Build', 'Review', 'Ship', 'Done']);
    expect(html).toContain('--board-columns:repeat(6, minmax(0, 1fr))');
  });
});
