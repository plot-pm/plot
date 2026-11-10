// Which processes install the object reader: the board server does and refuses
// a git older than 2.42; a CLI bundle does not, and exits.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { SCRIPTS_DIR, boxedDir, makeRepo, rmTree, startServer } from './helpers.mjs';

const REAL_GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const made = [];

after(() => {
  for (const dir of made.splice(0)) rmTree(dir);
});

/** A git repository with one plan, its own `origin`. */
const repoWithPlan = () => {
  const repo = makeRepo({ plans: [{ name: '2026-01-01-x.md', content: '# x\n\n## Status\n\n- **State:** Draft\n' }] });
  made.push(repo);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, stdio: 'ignore' });
  git('init', '--quiet', '-b', 'main');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'x');
  git('remote', 'add', 'origin', repo);
  git('fetch', '--quiet', 'origin');
  return repo;
};

/**
 * A `git` that logs each start's arguments to `log`, answers `--version` with
 * `version` where one is given, and runs the real git otherwise.
 */
const stubGit = (version) => {
  const bin = boxedDir('plot-git-stub-');
  fs.mkdirSync(bin);
  made.push(bin);
  const log = path.join(bin, 'starts.log');
  const answer = version === undefined ? '' : `[ "$1" = "--version" ] && { echo "git version ${version}"; exit 0; }\n`;
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> "${log}"\n${answer}exec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });
  return { PATH: `${bin}:${process.env.PATH}`, log };
};

test('the board server refuses git 2.41.0 at start, naming 2.42 and the version found', async () => {
  const repo = repoWithPlan();
  const { PATH } = stubGit('2.41.0');
  await assert.rejects(
    startServer(repo, { PATH }),
    /exited \(1\) before ready[\s\S]*plot needs git 2\.42 or later for its object reader; found git 2\.41\.0/,
  );
});

test('the board server starts on git 2.42.0', async () => {
  const repo = repoWithPlan();
  const { PATH } = stubGit('2.42.0');
  const server = await startServer(repo, { PATH });
  try {
    assert.ok(server.port > 0);
  } finally {
    await server.stop();
  }
});

test('plot-ask.mjs board answers and exits with no object reader installed', () => {
  const repo = repoWithPlan();
  const { PATH, log } = stubGit();
  const run = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'board/plot-ask.mjs'), 'board'], {
    cwd: repo,
    env: { ...process.env, PATH, PLOT_REPO_ROOT: repo, PLOT_SCRIPTS_DIR: SCRIPTS_DIR },
    encoding: 'utf8',
    timeout: 60_000,
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).columns.length > 0, true);
  const starts = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  assert.doesNotMatch(starts, /cat-file --batch-command/);
  assert.doesNotMatch(starts, /^--version$/m);
});
