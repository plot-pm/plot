// The Discovery column, end to end: a REAL git repo whose Draft plan lives only
// on an idea branch, read by the built artifact through the real helpers. No
// stubs, no hand-built metadata.
//
// A unit test cannot show this one. The defect was that `collectPlanFiles`
// walks ONE branch's working tree, and a plan under review is not in it — so
// any fixture that puts a Draft plan on disk proves the opposite of the thing
// under test. Only a repo where the Draft plan exists solely as a blob on a
// prefixed branch can tell the fix from the bug.
//
// Everything is local: a bare repo on disk is the "remote". Nothing here
// touches a network or a git host.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, fetchBoard, fetchRaw } from './helpers.mjs';

/** A plan on the default branch: approved, started — Development. */
const APPROVED_PLAN = `# The board acts through plot

## Status
- **Phase:** Approved
- **Type:** feature
- **Started:** 2026-08-16, jwloka, \`feature/board-acts\`

## Branches

- \`feature/board-acts\` — the button calls the command
`;

/** The plan under review. Lives ONLY on idea/, which is the whole point. */
const DRAFT_PLAN = `# A column that can finally hold something

## Status
- **Phase:** Draft
- **Type:** bug
- **Story:** plot-board

## Branches

- \`bug/board-shows-discovery\` — Draft maps to Discovery
`;

/** An `Impl: same branch` plan: its Draft rides feature/, not idea/. */
const SAME_BRANCH_PLAN = `# Work carried on its own branch

## Status
- **Phase:** Draft
- **Type:** feature
- **Impl:** same branch

## Branches

- \`feature/carries-its-own-plan\` — plan and code together
`;

const git = (cwd) => (...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * A repo shaped like a real one mid-review: an approved plan merged to the
 * default branch, and two Draft plans that exist only on prefixed branches.
 *
 * The `active/` symlink is created for the branch plans too, because a real
 * `/plot-idea` makes one — and it is what would double-count each Draft plan if
 * the tree walk took symlink entries as plan files.
 */
function makeRepoUnderReview() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-discovery-'));
  const repo = path.join(tmp, 'work');
  const remote = path.join(tmp, 'remote.git');
  fs.mkdirSync(repo, { recursive: true });

  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  const g = git(repo);
  g('init', '-b', 'main');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'Plot Test');
  g('config', 'commit.gpgsign', 'false');

  const plans = path.join(repo, 'docs/plans');
  fs.mkdirSync(path.join(plans, 'active'), { recursive: true });
  // The board reads `Branch prefixes` from config rather than hardcoding
  // `idea/`, so the fixture declares them — and deliberately declares a set
  // that includes feature/, which is what makes the same-branch case work.
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    '# Fixture\n\n## Plot Config\n\n'
      + '- **Branch prefixes:** idea/, feature/, bug/\n'
      + '- **Plan directory:** docs/plans/\n'
      + '- **Main branch:** main\n',
    'utf8',
  );
  const approvedName = '2026-08-10-board-acts-through-plot.md';
  fs.writeFileSync(path.join(plans, approvedName), APPROVED_PLAN, 'utf8');
  fs.symlinkSync(path.join(plans, approvedName), path.join(plans, 'active', approvedName));

  g('add', '-A');
  g('commit', '-m', 'plan: board acts through plot');
  g('remote', 'add', 'origin', remote);
  g('push', '-u', 'origin', 'main');
  // origin/HEAD is how the board resolves the default branch offline, exactly
  // as plot-fleet-scan.sh does. A clone has it; `git init` + push does not.
  g('remote', 'set-head', 'origin', 'main');

  const draftName = '2026-08-16-board-shows-discovery.md';
  g('checkout', '-b', 'idea/board-shows-discovery');
  fs.writeFileSync(path.join(plans, draftName), DRAFT_PLAN, 'utf8');
  fs.symlinkSync(path.join(plans, draftName), path.join(plans, 'active', draftName));
  g('add', '-A');
  g('commit', '-m', 'plan: the column that can hold something');
  g('push', 'origin', 'idea/board-shows-discovery');
  g('checkout', 'main');
  // Remove the working-tree copies the branch checkout left behind, so the
  // filesystem walk genuinely cannot see this plan. Without this the test
  // would pass through the OLD code path and prove nothing.
  fs.rmSync(path.join(plans, draftName), { force: true });
  fs.rmSync(path.join(plans, 'active', draftName), { force: true });

  const sameName = '2026-08-16-carries-its-own-plan.md';
  g('checkout', '-b', 'feature/carries-its-own-plan');
  fs.writeFileSync(path.join(plans, sameName), SAME_BRANCH_PLAN, 'utf8');
  g('add', '-A');
  g('commit', '-m', 'plan: work carried on its own branch');
  g('push', 'origin', 'feature/carries-its-own-plan');
  g('checkout', 'main');
  fs.rmSync(path.join(plans, sameName), { force: true });

  // A prefixed branch with NO plan files of its own — cut from main, one
  // unrelated commit. It must be skipped without error and must not duplicate
  // main's plans onto the board.
  g('checkout', '-b', 'bug/no-plans-here');
  fs.writeFileSync(path.join(repo, 'README.md'), 'nothing to see\n', 'utf8');
  g('add', '-A');
  g('commit', '-m', 'docs: a branch that carries no plan');
  g('push', 'origin', 'bug/no-plans-here');
  g('checkout', 'main');
  fs.rmSync(path.join(repo, 'README.md'), { force: true });

  return {
    repo,
    draftPath: `docs/plans/${draftName}`,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

describe('board: a Draft plan under review appears in Discovery', () => {
  let fixture, server, board;

  before(async () => {
    fixture = makeRepoUnderReview();
    server = await startServer(fixture.repo);
    board = await fetchBoard(server.port);
  });

  after(() => {
    server?.kill();
    fixture?.cleanup();
  });

  const cards = () => board.columns.flatMap((c) => c.cards);
  const inPhase = (phase) =>
    board.columns.find((c) => c.phase === phase).cards.map((c) => c.slug).sort();

  it('renders the Draft plan that exists only on an idea branch', () => {
    // The headline, and the reason both halves of this change are one change:
    // remapping alone leaves this empty, because the file is not on disk.
    assert.deepEqual(inPhase('Discovery'), [
      'board-shows-discovery', 'carries-its-own-plan',
    ]);
  });

  it('finds an `Impl: same branch` plan too — the prefix list, not just idea/', () => {
    // Same rule, wider net, and deliberate: a same-branch plan's Draft phase is
    // invisible for the identical reason, and `Branch prefixes` is config.
    const card = cards().find((c) => c.slug === 'carries-its-own-plan');
    assert.ok(card, 'the feature-branch plan should render');
    assert.equal(card.phase, 'Discovery');
  });

  it('leaves Design holding only approved-not-started plans', () => {
    // Design now means exactly one thing. The started plan is Development, and
    // nothing Draft may leak back in.
    assert.deepEqual(inPhase('Design'), []);
    assert.deepEqual(inPhase('Development'), ['board-acts-through-plot']);
  });

  it('gives the card its REPO-RELATIVE path, never the staging path', () => {
    // The trap: plot-plan-meta.sh takes paths, so a git-sourced plan must be
    // written somewhere first — and its `file` field is then that temp path.
    // PlanCard renders card.path verbatim, so this fails silently and merely
    // looks untidy. Assert the exact string.
    const card = cards().find((c) => c.slug === 'board-shows-discovery');
    assert.equal(card.path, fixture.draftPath);
    assert.ok(!card.path.includes(os.tmpdir()), 'no staging path may reach a card');
  });

  it('produces no duplicate cards, though every plan is on several branches', () => {
    // Each prefixed branch was cut from main and carries all of main's plans;
    // a branch with no plan files of its own contributes nothing. De-duplication
    // is by canonical path, matching collectPlanFiles's existing contract.
    const slugs = cards().map((c) => c.slug).sort();
    assert.deepEqual(slugs, [
      'board-acts-through-plot', 'board-shows-discovery', 'carries-its-own-plan',
    ]);
  });

  it('picks up a plan pushed to a NEW branch after the first read', async () => {
    // The branch-tip cache is what keeps the poll path affordable — each `git`
    // invocation costs ~55 ms of spawn regardless of the work it does. A cache
    // that never invalidated would be worse than no feature: the board would
    // show a stale picture and look correct doing it.
    //
    // So: push a plan on a branch the server has already looked past, and it
    // must appear. The key covers names as well as SHAs, which is what makes a
    // brand-new branch — not merely a moved one — invalidate.
    const g = git(fixture.repo);
    const late = '2026-08-17-arrived-late.md';
    g('checkout', '-b', 'idea/arrived-late');
    fs.writeFileSync(
      path.join(fixture.repo, 'docs/plans', late),
      DRAFT_PLAN.replace('A column that can finally hold something', 'Arrived late'),
      'utf8',
    );
    g('add', '-A');
    g('commit', '-m', 'plan: arrived late');
    g('push', 'origin', 'idea/arrived-late');
    g('checkout', 'main');
    fs.rmSync(path.join(fixture.repo, 'docs/plans', late), { force: true });

    const next = await fetchBoard(server.port);
    const discovery = next.columns.find((c) => c.phase === 'Discovery');
    assert.ok(
      discovery.cards.some((c) => c.slug === 'arrived-late'),
      'a plan on a new branch must not be hidden by the tip cache',
    );
  });

  it('opens a Discovery plan — the card and the viewer read the same sources', async () => {
    // The bug this pins: cards gained a branch source, `/plan/<file>` did not.
    // A Discovery card rendered fine and clicking it answered
    // "Failed to load plan: HTTP 404" — one consumer seeing half the sources.
    const board = await fetchBoard(server.port);
    const discovery = board.columns.find((c) => c.phase === 'Discovery');
    assert.ok(discovery.cards.length > 0, 'fixture must produce a Discovery card');

    for (const card of discovery.cards) {
      const file = path.basename(card.path);
      const res = await fetchRaw(server.port, `/plan/${encodeURIComponent(file)}`);
      assert.equal(res.status, 200, `${file} must open, not 404`);
      const html = res.body;
      // Real content, not an empty shell: a 200 carrying nothing would pass a
      // status-only assertion while showing the reader a blank page.
      assert.match(html, /<h1>/, `${file} must render its heading`);
    }
  });

  it('still refuses what is not a plan, from either source', async () => {
    // The fix widened where a name may resolve, so the negative needs saying
    // again: traversal and unknown names stay 404.
    for (const bad of ['../../../etc/passwd', '..%2F..%2Fpackage.json', 'nope.md']) {
      const res = await fetchRaw(server.port, `/plan/${bad}`);
      assert.equal(res.status, 404, `${bad} must not resolve`);
    }
  });

  it('leaves no staging directory behind, over repeated builds', async () => {
    // The staged copies exist for exactly one parse. A server that walks plans
    // on every request must not accumulate temp directories — so the check is
    // that repeated builds do not GROW the set, which is the failure that
    // matters and the one a single snapshot cannot see.
    const staging = () =>
      fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('plot-board-branch-')).length;
    const before = staging();
    for (let i = 0; i < 3; i++) await fetchBoard(server.port);
    assert.equal(staging(), before);
  });
});

describe('board: a repo with no prefixed branches behaves exactly as before', () => {
  let tmp, server;

  before(async () => {
    // The common case for an adopting project: plans on disk, no idea branches,
    // and — here — no git repository at all. The new source must be additive
    // and completely silent when it finds nothing.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-nobranch-'));
    const plans = path.join(tmp, 'docs/plans');
    fs.mkdirSync(path.join(plans, 'active'), { recursive: true });
    const name = '2026-08-10-board-acts-through-plot.md';
    fs.writeFileSync(path.join(plans, name), APPROVED_PLAN, 'utf8');
    fs.symlinkSync(path.join(plans, name), path.join(plans, 'active', name));
    server = await startServer(tmp);
  });

  after(async () => {
    // AWAIT the server's exit before deleting the tree it is serving from.
    // `kill()` only sends the signal, and `rmSync` then raced a live process:
    // three CI failures with `ENOTEMPTY` on this directory's `.git`.
    await server?.stop();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('serves the working-tree plans and an empty Discovery column', async () => {
    const board = await fetchBoard(server.port);
    const counts = Object.fromEntries(board.columns.map((c) => [c.phase, c.cards.length]));
    assert.deepEqual(counts, {
      Discovery: 0, Design: 0, Development: 1, Endgame: 0, Released: 0,
    });
  });
});

describe('board: a plans dir NESTED in an unrelated repo borrows nothing from it', () => {
  let tmp, outer, server;

  before(async () => {
    // git resolves upwards from the cwd, so a plans directory that merely sits
    // inside someone else's checkout would enumerate THAT repo's branches and
    // stage plan files off them — cards for a different project entirely.
    //
    // Not hypothetical: this repo's own tiny-garden fixture lives inside the
    // plot checkout, and before the containment check the board read plot's
    // eight prefixed branches on every request to serve a garden.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-nested-'));
    outer = path.join(tmp, 'outer');
    fs.mkdirSync(outer, { recursive: true });
    const g = git(outer);
    g('init', '-b', 'main');
    g('config', 'user.email', 'test@example.invalid');
    g('config', 'user.name', 'Plot Test');
    g('config', 'commit.gpgsign', 'false');
    // The outer repo carries a plan on an idea branch. It must never be read.
    const outerPlans = path.join(outer, 'docs/plans');
    fs.mkdirSync(outerPlans, { recursive: true });
    fs.writeFileSync(path.join(outerPlans, '2026-08-01-outer.md'), APPROVED_PLAN, 'utf8');
    g('add', '-A');
    g('commit', '-m', 'plan: outer');
    g('checkout', '-b', 'idea/outer-secret');
    fs.writeFileSync(path.join(outerPlans, '2026-08-16-outer-secret.md'), DRAFT_PLAN, 'utf8');
    g('add', '-A');
    g('commit', '-m', 'plan: outer secret');
    g('checkout', 'main');
    fs.rmSync(path.join(outerPlans, '2026-08-16-outer-secret.md'), { force: true });

    // The board is pointed at a nested directory, which is NOT the repo root.
    const nested = path.join(outer, 'fixtures/garden');
    const plans = path.join(nested, 'docs/plans');
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(nested, 'CLAUDE.md'),
      '# Garden\n\n## Plot Config\n\n- **Branch prefixes:** idea/, feature/, bug/\n',
      'utf8',
    );
    fs.writeFileSync(path.join(plans, '2026-08-10-board-acts-through-plot.md'), APPROVED_PLAN, 'utf8');
    server = await startServer(nested);
  });

  after(async () => {
    // AWAIT the server's exit before deleting the tree it is serving from.
    // `kill()` only sends the signal, and `rmSync` then raced a live process:
    // three CI failures with `ENOTEMPTY` on this directory's `.git`.
    await server?.stop();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('shows only its own plans — never the enclosing repo\'s branch plans', async () => {
    const board = await fetchBoard(server.port);
    const slugs = board.columns.flatMap((c) => c.cards.map((x) => x.slug)).sort();
    assert.deepEqual(slugs, ['board-acts-through-plot']);
  });
});
