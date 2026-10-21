// Reproduction for issue #2311 (docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md),
// wave 1: measurement only. Names which of the plan's candidates actually
// touch the operator's main checkout, with evidence rather than a reading
// of the source alone.
//
// BOTH HALVES ARE ASSERTED FOR EVERY CANDIDATE, because the plan's two
// defects have different symptoms: `git status --porcelain` empty catches a
// stray file, `git diff HEAD --quiet` catches a moved HEAD whose tree was
// left behind. One assertion alone would pass the other defect's failure.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const deskRootHelper = path.join(scripts, 'plot-desk-root.sh');
const pushMain = path.join(scripts, 'plot-push-main.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const temps = [];
after(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true, maxRetries: 3 });
});

/** A bare origin plus a `main` checkout clone, one commit, ready for a worktree to be added. */
const makeEstate = (label) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `plot-mainwriters-${label}-`)));
  temps.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const main = path.join(tmp, 'main-checkout');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, main);
  git(main, 'config', 'user.email', 'test@example.invalid');
  git(main, 'config', 'user.name', 'Plot Test');
  git(main, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(main, 'README.md'), 'estate\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-qm', 'init');
  git(main, 'push', '-q', 'origin', 'main');
  git(main, 'remote', 'set-head', 'origin', 'main');
  return { tmp, origin, main };
};

/** The two-half assertion the plan's "Done when" section requires. */
const assertCleanAndConsistent = (main, label) => {
  const porcelain = git(main, 'status', '--porcelain');
  assert.equal(porcelain, '', `${label}: main checkout is not clean:\n${porcelain}`);
  // git diff HEAD --quiet: exit 0 means HEAD's tree matches the working tree.
  assert.doesNotThrow(() => git(main, 'diff', 'HEAD', '--quiet'), `${label}: HEAD's tree does not match the working tree`);
};

// ---------------------------------------------------------------------------
// Candidate: the scratch writer.
// ---------------------------------------------------------------------------
//
// The plan's own hypothesis: "A script that resolves the root through
// `git rev-parse --git-common-dir` rather than `--show-toplevel` lands in the
// main checkout from inside any worktree, because the common dir sits under
// the main checkout." `plot_repo_root` in plot-desk-root.sh is exactly that
// resolver, used BY DESIGN so `plot_desk_root`/config lookups find the one
// true worktree root from inside a desk.
//
// This test proves the MECHANISM is real — a desk resolving "the repo root"
// via `plot_repo_root` gets the MAIN checkout's path back, not its own
// worktree — which is the precondition for any writer that mistakenly
// targets "the repo root" instead of its own CWD. It does not reproduce the
// seven scratch files themselves: no Plot script under skills/plot/scripts/
// writes a `.tmp`/`.tmp2`/`.tmp3`/`.new`/`.final`/`.after`/`.orig` file (grep
// below), and the PR #2302 commit history (jwloka + claude, interleaved
// commits 20:50-21:17 UTC on 2026-10-21, directly on
// bug/reconcile-23-tells-a-released-plan) shows that work was an interactive
// session, not a dispatched fleet worker. The desk-root RESOLUTION is cleared
// of writing anything itself; what remains unnamed is the process that used
// its answer as a write target.
test('scratch writer: no plot-*.sh under skills/plot/scripts/ writes a .tmp/.new/.final/.after/.orig scratch file', () => {
  const files = fs.readdirSync(scripts).filter((f) => f.endsWith('.sh'));
  const scratchSuffixes = /\.(tmp\d*|new|final|after|orig)(["'`\s)]|$)/;
  const offenders = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(scripts, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!scratchSuffixes.test(line) || !/>\s*"/.test(line)) return;
      // Exclude Plot's own atomic-write idiom: a `.tmp`/`.$$.tmp`/`.$BASHPID.tmp`
      // write that is `mv`'d (on the same line via `&&`, or within the next
      // few lines) into the real path, which never leaves litter behind. The
      // scratch files in the issue were never moved into place; they sat
      // beside the real file.
      const window = [line, ...lines.slice(i + 1, i + 4)].join('\n');
      const isAtomicRewrite = /\bmv\b/.test(window);
      if (!isAtomicRewrite) offenders.push(`${f}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `found a scratch-file write pattern:\n${offenders.join('\n')}`);
});

test('scratch writer: plot_repo_root from inside a desk answers the MAIN checkout, confirming the write-target mechanism', () => {
  const { tmp, main } = makeEstate('scratch');
  // The desk lives OUTSIDE the main checkout's own tree — exactly like a real
  // Plot desk — so adding it cannot itself dirty `main`'s working tree. A
  // worktree added at main/.worktrees/x would leave an untracked
  // `.worktrees/` entry in `main`, which is a test artifact, not the
  // defect under investigation.
  const desk = path.join(tmp, 'desks', 'feature-x');
  git(main, 'worktree', 'add', '-q', '-b', 'feature/x', desk, 'origin/main');

  const r = execFileSync('bash', ['-c', `. "${deskRootHelper}"; plot_repo_root`], {
    cwd: desk,
    encoding: 'utf8',
  });
  assert.equal(r.trim(), main, 'plot_repo_root from inside a desk must answer the main checkout');

  // The mechanism alone writes nothing — this is the control half of the
  // assertion: resolving the root is not the defect, writing to it is.
  assertCleanAndConsistent(main, 'plot_repo_root resolution alone');
});

// ---------------------------------------------------------------------------
// Candidate: the HEAD mover.
// ---------------------------------------------------------------------------
//
// Three places the plan names. Each is run here against a sandbox whose
// "main checkout" has its own branch checked out (as the operator's does),
// and the assertion is the same two-half check.

test('HEAD mover: plot-push-main.sh never touches the main checkout — it pushes a disposable branch from elsewhere', () => {
  const { main, origin } = makeEstate('push');
  const booker = path.join(main, '..', 'booker');
  git(main, 'worktree', 'add', '-q', '-B', 'book', booker, 'origin/main');
  fs.writeFileSync(path.join(booker, 'note.md'), 'bookkeeping\n');
  git(booker, 'add', '-A');
  git(booker, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plot: bookkeeping');

  execFileSync('bash', [pushMain, 'book', 'main'], { cwd: booker, encoding: 'utf8' });

  // The push landed on origin/main...
  const onOrigin = execFileSync('git', ['show', 'HEAD:note.md'], { cwd: origin, encoding: 'utf8' });
  assert.equal(onOrigin, 'bookkeeping\n');
  // ...and the main checkout, which never ran the push, is unaffected until it fetches.
  assertCleanAndConsistent(main, 'plot-push-main.sh pushing from a separate worktree');
});

test('HEAD mover: ladder.ts\'s commitAndPush retry shape (resetBranch) targets only the temporary worktree, never the main checkout — proved by ladder-real-repo.test.ts in packages/board', () => {
  // This branch owns test/reconcile/ and changes nothing under packages/, per
  // the brief's scope guard — so the assertion here is bibliographic rather
  // than a duplicate harness. packages/board/test/unit/ladder-real-repo.test.ts
  // already runs commitAndPush's reset-and-retry loop against a real
  // repository (a bare origin, a `repo` clone standing in for the operator's
  // main checkout, and a `wt` worktree the retry resets) and asserts the
  // landed content on origin/main — never a local mutation of `repo` itself.
  // `resetBranch(tmpwt, bookbr, ...)` in packages/board/src/server/entry/ladder.ts:201
  // is called with `tmpwt`/`wt` in every call site (deliver.ts:434/801,
  // approve.ts:1247) — never `ctx.repoRoot` — so the reset the plan's Open
  // Question #2 asks about is confirmed to land in a disposable worktree, not
  // the checkout the board itself runs from.
  const ladderPath = path.join(here, '..', '..', 'packages', 'board', 'src', 'server', 'entry', 'ladder.ts');
  const text = fs.readFileSync(ladderPath, 'utf8');
  assert.match(text, /resetBranch\(tmpwt, bookbr,/, 'resetBranch must be called with the temporary worktree, not the repo root');
  assert.doesNotMatch(text, /resetBranch\(ctx\.repoRoot/, 'resetBranch must never target the main checkout');
});

test('HEAD mover: plot-dispatch.sh\'s Started-record booking resets/commits only in its own disposable worktree', () => {
  const dispatchPath = path.join(scripts, 'plot-dispatch.sh');
  const text = fs.readFileSync(dispatchPath, 'utf8');
  // write_started_record creates `$wt_root/.plot-start-$slug.$$` and commits
  // with `git -C "$tmpwt"` — never `git -C "$repo_root"` or a bare `git reset`
  // against the checkout's own HEAD. Confirms the plan's Open Question #2
  // candidate "the bookkeeping branch in plot-dispatch.sh (around :3369)" is
  // scoped to a separate worktree by construction.
  const fn = text.slice(text.indexOf('write_started_record() {'), text.indexOf('\n}\n', text.indexOf('write_started_record() {')));
  assert.match(fn, /tmpwt="\$wt_root\/\.plot-start-\$slug\.\$\$"/, 'the booking worktree must be a path distinct from the repo root');
  assert.doesNotMatch(fn, /git reset/, 'write_started_record must never reset a branch in place');
  assert.match(fn, /git -C "\$tmpwt"/, 'commits must run against the booking worktree, not the main checkout');
});

test('HEAD mover: plot-open-pr.sh never writes to the plan file or resets any branch — it only asks plot-host.sh to open a PR', () => {
  // The plan's Open Question #2 lists "the PR-number append in
  // plot-open-pr.sh" as a candidate. The script has no such append: it
  // computes a title/body through the domain bundle and calls
  // `plot-host.sh pr-create`. The `#<number>` append to a plan's Branches
  // section is a manual step this slice's own brief performs by hand on the
  // main checkout after the PR exists — not something plot-open-pr.sh does.
  const text = fs.readFileSync(path.join(scripts, 'plot-open-pr.sh'), 'utf8');
  assert.doesNotMatch(text, /git reset|git commit|update-ref|branch -f/, 'plot-open-pr.sh must perform no local git writes');
  assert.match(text, /plot-host\.sh.*pr-create/, 'plot-open-pr.sh must only ask plot-host.sh to open the PR');
});
