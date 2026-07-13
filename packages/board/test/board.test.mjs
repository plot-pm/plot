// Integration tests for the shipped board artifact: build a scratch repo, hit
// GET /api/board, assert the Board JSON. Covers the contract fields, the
// headline fix (frontmatter-format plans now render), story + sprint discovery,
// and the walker's symlink / missing-dir edge cases.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findFreePort, startServer, fetchBoard, makeRepo } from './helpers.mjs';

// ── Plan / sprint / story fixtures ───────────────────────────────────────────

const DRAFT = `# Add webhook support
## Status
- **Phase:** Draft
- **Type:** feature
`;

const APPROVED = `# Sync board columns
## Status
- **Phase:** Approved
- **Type:** feature
- **Sprint:** alpha-week
- **Story:** kanban-board
## Approval
- **Assignee:** octocat
`;

const DELIVERED = `# Add sprint support
## Status
- **Phase:** Delivered
- **Type:** feature
## Approval
- **Assignee:** eins78
`;

// The headline fix: a frontmatter-only plan the OLD board silently dropped.
const FRONTMATTER = `---
status: Approved
type: bug
title: Frontmatter plan renders now
sprint: alpha-week
---
# This H1 is only a fallback
`;

const REJECTED = `# A rejected idea
## Status
- **Phase:** Rejected
- **Type:** docs
`;

const SPRINT = `# Sprint: Alpha week
## Status
- **Phase:** Active
`;

const STORY = `---
title: Kanban board
status: active
---
# Kanban board
`;

// ── Rich repo: contract fields, phase mapping, discovery ─────────────────────

describe('board: contract fields + frontmatter visibility', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({
      plans: [
        { name: '2026-01-15-webhook-support.md', content: DRAFT },
        { name: '2026-03-15-board-sync.md', content: APPROVED },
        { name: '2026-02-11-sprint-support.md', content: DELIVERED },
        { name: '2026-04-01-frontmatter-plan.md', content: FRONTMATTER },
        { name: '2026-05-01-rejected-idea.md', content: REJECTED },
      ],
      sprints: [{ name: '2026-W18-alpha-week.md', content: SPRINT }],
      stories: [{ dir: 'kanban-board', file: 'STORY-kanban-board.md', content: STORY }],
    });
    server = await startServer(tmp, await findFreePort());
  });

  after(() => {
    server?.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns 4 phase columns in order', async () => {
    const board = await fetchBoard(server.port);
    assert.deepEqual(
      board.columns.map((c) => c.phase),
      ['Draft', 'Approved', 'Delivered', 'Released'],
    );
  });

  it('frontmatter-format plan appears in its phase column (headline fix)', async () => {
    const board = await fetchBoard(server.port);
    const approved = board.columns.find((c) => c.phase === 'Approved').cards;
    const fm = approved.find((c) => c.slug === 'frontmatter-plan');
    assert.ok(fm, 'frontmatter plan must render (it was invisible before)');
    assert.equal(fm.title, 'Frontmatter plan renders now', 'frontmatter title wins over H1');
    assert.equal(fm.type, 'bug');
    assert.equal(fm.sprint, 'alpha-week');
  });

  it('extracts title / type / sprint / story / assignee from a canonical plan', async () => {
    const board = await fetchBoard(server.port);
    const approved = board.columns.find((c) => c.phase === 'Approved').cards;
    const card = approved.find((c) => c.slug === 'board-sync');
    assert.ok(card);
    assert.equal(card.title, 'Sync board columns');
    assert.equal(card.type, 'feature');
    assert.equal(card.sprint, 'alpha-week');
    assert.equal(card.story, 'kanban-board');
    assert.equal(card.assignee, 'octocat');
    assert.equal(card.path, 'docs/plans/2026-03-15-board-sync.md');
  });

  it('maps phases to columns and omits non-board phases (Rejected)', async () => {
    const board = await fetchBoard(server.port);
    const byPhase = Object.fromEntries(board.columns.map((c) => [c.phase, c.cards.map((x) => x.slug)]));
    assert.deepEqual(byPhase.Draft, ['webhook-support']);
    assert.equal(byPhase.Delivered[0], 'sprint-support');
    const all = board.columns.flatMap((c) => c.cards.map((x) => x.slug));
    assert.ok(!all.includes('rejected-idea'), 'rejected plan must not appear on the board');
  });

  it('discovers active sprints', async () => {
    const board = await fetchBoard(server.port);
    assert.equal(board.sprints.length, 1);
    assert.deepEqual(board.sprints[0], { slug: 'alpha-week', title: 'Alpha week', phase: 'Active' });
  });

  it('discovers stories with title + status', async () => {
    const board = await fetchBoard(server.port);
    assert.equal(board.stories.length, 1);
    assert.deepEqual(board.stories[0], { slug: 'kanban-board', title: 'Kanban board', status: 'active' });
  });
});

// ── Edge cases: missing dirs, symlink dedup, broken symlinks ─────────────────

describe('board: missing optional dirs', () => {
  let tmp, server;
  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-01-15-webhook-support.md', content: DRAFT }] });
    server = await startServer(tmp, await findFreePort());
  });
  after(() => {
    server?.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('serves a valid empty-ish board when sprints/stories dirs are absent', async () => {
    const board = await fetchBoard(server.port);
    assert.ok(board.generatedAt);
    assert.equal(board.columns.length, 4);
    assert.deepEqual(board.sprints, []);
    assert.deepEqual(board.stories, []);
    assert.equal(board.columns.find((c) => c.phase === 'Draft').cards[0].slug, 'webhook-support');
  });
});

describe('board: symlink dedup + broken symlink tolerance', () => {
  let tmp, server;
  before(async () => {
    tmp = makeRepo({
      plans: [{ name: '2026-03-15-board-sync.md', content: APPROVED }],
      active: ['2026-03-15-board-sync.md'],
      brokenActive: ['2026-01-01-deleted.md'],
    });
    server = await startServer(tmp, await findFreePort());
  });
  after(() => {
    server?.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('counts a plan symlinked from active/ exactly once, ignoring broken links', async () => {
    const board = await fetchBoard(server.port);
    const all = board.columns.flatMap((c) => c.cards);
    assert.equal(all.length, 1, 'plan counted once despite the active/ symlink');
    assert.equal(all[0].slug, 'board-sync');
    assert.equal(all[0].path, 'docs/plans/2026-03-15-board-sync.md', 'reported under canonical path');
  });
});

describe('board: a directory named *.md is ignored, not fed to the parser', () => {
  let tmp, server;
  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-03-15-board-sync.md', content: APPROVED }] });
    // A directory whose name ends in .md would pass the extension check; the
    // walker must skip it (isFile guard) rather than hand plot-plan-meta.sh a
    // directory (awk: "Is a directory") and 500 the whole board.
    fs.mkdirSync(path.join(tmp, 'docs/plans', '2026-04-01-not-a-plan.md'));
    server = await startServer(tmp, await findFreePort());
  });
  after(() => {
    server?.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('still serves the real plan and does not error on the .md directory', async () => {
    const board = await fetchBoard(server.port);
    const all = board.columns.flatMap((c) => c.cards);
    assert.equal(all.length, 1, 'the real plan is served; the .md directory is skipped');
    assert.equal(all[0].slug, 'board-sync');
  });
});
