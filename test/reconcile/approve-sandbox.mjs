// The shared scratch-repo builder behind the `approve*.test.mjs` suites.
//
// Five of the six files built the same bare-origin-plus-clone sandbox by hand:
// `git init --bare`, clone, set `user.email`/`user.name`/`commit.gpgsign`,
// write `CLAUDE.md`'s `## Plot Config`, write the plan file, symlink it into
// `docs/plans/active/`, commit, push to origin main, `remote set-head`. This
// factors out ONLY that construction — each file's own plan body, config
// keys, host-stub shape and assertions are unchanged.
//
// `approve-batch.test.mjs` is not a caller: its `makeBatch` builds a batch
// branch with two plans and a second merge-clone, a fixture this helper does
// not attempt to generalize into.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A fresh bare origin plus a clone with the plan committed and pushed to
 * `main`. Returns the clone path (`repo`) and the bare origin path
 * (`origin`); the caller tracks both for cleanup.
 *
 * @param prefix `mkdtemp` prefix, so each suite's scratch dirs stay identifiable.
 * @param claudeMd the whole `CLAUDE.md` contents (varies per suite's `## Plot Config` keys).
 * @param planRel plan file path relative to the repo root.
 * @param planBody the plan file's contents.
 * @param activeLinkName symlink name under `docs/plans/active/`, or `null` to skip the symlink (a plan the suite does not activate).
 * @param gitUserName `user.name` for the commit — some suites assert this is never read back.
 * @param extraFiles additional `{ relativePath: contents }` entries written and committed alongside the plan.
 */
export const makeApproveSandbox = ({
  prefix,
  claudeMd,
  planRel,
  planBody,
  activeLinkName,
  gitUserName = 'Plot Test',
  extraFiles = {},
}) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', gitUserName);
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), claudeMd);
  fs.mkdirSync(path.join(repo, path.dirname(planRel)), { recursive: true });
  fs.writeFileSync(path.join(repo, planRel), planBody);
  if (activeLinkName) {
    fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
    fs.symlinkSync(path.join('..', path.basename(planRel)), path.join(repo, 'docs', 'plans', 'active', activeLinkName));
  }
  for (const [rel, body] of Object.entries(extraFiles)) {
    fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');

  return { tmp, origin, repo };
};

/**
 * Pushes a real plan-PR head that carries the plan file, and returns its
 * full sha for a stubbed host to name as the plan PR's head.
 *
 * `plot-approve.sh` reads the plan at the plan PR's head: git must hold that
 * head, the head must change the plan file against its merge base with
 * `main`, and the checkout's copy must equal the head's copy. The sandbox
 * commits the plan straight onto `main`, so this helper appends one marker
 * comment to the plan twice: once as a new `main` commit, which the checkout
 * then holds, and once as a sibling commit on the old `main` tip, pushed as
 * `branch`. Both commits hold the same text, and the head still diffs as
 * changing the plan.
 *
 * @param tmp the sandbox directory; the scratch worktree is created inside it.
 * @param repo the sandbox clone.
 * @param planRel plan file path relative to the repo root.
 * @param branch the plan PR's head branch, `idea/<slug>` unless the plan is `Impl: same branch`.
 * @param label text of the marker comment.
 * @returns the full sha of the pushed head.
 */
export const pushPlanHead = ({ tmp, repo, planRel, branch, label = 'plan head' }) => {
  const parent = git(repo, 'rev-parse', 'main').trim();
  const marked = `${fs.readFileSync(path.join(repo, planRel), 'utf8')}<!-- ${label} -->\n`;

  fs.writeFileSync(path.join(repo, planRel), marked);
  git(repo, 'commit', '-qam', `plan on main (${label})`);
  git(repo, 'push', '-q', 'origin', 'main');

  const scratch = fs.mkdtempSync(path.join(tmp, 'plan-head-'));
  try {
    git(repo, 'worktree', 'add', '-q', '--detach', scratch, parent);
    fs.writeFileSync(path.join(scratch, planRel), marked);
    git(scratch, 'commit', '-qam', `plan head (${label})`);
    const sha = git(scratch, 'rev-parse', 'HEAD').trim();
    git(scratch, 'push', '-qf', 'origin', `${sha}:refs/heads/${branch}`);
    return sha;
  } finally {
    git(repo, 'worktree', 'remove', '-f', scratch);
  }
};
