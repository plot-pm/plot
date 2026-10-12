// The declared `Workflow phases` map, end to end: a scratch repo whose CLAUDE.md
// names three phases that are not the five defaults, a real board server, and
// one /api/board payload read for every place a phase name appears.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, fetchBoard, makeRepo, rmTree } from './helpers.mjs';

const plan = (title, phase) => `# ${title}
## Status
- **Phase:** ${phase}
- **Type:** feature
`;

const PLANS = [
  { name: '2026-08-01-a-draft.md', content: plan('A draft', 'Draft') },
  { name: '2026-08-02-in-design.md', content: plan('In design', 'Design') },
  { name: '2026-08-03-an-approved.md', content: plan('An approved', 'Approved') },
  { name: '2026-08-04-a-delivered.md', content: plan('A delivered', 'Delivered') },
  { name: '2026-08-05-a-released.md', content: plan('A released', 'Released') },
];

const withConfig = (tmp, phases) =>
  fs.writeFileSync(
    path.join(tmp, 'CLAUDE.md'),
    `# Scratch\n\n## Plot Config\n\n- **Workflow phases:** ${phases}\n`,
    'utf8',
  );

describe('board: a declared map with three phases', () => {
  const MAP = 'Idea = plan:draft, plan:design; Build = plan:approved; Done = plan:delivered, plan:released';
  const NAMES = ['Idea', 'Build', 'Done'];
  let tmp, server, board;

  before(async () => {
    tmp = makeRepo({ plans: PLANS });
    withConfig(tmp, MAP);
    server = await startServer(tmp);
    board = await fetchBoard(server.port);
  });
  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
  });

  it('draws one column per declared phase, in declared order', () => {
    assert.deepEqual(board.columns.map((c) => c.phase), NAMES);
    assert.equal(board.phaseMapRefusal, null);
  });

  it('names a declared phase on every card', () => {
    const cards = board.columns.flatMap((c) => c.cards);
    assert.equal(cards.length, PLANS.length);
    for (const card of cards) assert.ok(NAMES.includes(card.phase), `${card.slug} names ${card.phase}`);
    for (const column of board.columns) {
      for (const card of column.cards) assert.equal(card.phase, column.phase, `${card.slug} sits in its own column`);
    }
  });

  it('places each plan state in the phase that lists it', () => {
    const slugsIn = (phase) => board.columns.find((c) => c.phase === phase).cards.map((c) => c.slug).sort();
    assert.deepEqual(slugsIn('Idea'), ['a-draft', 'in-design']);
    assert.deepEqual(slugsIn('Build'), ['an-approved']);
    assert.deepEqual(slugsIn('Done'), ['a-delivered', 'a-released']);
  });

  it('offers Approve on the Idea cards only', () => {
    for (const card of board.columns.flatMap((c) => c.cards)) {
      const wantsApprove = card.slug === 'a-draft' || card.slug === 'in-design';
      assert.equal(Boolean(card.controls.approve), wantsApprove, `${card.slug} approve`);
    }
  });

  it('shows the checklist on the phase that lists delivered, and on no other', () => {
    assert.deepEqual(board.columns.filter((c) => c.checklist).map((c) => c.phase), ['Done']);
  });

  it('gives a declared name neither leadership nor an accent of its own', () => {
    for (const column of board.columns) {
      assert.equal(column.leadership, null, `${column.phase} leadership`);
      assert.equal(column.accent, 'neutral', `${column.phase} accent`);
    }
  });
});

describe('board: a refused map falls back to the defaults and says why', () => {
  let tmp, server, board;

  before(async () => {
    tmp = makeRepo({ plans: PLANS });
    withConfig(tmp, 'Idea = plan:draft; Idea = plan:approved');
    server = await startServer(tmp);
    board = await fetchBoard(server.port);
  });
  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
  });

  it('draws the default plan columns', () => {
    assert.deepEqual(board.columns.map((c) => c.phase), ['Design', 'Development', 'Testing', 'Released']);
  });

  it('carries the refusal for the banner', () => {
    assert.match(board.phaseMapRefusal, /^Workflow phases: /);
  });
});
