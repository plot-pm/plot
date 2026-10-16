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
