// Contract test for scripts/check-shell-lines.sh: the shell under skills/ may
// shrink and may not grow. Each case runs the script in a real throwaway git
// repository with a bare remote, so the merge-base and range logic is the
// thing under test and a mocked count could not pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', '..', 'scripts', 'check-shell-lines.sh');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const A = 'skills/x/a.sh';
const B = 'skills/x/b.sh';

/** `n` counted lines, plus a comment and a blank line that must not count. */
const body = (n) => `# comment\n\n${Array.from({ length: n }, (_, i) => `echo ${i}`).join('\n')}\n`;

const write = (work, file, n) => {
  mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
  writeFileSync(path.join(work, file), body(n));
};

const commit = (work, msg) => {
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', msg);
  return git(work, 'rev-parse', 'HEAD');
};

/** A clone of a bare remote whose `main` holds a.sh with 10 and b.sh with 5 counted lines. */
const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'plot-shell-lines-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, work);
  git(work, 'config', 'user.name', 'Fixture');
  git(work, 'config', 'user.email', 'fixture@example.com');
  write(work, A, 10);
  write(work, B, 5);
  commit(work, 'initial');
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(work, 'fetch', '-q', '--no-tags', 'origin', 'main:refs/remotes/origin/main');
  return { root, work, start: git(work, 'rev-parse', 'HEAD') };
};

const run = (work, args, env = {}) => {
  const r = spawnSync('bash', [script, ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: r.status, out: r.stdout + r.stderr };
};

const withFixture = (fn) => () => {
  const f = fixture();
  try {
    fn(f);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
};

test('pr: growth over the merge base fails and states the offset rule', withFixture(({ work }) => {
  git(work, 'checkout', '-q', '-b', 'feature');
  write(work, A, 13);
  commit(work, 'grow');
  const r = run(work, ['pr']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /3 lines over/);
  assert.match(r.out, /remove at least 3 lines/);
  assert.match(r.out, /packages\/domain/);
}));

test('pr: a net-zero change passes', withFixture(({ work }) => {
  git(work, 'checkout', '-q', '-b', 'feature');
  write(work, A, 13);
  write(work, B, 2);
  commit(work, 'move three lines');
  const r = run(work, ['pr']);
  assert.equal(r.status, 0, r.out);
}));

test('pr: a shrinking change passes', withFixture(({ work }) => {
  git(work, 'checkout', '-q', '-b', 'feature');
  write(work, A, 4);
  commit(work, 'shrink');
  assert.equal(run(work, ['pr']).status, 0);
}));

test('pr: main moving on does not charge the branch for main\'s growth', withFixture(({ work }) => {
  git(work, 'checkout', '-q', '-b', 'feature');
  write(work, B, 4);
  commit(work, 'shrink on the branch');
  git(work, 'checkout', '-q', 'main');
  write(work, A, 30);
  commit(work, 'main grows');
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(work, 'fetch', '-q', '--no-tags', 'origin', 'main:refs/remotes/origin/main');
  git(work, 'checkout', '-q', 'feature');
  assert.equal(run(work, ['pr']).status, 0);
}));

test('pr: an exact revert of a commit that grew the shell passes', withFixture(({ work }) => {
  write(work, A, 20);
  const grew = commit(work, 'grow');
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(work, 'fetch', '-q', '--no-tags', 'origin', 'main:refs/remotes/origin/main');
  git(work, 'checkout', '-q', '-b', 'rollback');
  git(work, 'revert', '--no-edit', grew);
  // the subject is deliberately not "Revert": the tree is what is recognised
  git(work, 'commit', '-q', '--amend', '-m', 'roll slice 4 back');
  const r = run(work, ['pr']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /reverses/);
}));

test('pr: a hand-written "Revert" with the wrong tree fails', withFixture(({ work }) => {
  write(work, A, 20);
  commit(work, 'grow');
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(work, 'fetch', '-q', '--no-tags', 'origin', 'main:refs/remotes/origin/main');
  git(work, 'checkout', '-q', '-b', 'rollback');
  write(work, A, 10);
  write(work, B, 25);
  commit(work, 'Revert "grow"');
  const r = run(work, ['pr']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /10 lines over/);
}));

test('push: a range whose first commit grows and second shrinks more passes as one range', withFixture(({ work, start }) => {
  write(work, A, 30);
  commit(work, 'grow');
  write(work, A, 4);
  commit(work, 'shrink more');
  const r = run(work, ['push', start]);
  assert.equal(r.status, 0, r.out);
}));

test('push: a growing range fails and names the start', withFixture(({ work, start }) => {
  write(work, A, 12);
  commit(work, 'one');
  write(work, B, 9);
  commit(work, 'two');
  const r = run(work, ['push', start]);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /6 lines over push start/);
}));

test('an unreadable base fails and names it', withFixture(({ work, start }) => {
  git(work, 'update-ref', '-d', 'refs/remotes/origin/main');
  const pr = run(work, ['pr']);
  assert.notEqual(pr.status, 0);
  assert.match(pr.out, /refs\/remotes\/origin\/main is absent/);
  const unknown = run(work, ['push', '0'.repeat(40)]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.out, /not a commit/);
  const none = run(work, ['push']);
  assert.notEqual(none.status, 0);
  assert.match(none.out, /before SHA/);
  assert.ok(start);
}));

test('no environment variable changes the answer', withFixture(({ work }) => {
  git(work, 'checkout', '-q', '-b', 'feature');
  write(work, A, 13);
  commit(work, 'grow');
  const plain = run(work, ['pr']);
  const odd = run(work, ['pr'], { CI: '', PLOT_UNATTENDED: '1', HOME: '/nonexistent/odd home', PLOT_SHELL_LINES_ALLOW: '99' });
  assert.equal(plain.status, 1);
  assert.equal(odd.status, plain.status);
  assert.equal(odd.out, plain.out);
}));

test('the count skips comments and blanks, and --per-file lists largest first', withFixture(({ work }) => {
  const r = run(work, ['--per-file']);
  assert.equal(r.status, 0, r.out);
  const lines = r.out.split('\n');
  assert.match(lines[0], /^\s+10 skills\/x\/a\.sh$/);
  assert.match(lines[1], /^\s+5 skills\/x\/b\.sh$/);
  assert.match(r.out, /total: 15 lines/);
  assert.match(r.out, /scripts\/\*\.sh .*: 0 lines/);
}));

test('the gate passes on this repository and says its count', () => {
  const repo = path.join(here, '..', '..');
  const r = spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/remotes/origin/main'], { cwd: repo });
  if (r.status !== 0) return; // no origin/main in this clone: nothing to compare
  const out = run(repo, ['pr']);
  assert.equal(out.status, 0, out.out);
  assert.match(out.out, /\d{5} lines now/);
});
