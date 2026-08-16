// Integration tests for the shipped board artifact: build a scratch repo, hit
// GET /api/board, assert the Board JSON. Covers the contract fields, the
// headline fix (frontmatter-format plans now render), story + sprint discovery,
// and the walker's symlink / missing-dir edge cases.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, fetchBoard, makeRepo } from './helpers.mjs';

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

const APPROVED_STARTED = `# Started work
## Status
- **Phase:** Approved
- **Type:** infra
- **Started:** 2026-07-31, alice, \`infra/started-work\`
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
    server = await startServer(tmp);
  });

  after(() => {
    server?.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the 5 workflow phase columns in order', async () => {
    const board = await fetchBoard(server.port);
    assert.deepEqual(
      board.columns.map((c) => c.phase),
      ['Discovery', 'Design', 'Development', 'Endgame', 'Released'],
    );
  });

  it('frontmatter-format plan appears in its phase column (headline fix)', async () => {
    const board = await fetchBoard(server.port);
    const approved = board.columns.find((c) => c.phase === 'Design').cards;
    const fm = approved.find((c) => c.slug === 'frontmatter-plan');
    assert.ok(fm, 'frontmatter plan must render (it was invisible before)');
    assert.equal(fm.title, 'Frontmatter plan renders now', 'frontmatter title wins over H1');
    assert.equal(fm.type, 'bug');
    assert.equal(fm.sprint, 'alpha-week');
  });

  it('extracts title / type / sprint / story / assignee from a canonical plan', async () => {
    const board = await fetchBoard(server.port);
    const approved = board.columns.find((c) => c.phase === 'Design').cards;
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
    assert.ok(byPhase.Discovery.includes('webhook-support'), 'a Draft plan lands in Discovery');
    assert.ok(!byPhase.Design.includes('webhook-support'), 'and not also in Design — a column is a partition');
    assert.equal(byPhase.Endgame[0], 'sprint-support', 'Delivered belongs to Endgame alone');
    const all = board.columns.flatMap((c) => c.cards.map((x) => x.slug));
    assert.ok(!all.includes('rejected-idea'), 'rejected plan must not appear on the board');
  });

  it('discovers active sprints', async () => {
    const board = await fetchBoard(server.port);
    assert.equal(board.sprints.length, 1);
    assert.deepEqual(board.sprints[0], { slug: 'alpha-week', title: 'Alpha week', phase: 'Active' });
  });

  it('discovers stories with title + status + the path that makes them openable', async () => {
    const board = await fetchBoard(server.port);
    assert.equal(board.stories.length, 1);
    // `path` is repo-relative and carried rather than reconstructed: the slug is
    // both a directory name and part of the filename, so rebuilding it client
    // side would encode that convention twice.
    assert.deepEqual(board.stories[0], {
      slug: 'kanban-board',
      title: 'Kanban board',
      status: 'active',
      path: 'docs/stories/kanban-board/STORY-kanban-board.md',
    });
  });
});

// ── Edge cases: missing dirs, symlink dedup, broken symlinks ─────────────────

describe('board: missing optional dirs', () => {
  let tmp, server;
  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-01-15-webhook-support.md', content: DRAFT }] });
    server = await startServer(tmp);
  });
  after(() => {
    server?.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('serves a valid empty-ish board when sprints/stories dirs are absent', async () => {
    const board = await fetchBoard(server.port);
    assert.ok(board.generatedAt);
    assert.equal(board.columns.length, 5);
    assert.deepEqual(board.sprints, []);
    assert.deepEqual(board.stories, []);
    assert.equal(board.columns.find((c) => c.phase === 'Discovery').cards[0].slug, 'webhook-support');
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
    server = await startServer(tmp);
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
    server = await startServer(tmp);
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

// ── Ready vs In-progress: Approved cards carry the started flag ──────────────

describe('board: Approved splits into Ready vs In progress via Started records', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({
      plans: [
        { name: '2026-07-01-ready-plan.md', content: APPROVED },
        { name: '2026-07-02-started-plan.md', content: APPROVED_STARTED },
        { name: '2026-07-03-draft-plan.md', content: DRAFT },
      ],
    });
    server = await startServer(tmp);
  });

  after(() => {
    server?.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('an Approved plan with no Started record sits at the end of Design', async () => {
    // The substantive change: Approved spans a phase boundary. Nobody has
    // begun, so it is designed and waiting — human-led, not agent-led.
    const board = await fetchBoard(server.port);
    const design = board.columns.find((c) => c.phase === 'Design');
    const ready = design.cards.find((c) => c.slug === 'ready-plan');
    assert.ok(ready, 'a Ready plan belongs in Design, not Development');
    assert.equal(ready.started, false);
  });

  it('an Approved plan WITH a Started record is in Development', async () => {
    const board = await fetchBoard(server.port);
    const dev = board.columns.find((c) => c.phase === 'Development');
    const started = dev.cards.find((c) => c.slug === 'started-plan');
    assert.ok(started, 'work in flight is agent-led and belongs in Development');
    assert.equal(started.started, true);

    // ...and it must NOT also appear in Design: a column is a partition.
    const design = board.columns.find((c) => c.phase === 'Design');
    assert.ok(!design.cards.some((c) => c.slug === 'started-plan'));
  });

  it('a Draft plan sits in Discovery and carries no started flag', async () => {
    // `started` is the Design/Development split, which is a question about
    // approved work only. A Draft plan is in neither column — it is still being
    // shaped — and must carry no flag that implies otherwise.
    const board = await fetchBoard(server.port);
    const discovery = board.columns.find((c) => c.phase === 'Discovery');
    const card = discovery.cards.find((c) => c.slug === 'draft-plan');
    assert.ok(card, 'a Draft plan belongs in Discovery');
    assert.equal(card.started, undefined);
  });

  it('reports a release checklist count, or null when there is none', async () => {
    // The Endgame column asks what is left before signoff. The fixture has no
    // docs/releases/, so null is the right answer — never a guessed 0/0.
    const board = await fetchBoard(server.port);
    assert.equal(board.checklist, null);
  });
});

// The card carries the PR numbers a plan names, and NO url it made up itself.
// A scratch repo has no git remote and no host CLI to ask, which is precisely
// the condition under which a board that templated addresses would produce a
// confident, wrong link — so this suite pins the honest answer.
const WITH_PRS = `# Ship the widget

## Status
- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/widget-core\` → #113
- \`feature/widget-ui\` → #114
`;

describe('board: PR numbers reach the card, links never get invented', () => {
  let tmp, server;
  before(async () => {
    tmp = makeRepo({ plans: [
      { name: '2026-08-16-ship-the-widget.md', content: WITH_PRS },
      { name: '2026-08-16-no-prs-here.md', content: DRAFT },
    ] });
    server = await startServer(tmp);
  });
  after(() => {
    server?.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('carries every PR number the plan names, in order', async () => {
    // Before this change plot-plan-meta.sh parsed `prs` and board.ts dropped
    // them on the floor — the numbers existed and nothing carried them.
    const board = await fetchBoard(server.port);
    const card = board.columns
      .flatMap((c) => c.cards)
      .find((c) => c.slug === 'ship-the-widget');
    assert.ok(card, 'the plan should render as a card');
    assert.deepEqual(card.prs.map((p) => p.number), [113, 114]);
  });

  it('leaves url empty rather than composing one from a number', async () => {
    // The assertion that matters: with no host to ask, every url is "". A
    // board that knew how to build a github.com address would fail here, and
    // would ship broken links to every GitHub Enterprise and self-hosted
    // Bitbucket user.
    const board = await fetchBoard(server.port);
    const card = board.columns
      .flatMap((c) => c.cards)
      .find((c) => c.slug === 'ship-the-widget');
    assert.deepEqual(card.prs.map((p) => p.url), ['', '']);
  });

  it('gives a plan with no PRs an empty list, not a missing field', async () => {
    // A consumer should be able to map over `prs` unconditionally. Absent would
    // make "names no PRs" and "older board" indistinguishable at the boundary.
    const board = await fetchBoard(server.port);
    const card = board.columns
      .flatMap((c) => c.cards)
      .find((c) => c.slug === 'no-prs-here');
    assert.ok(card, 'the PR-less plan should render as a card');
    assert.deepEqual(card.prs, []);
  });
});
