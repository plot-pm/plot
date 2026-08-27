// The board reads plans and sprints from `origin/<default>`, not from its own
// checkout.
//
// THE CHECKOUT IS DELIBERATELY LEFT BEHIND IN EVERY TEST HERE, and that is the
// whole design of this file. The defect was measured on 2026-08-27 as a board
// whose worktree was 8 commits behind, then 16 about an hour later: `board.ts`
// read plan files with `fs.readFileSync` while the fleet scan beside it read
// `origin/<main>` and fetched every pulse, so one row rendered wave facts from
// a fetched ref and plan facts from a working tree nobody pulls.
//
// A fix verified against an up-to-date checkout passes WITHOUT DOING ANYTHING —
// the two sources agree there. So each test below writes one thing to the ref
// and a different thing to the working tree, and asserts which one reached the
// screen.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, fetchBoard, fetchRaw, rmTree, SCRIPTS_DIR } from './helpers.mjs';

const RUN = (cwd) => (...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function plan({ phase = 'Draft', title = 'Probe plan', extra = '' }) {
  return `# ${title}

## Status

- **Phase:** ${phase}
- **Type:** feature

## Changelog

A plan used to prove where the board reads from.
${extra}`;
}

/**
 * A repo whose `origin/main` and whose working tree DISAGREE.
 *
 * Built as a real clone of a real bare remote rather than with a faked ref: the
 * thing under test is which of two genuine git sources the board consults, and
 * a stubbed one would prove nothing about the read that failed in production.
 */
function makeSplitRepo({ onRef = {}, inTree = {}, sprintOnRef = null, sprintInTree = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-plan-source-'));
  const bare = path.join(tmp, 'origin.git');
  const author = path.join(tmp, 'author');
  const board = path.join(tmp, 'board');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, author], { stdio: ['ignore', 'pipe', 'ignore'] });
  const ga = RUN(author);
  const write = (root, rel, body) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body, 'utf8');
  };
  fs.mkdirSync(path.join(author, 'docs/plans'), { recursive: true });
  for (const [name, body] of Object.entries(onRef)) write(author, `docs/plans/${name}`, body);
  if (sprintOnRef) write(author, `docs/sprints/active/${sprintOnRef.name}`, sprintOnRef.content);
  ga('add', '-A');
  ga('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'the ref');
  ga('push', '-q', 'origin', 'HEAD:main');
  // The board's own checkout, cloned BEFORE the working tree is made to
  // disagree — this is the stale worktree the defect lives in.
  execFileSync('git', ['clone', '-q', bare, board], { stdio: ['ignore', 'pipe', 'ignore'] });
  RUN(board)('fetch', '-q', 'origin');
  for (const [name, body] of Object.entries(inTree)) write(board, `docs/plans/${name}`, body);
  if (sprintInTree) write(board, `docs/sprints/active/${sprintInTree.name}`, sprintInTree.content);
  return { tmp, bare, author, board };
}

/** Advance `origin/main` after the board's checkout already exists. */
function pushToRef(fx, rel, body) {
  const ga = RUN(fx.author);
  fs.mkdirSync(path.join(fx.author, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(fx.author, rel), body, 'utf8');
  ga('add', '-A');
  ga('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'advance');
  ga('push', '-q', 'origin', 'HEAD:main');
  // The BOARD fetches nothing itself — the fleet scan does, on its own timer.
  // Fetching here stands in for that scan, which is exactly the production
  // arrangement: `refs/remotes/origin/*` is already current, and the bug was
  // that `board.ts` read a second, older copy of data it already had.
  RUN(fx.board)('fetch', '-q', 'origin');
}

const cardsOf = (board) => board.columns.flatMap((c) => c.cards);
const cardFor = (board, slug) => cardsOf(board).find((c) => c.slug === slug);

describe('the board reads the ref, not the checkout', () => {
  describe('a plan approved on the ref and never pulled', () => {
    let fx;
    let server;
    before(async () => {
      // Item 1, in the measured shape: the ref says Approved, the checkout has
      // never seen that commit and still says Draft.
      fx = makeSplitRepo({ onRef: { '2026-01-01-probe.md': plan({ phase: 'Draft' }) } });
      pushToRef(fx, 'docs/plans/2026-01-01-probe.md', plan({ phase: 'Approved' }));
      server = await startServer(fx.board);
    });
    after(async () => {
      await server?.kill();
      rmTree(fx.tmp);
    });

    it('reads Approved from the ref while the checkout says Draft', async () => {
      const onDisk = fs.readFileSync(path.join(fx.board, 'docs/plans/2026-01-01-probe.md'), 'utf8');
      assert.match(onDisk, /\*\*Phase:\*\* Draft/, 'the checkout must be behind, or this proves nothing');
      const board = await fetchBoard(server.port);
      const card = cardFor(board, 'probe');
      assert.ok(card, 'the plan must reach the board');
      // Approved maps to the Development column; Draft would be Discovery.
      assert.equal(card.phase, 'Development');
    });

    it('carries no rounds badge for a plan the checkout thinks is Draft', async () => {
      // Item 3. `roundsBadgeText` renders only for a Discovery card, so the
      // badge beside phase Development was the same stale parse showing a
      // second face. A fix that corrected `phase` and left `status` derived
      // from something else would pass item 1 alone.
      const board = await fetchBoard(server.port);
      const card = cardFor(board, 'probe');
      assert.notEqual(card.phase, 'Discovery');
      assert.equal(card.status, 'approved');
    });

    it('names the ref it read', async () => {
      // Item 14's server half — the fields must exist before they can render.
      const board = await fetchBoard(server.port);
      assert.equal(board.planSource.ref, 'origin/main');
      assert.equal(board.planSource.resolved, true);
    });
  });

  describe('the one-directional merge', () => {
    let fx;
    let server;
    before(async () => {
      fx = makeSplitRepo({
        onRef: { '2026-01-01-shared.md': plan({ phase: 'Approved', title: 'Shared plan' }) },
        inTree: {
          // Present in BOTH, and the tree's copy says something else. Item 8.
          '2026-01-01-shared.md': plan({ phase: 'Released', title: 'Shared plan' }),
          // Present ONLY in the tree. Item 7.
          '2026-02-02-local.md': plan({ phase: 'Draft', title: 'Local plan' }),
        },
      });
      server = await startServer(fx.board);
    });
    after(async () => {
      await server?.kill();
      rmTree(fx.tmp);
    });

    it('takes the ref content where both have the plan, and does not mark it', async () => {
      // ITEM 8, THE SAFETY PROPERTY. Letting the tree win here would be the
      // original defect with extra steps: an uncommitted edit would silently
      // become what the board reports to everyone.
      const board = await fetchBoard(server.port);
      const card = cardFor(board, 'shared');
      assert.equal(card.phase, 'Development', 'the ref says Approved → Development');
      assert.notEqual(card.phase, 'Released', 'the working tree must NOT win');
      assert.equal(card.notPushed, undefined, 'a plan the ref carries is not marked');
    });

    it('shows a plan the ref lacks, marked not pushed', async () => {
      // Item 7 — the five-plans-invisible gap. Shown rather than hidden,
      // because a card that says `not pushed` claims nothing about what
      // everyone can see.
      const board = await fetchBoard(server.port);
      const card = cardFor(board, 'local');
      assert.ok(card, 'a local-only plan must still reach the board');
      assert.equal(card.notPushed, true);
      assert.equal(board.planSource.localOnly, 1);
    });
  });

  it('marks nothing in a checkout whose plans are all on the ref', async () => {
    // ITEM 13, and it is pinned in BOTH directions on purpose. The board's own
    // dedicated checkout holds zero plans absent from the ref (measured
    // 2026-08-27 — nobody authors there), so this marker is EXPECTED TO LOOK
    // UNUSED in that deployment. Without this assertion a later change could
    // start marking every card and the label would mean nothing in the one
    // place it matters.
    const fx = makeSplitRepo({
      onRef: {
        '2026-01-01-one.md': plan({ phase: 'Approved', title: 'One' }),
        '2026-01-02-two.md': plan({ phase: 'Draft', title: 'Two' }),
      },
    });
    const server = await startServer(fx.board);
    try {
      const board = await fetchBoard(server.port);
      assert.equal(cardsOf(board).length, 2);
      for (const card of cardsOf(board)) {
        assert.equal(card.notPushed, undefined, `${card.slug} must not be marked`);
      }
      assert.equal(board.planSource.localOnly, 0);
    } finally {
      await server.kill();
      rmTree(fx.tmp);
    }
  });

  it('says so where the ref cannot be resolved, rather than promoting the checkout', async () => {
    // Item 10. A repo with no remote is a real deployment, and the answer is a
    // stated one — never a checkout quietly wearing the ref's authority, which
    // is the substitution `plot-dispatch.sh`'s phase gate forbids in the same
    // words: a fallback to the working tree "would reintroduce the bug exactly
    // where nothing can catch it".
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-plan-source-bare-'));
    fs.mkdirSync(path.join(tmp, 'docs/plans'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'docs/plans/2026-03-03-orphan.md'),
      plan({ phase: 'Approved', title: 'Orphan' }),
      'utf8',
    );
    const server = await startServer(tmp);
    try {
      const board = await fetchBoard(server.port);
      assert.equal(board.planSource.resolved, false, 'the board must SAY the ref did not resolve');
      assert.equal(board.planSource.ref, 'origin/main', 'and must name which ref that was');
      // The plan is still shown — but as the local thing it is, never as the
      // ref's. That distinction is the whole design.
      const card = cardFor(board, 'orphan');
      assert.ok(card);
      assert.equal(card.notPushed, true);
    } finally {
      await server.kill();
      rmTree(tmp);
    }
  });

  it('is deliverable on a stale checkout once every wave has merged', async () => {
    // ITEM 2 — the Deliver refusal is the report this branch came from, so it
    // is the assertion rather than only the phase behind it.
    //
    // Measured 2026-08-27: `a-closed-sprint-says-what-it-achieved`, both waves
    // merged (#457, #463), refused with "plan has a branch that is not merged".
    // The board's checkout was 8 commits behind and had never seen the commit
    // annotating the second wave. `git merge --ff-only` and nothing else fixed
    // it. The message was accurate about what the board could SEE, and wrong
    // about the repository.
    //
    // Here the ref carries the plan with both waves, and the checkout carries
    // the version that names only the first — the shape of never having pulled.
    const bothWaves = `# Closed sprint plan

## Status

- **Phase:** Approved
- **Type:** bug

## Waves

### Reached (Branch: feature/wave-one, PR: #457)

The first wave.

### Reported (Branch: feature/wave-two, PR: #463)

The second wave — the one the checkout has never seen.
`;
    const onlyFirstWave = `# Closed sprint plan

## Status

- **Phase:** Approved
- **Type:** bug

## Waves

### Reached (Branch: feature/wave-one, PR: #457)

The first wave.
`;
    const fx = makeSplitRepo({
      onRef: { '2026-08-21-closed-sprint.md': onlyFirstWave },
      inTree: { '2026-08-21-closed-sprint.md': onlyFirstWave },
    });
    pushToRef(fx, 'docs/plans/2026-08-21-closed-sprint.md', bothWaves);
    // A pulse in which BOTH waves' branches have merged. The plan the checkout
    // holds names only one of them, so a board reading the checkout sees a wave
    // it cannot match and withholds `deliverable` — the refusal, reproduced.
    const bridge = path.join(fx.board, '.plot/state/last-pulse.json');
    fs.mkdirSync(path.dirname(bridge), { recursive: true });
    const wave = (name, br) => ({
      name,
      verdict: 'complete',
      branches: [{ branch: br, state: 'merged', deferred: false, claimed: '' }],
    });
    fs.writeFileSync(
      bridge,
      JSON.stringify({
        version: 1,
        at: Date.now(),
        pulse: {
          main: 'main',
          head: 'main',
          plans: [
            {
              file: '2026-08-21-closed-sprint.md',
              phase: 'approved',
              waves: [wave('Reached', 'feature/wave-one'), wave('Reported', 'feature/wave-two')],
            },
          ],
          summary: { plans: 1, waves: 2, branches: 2, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
        },
        ages: [],
        branchUrlBase: '',
        approvedAt: [],
        ideaPlans: [],
      }),
      'utf8',
    );
    // The scan must not run, or it would overwrite the planted pulse with the
    // truth about a scratch repo that has no such branches.
    const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-plan-source-scan-'));
    for (const name of fs.readdirSync(SCRIPTS_DIR)) {
      if (name === 'plot-fleet-scan.sh') continue;
      fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(scanDir, name));
    }
    fs.writeFileSync(
      path.join(scanDir, 'plot-fleet-scan.sh'),
      '#!/usr/bin/env bash\necho "scan is broken on purpose" >&2\nexit 3\n',
      { mode: 0o755 },
    );
    const server = await startServer(fx.board, { PLOT_SCRIPTS_DIR: scanDir });
    try {
      const onDisk = fs.readFileSync(
        path.join(fx.board, 'docs/plans/2026-08-21-closed-sprint.md'), 'utf8',
      );
      assert.doesNotMatch(onDisk, /wave-two/, 'the checkout must lack the second wave');
      const board = await fetchBoard(server.port);
      const card = cardFor(board, 'closed-sprint');
      assert.ok(card, 'the plan must reach the board');
      // The card must be built from the REF's two-wave plan. Asserted on the
      // waves and the PRs, not on `deliverable` alone: a board reading the
      // checkout sees ONE wave, that wave has merged, and it therefore reports
      // `deliverable: true` as well — the right answer reached from the wrong
      // plan, which would leave this test green while the defect stood.
      assert.equal(card.waveSummary.waves, 2, 'both waves must be seen — the checkout knows only one');
      assert.deepEqual(
        card.prs.map((pr) => pr.number),
        [457, 463],
        'the second wave\'s PR is the commit the checkout never saw',
      );
      assert.equal(card.status, 'deliverable', 'every wave merged → deliverable');
      assert.equal(card.deliverable, true, 'the Deliver control must be offered');
      assert.equal(card.notPushed, undefined, 'the ref carries this plan');
    } finally {
      await server.kill();
      rmTree(scanDir);
      rmTree(fx.tmp);
    }
  });

  it('reads a sprint from the ref too', async () => {
    // Item 4. A sprint feeds the release gate and the tally, so a stale one is
    // a WRONG RELEASE DECISION rather than a cosmetic lag — and sprints are
    // read by a separate function that would otherwise be left behind.
    const sprint = (phase) => `# Sprint: Spring

## Status

- **Phase:** ${phase}
- **Release:** v9.9.9

### Must Have

- [ ] [probe] the probe plan
`;
    const fx = makeSplitRepo({
      onRef: { '2026-01-01-probe.md': plan({ phase: 'Approved' }) },
      sprintOnRef: { name: '2026-W10-spring.md', content: sprint('Active') },
      sprintInTree: { name: '2026-W10-spring.md', content: sprint('Closed') },
    });
    const server = await startServer(fx.board);
    try {
      const board = await fetchBoard(server.port);
      const found = board.sprints.find((s) => s.slug === 'spring');
      assert.ok(found, 'the sprint must reach the board');
      assert.equal(found.phase, 'Active', "the ref's sprint wins over the checkout's");
    } finally {
      await server.kill();
      rmTree(fx.tmp);
    }
  });

  it('lists a plan indexed under active/ exactly once', async () => {
    // Item 11. The symlink de-duplication went away with the directory walk —
    // a mode-filtered tree listing drops the 120000 entries, so each plan is
    // named once by its real path (measured on this repo: 151 plan blobs
    // against 129 symlinks). A plan appearing twice is the regression that
    // removal invites, and it would double every card.
    const fx = makeSplitRepo({ onRef: { '2026-01-01-probe.md': plan({ phase: 'Approved' }) } });
    const ga = RUN(fx.author);
    fs.mkdirSync(path.join(fx.author, 'docs/plans/active'), { recursive: true });
    fs.symlinkSync('../2026-01-01-probe.md', path.join(fx.author, 'docs/plans/active/2026-01-01-probe.md'));
    ga('add', '-A');
    ga('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'index it');
    ga('push', '-q', 'origin', 'HEAD:main');
    RUN(fx.board)('fetch', '-q', 'origin');
    // The symlink is on the ref as a 120000 entry — proving the listing filters
    // on MODE rather than on the directory it happens to sit in.
    const modes = RUN(fx.board)('ls-tree', '-r', 'origin/main', '--', 'docs/plans/');
    assert.match(modes, /^120000 blob/m, 'the fixture must actually contain a symlink');
    const server = await startServer(fx.board);
    try {
      const board = await fetchBoard(server.port);
      const matching = cardsOf(board).filter((c) => c.slug === 'probe');
      assert.equal(matching.length, 1, 'a plan indexed under active/ must appear exactly once');
    } finally {
      await server.kill();
      rmTree(fx.tmp);
    }
  });

  it('serves a plan that is on the ref but not in the checkout', async () => {
    // Cards come from the ref, so a stale checkout renders cards for plans
    // whose FILES it has never seen. Without a ref arm in the plan viewer each
    // of those would 404 on click — the same two-sources-of-different-ages
    // defect wearing a 404.
    const fx = makeSplitRepo({ onRef: { '2026-01-01-probe.md': plan({ phase: 'Approved' }) } });
    pushToRef(fx, 'docs/plans/2026-04-04-newer.md', plan({ phase: 'Approved', title: 'Newer plan' }));
    assert.ok(
      !fs.existsSync(path.join(fx.board, 'docs/plans/2026-04-04-newer.md')),
      'the checkout must not have the file, or this proves nothing',
    );
    const server = await startServer(fx.board);
    try {
      const res = await fetchRaw(server.port, '/plan/2026-04-04-newer.md');
      assert.equal(res.status, 200, 'a card the board renders must be openable');
      assert.match(res.body, /Newer plan/);
    } finally {
      await server.kill();
      rmTree(fx.tmp);
    }
  });
});
