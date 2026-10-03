// Contract test for scripts/main-bundles.sh: the build, compare, commit and push
// decisions behind the workflow that publishes the generated bundles on `main`.
//
// Each case runs the script against a scratch clone of a bare remote. The build
// is replaced through BUILD_CMD by a shell line that writes `VERSION`'s content
// into one bundle and touches the hand-written README, so the assertions name
// what the commit holds rather than what a build happened to emit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', '..', 'scripts', 'main-bundles.sh');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const BUNDLE = 'skills/plot/scripts/board/plot-ask.mjs';
const OTHER = 'skills/plot/scripts/board/plot-panel.mjs';
const README = 'skills/plot/scripts/board/README.md';

/** A clone of a bare remote holding a build declaring two bundles. */
const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'plot-main-bundles-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, work);
  git(work, 'config', 'user.name', 'Fixture');
  git(work, 'config', 'user.email', 'fixture@example.com');
  mkdirSync(path.join(work, 'packages/board'), { recursive: true });
  mkdirSync(path.join(work, 'skills/plot/scripts/board'), { recursive: true });
  writeFileSync(
    path.join(work, 'packages/board/build.mjs'),
    [
      `const shippedAsk = path.join(here, '../../${BUNDLE}');`,
      `const shippedPanel = path.join(here, '../../${OTHER}');`,
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(work, BUNDLE), 'v1\n');
  writeFileSync(path.join(work, OTHER), 'v1\n');
  writeFileSync(path.join(work, README), 'by hand\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'initial');
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  return { root, remote, work };
};

const build = (version) =>
  `printf '${version}\\n' > ${BUNDLE}; printf 'touched\\n' >> ${README}`;

const run = (mode, work, buildCmd) =>
  spawnSync('bash', [script, mode, work], {
    encoding: 'utf8',
    env: { ...process.env, BUILD_CMD: buildCmd },
  });

const cleanup = (root) => rmSync(root, { recursive: true, force: true });

test('a fresh tree pushes nothing and exits 0', () => {
  const { root, remote, work } = fixture();
  try {
    const before = git(remote, 'rev-parse', 'main');
    const r = run('publish', work, build('v1'));
    git(work, 'checkout', '--', README);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /fresh/);
    assert.equal(git(remote, 'rev-parse', 'main'), before);
    assert.equal(git(work, 'rev-parse', 'HEAD'), before);
  } finally {
    cleanup(root);
  }
});

test('a stale tree commits the generated paths and not the README beside them', () => {
  const { root, remote, work } = fixture();
  try {
    const r = run('publish', work, build('v2'));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), 'plot: build the board artifact');
    assert.equal(git(remote, 'diff', '--name-only', 'main~1', 'main'), BUNDLE);
    assert.match(readFileSync(path.join(work, README), 'utf8'), /touched/);
  } finally {
    cleanup(root);
  }
});

test('a refused push exits 0 without a retry or a force and keeps the newer commit', () => {
  const { root, remote, work } = fixture();
  try {
    const other = path.join(root, 'other');
    git(root, 'clone', '-q', remote, other);
    git(other, 'config', 'user.name', 'Person');
    git(other, 'config', 'user.email', 'person@example.com');
    writeFileSync(path.join(other, 'merge.txt'), 'a merge\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'a person merged');
    git(other, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    const newer = git(remote, 'rev-parse', 'main');

    const r = run('publish', work, build('v2'));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /refused/);
    assert.equal(git(remote, 'rev-parse', 'main'), newer);
  } finally {
    cleanup(root);
  }
});

test('on main a stale build warns and exits 0, and on the build commit it fails', () => {
  const { root, work } = fixture();
  try {
    const warned = run('main', work, build('v2'));
    assert.equal(warned.status, 0, warned.stdout + warned.stderr);
    assert.match(warned.stdout, /::warning::/);

    git(work, 'checkout', '--', '.');
    writeFileSync(path.join(work, BUNDLE), 'v2\n');
    git(work, 'commit', '-q', '-am', 'plot: build the board artifact');
    const failed = run('main', work, build('v3'));
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stdout, /::error::/);
  } finally {
    cleanup(root);
  }
});

test('a pull request whose build differs from its checkout warns and passes', () => {
  // SINCE bug/a-pr-carries-no-bundle: a PR's diff carries no generated path
  // (check-no-bundle-diff.sh refuses one that does), so its checkout holds
  // main's build, never its own. A PR that changes board source always
  // rebuilds to something that differs from that checked-out build — the
  // expected shape of such a PR, not a stale check-in. Failing here would
  // fail every PR that touches board source.
  const { root, work } = fixture();
  try {
    const r = run('pr', work, build('v2'));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /::warning::.*plot-ask\.mjs/);
  } finally {
    cleanup(root);
  }
});

test('the release check refuses a stale tree and passes a fresh one', () => {
  const { root, work } = fixture();
  try {
    const stale = run('release', work, build('v2'));
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    assert.match(stale.stdout, /Refusing to tag/);

    git(work, 'checkout', '--', '.');
    const fresh = run('release', work, 'true');
    assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
  } finally {
    cleanup(root);
  }
});

test('a build whose declarations cannot be found exits 2', () => {
  const { root, work } = fixture();
  try {
    writeFileSync(path.join(work, 'packages/board/build.mjs'), '// nothing\n');
    const r = run('publish', work, 'true');
    assert.equal(r.status, 2);
  } finally {
    cleanup(root);
  }
});
