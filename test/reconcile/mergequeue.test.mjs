// Contract test for the merge queue: skills/plot/scripts/plot-merge-queue.sh
//
// When several workers finish at once, their PRs land in a burst and each merge
// invalidates the others' bases. The queue answers "in what order is it safe to
// merge, and what will collide?" — WITHOUT merging anything and without
// granting any agent merge rights. Knowing the safe order is most of the value.
//
// Conflict prediction uses `git merge-tree --write-tree`, which computes a
// merge in memory: no working tree, no index, nothing touched. That is what
// lets this stay read-only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const queue = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-merge-queue.sh');

let tmp, repo, report;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function commitOn(branch, file, content, msg) {
  git(repo, 'checkout', '-q', '-B', branch, 'origin/main');
  fs.writeFileSync(path.join(repo, file), content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', msg);
  git(repo, 'push', '-q', '-u', 'origin', branch);
  git(repo, 'checkout', '-q', 'main');
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-mq-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-mq.md'), `# MQ plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Implementation
- \`feature/alpha\` — touches its own file
- \`feature/beta\` — touches its own file
- \`feature/clash\` — touches the same line as alpha
`);
  fs.symlinkSync('../2026-01-01-mq.md', path.join(repo, 'plans', 'active', 'mq.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'push', '-q', 'origin', 'main');

  // alpha and beta are independent: different files, no interaction.
  commitOn('feature/alpha', 'alpha.txt', 'alpha work\n', 'alpha');
  commitOn('feature/beta', 'beta.txt', 'beta work\n', 'beta');
  // clash rewrites the same line of shared.txt that alpha also rewrites.
  git(repo, 'checkout', '-q', '-B', 'feature/alpha2', 'origin/feature/alpha');
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'alpha version\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'alpha touches shared');
  git(repo, 'push', '-q', 'origin', 'feature/alpha2:feature/alpha');
  git(repo, 'checkout', '-q', 'main');
  commitOn('feature/clash', 'shared.txt', 'clash version\n', 'clash touches shared');

  git(repo, 'fetch', '-q', 'origin');
  report = execFileSync('bash', [queue, '--offline', 'mq'], { encoding: 'utf8', cwd: repo });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('merge-queue: lists mergeable branches in an order', () => {
  assert.match(report, /feature\/alpha/);
  assert.match(report, /feature\/beta/);
  assert.match(report, /feature\/clash/);
});

test('merge-queue: independent branches are reported as clean against main', () => {
  const beta = report.split('\n').find((l) => /feature\/beta/.test(l)) ?? '';
  assert.match(beta, /clean/i);
});

test('merge-queue: predicts the collision between two branches', () => {
  // alpha and clash both rewrite shared.txt. Whichever is merged first, the
  // other must be flagged — that is the burst-landing problem the queue exists
  // to surface before it becomes a broken rebase.
  assert.match(report, /conflict/i);
  assert.match(report, /feature\/clash|feature\/alpha/);
});

test('merge-queue: emits a machine-countable summary footer', () => {
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /^summary: /);
  assert.match(footer, /ready=/);
  assert.match(footer, /conflicts=1/);
});

test('merge-queue: merges nothing and leaves the repo untouched', () => {
  // The whole point of v2: the ORDER is the product. Merge authority stays
  // with the human until the ordering has proven itself.
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
  const mainLog = git(repo, 'log', '--oneline', 'origin/main');
  assert.equal(mainLog.trim().split('\n').length, 1, 'origin/main must not advance');
});

test('merge-queue: refuses clearly on git older than 2.38', () => {
  // `merge-tree --write-tree` arrived in git 2.38. Older git HAS a merge-tree
  // with entirely different semantics (a three-way file diff), so it does not
  // fail cleanly — it succeeds and answers a different question. Every branch
  // would silently read as conflict-free. A wrong "all clean" is worse than a
  // refusal, so detect the version rather than trusting the exit code.
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-oldgit-'));
  const shim = path.join(fakeBin, 'git');
  fs.writeFileSync(shim, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "git version 2.30.0"; exit 0; fi
exec /usr/bin/git "$@"
`);
  fs.chmodSync(shim, 0o755);

  let failed = false, stderr = '';
  try {
    execFileSync('bash', [queue, '--offline', 'mq'], {
      encoding: 'utf8', cwd: repo,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
      timeout: 20_000,
    });
  } catch (e) {
    failed = true;
    stderr = String(e.stderr ?? '');
  }
  assert.ok(failed, 'must refuse on git < 2.38');
  assert.match(stderr, /2\.38/, 'must name the required version');
  fs.rmSync(fakeBin, { recursive: true, force: true });
});
