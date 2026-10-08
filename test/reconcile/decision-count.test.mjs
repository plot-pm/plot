// Contract test for scripts/check-decision-count.sh: the README script table's
// count of rows that still decide or orchestrate may shrink and may not grow.
// Each case runs the script in a real throwaway git repository with a bare
// remote, so the merge-base logic is the thing under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', '..', 'scripts', 'check-decision-count.sh');
const README = 'skills/plot/scripts/README.md';

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const HEADER = '| Script | Purpose | Kind | Runs | Replaced by |\n|--------|---------|------|------|-------------|\n';
const row = (name, kind, purpose = 'Does a thing', replaced = '') => `| \`${name}\` | ${purpose} | ${kind} | once per operator command | ${replaced} |\n`;
const BUNDLE_ROW = '| `board/plot-x.mjs` | A bundle row, no Kind | | | |\n';

const readme = (...rows) => `# Helper Scripts\n\n${HEADER}${rows.join('')}${BUNDLE_ROW}`;

const BASE = [
  row('a.sh', 'decision'),
  row('b.sh', 'orchestration'),
  row('c.sh', 'readings', 'reads', 'board/c.mjs'),
  row('d.sh', 'launcher', 'execs', 'board/d.mjs'),
];

const put = (work, text) => {
  mkdirSync(path.dirname(path.join(work, README)), { recursive: true });
  writeFileSync(path.join(work, README), text);
};

const commit = (work, msg) => {
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', msg);
};

/** A clone of a bare remote whose `main` holds a README with two counted rows. */
const fixture = (text = readme(...BASE)) => {
  const root = mkdtempSync(path.join(tmpdir(), 'plot-decision-count-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, work);
  git(work, 'config', 'user.name', 'Fixture');
  git(work, 'config', 'user.email', 'fixture@example.com');
  put(work, text);
  commit(work, 'initial');
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(work, 'fetch', '-q', '--no-tags', 'origin', 'main:refs/remotes/origin/main');
  return { root, work, start: git(work, 'rev-parse', 'HEAD') };
};

const run = (work, args) => {
  const r = spawnSync('bash', [script, ...args], { cwd: work, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
};

const withFixture = (fn, text) => () => {
  const f = fixture(text);
  try {
    fn(f);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
};

const change = (work, ...rows) => {
  put(work, readme(...rows));
  commit(work, 'change');
};

test('an unchanged table passes and prints both counts', withFixture(({ work }) => {
  const r = run(work, ['pr']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /: 2 scripts still decide or orchestrate now, 2 at merge base/);
}));

test('a new decision row fails', withFixture(({ work }) => {
  change(work, ...BASE, row('e.sh', 'decision'));
  const r = run(work, ['pr']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /3 scripts still decide or orchestrate now, 2 at merge base/);
  assert.match(r.out, /1 more than/);
}));

test('a new orchestration row fails', withFixture(({ work }) => {
  change(work, ...BASE, row('e.sh', 'orchestration'));
  assert.equal(run(work, ['pr']).status, 1);
}));

test('a decision to readings flip with an empty Replaced by fails', withFixture(({ work }) => {
  change(work, row('a.sh', 'readings'), ...BASE.slice(1));
  const r = run(work, ['pr']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /without evidence/);
  assert.match(r.out, /a\.sh/);
}));

test('the same flip naming a bundle passes', withFixture(({ work }) => {
  change(work, row('a.sh', 'readings', 'asks board/a.mjs', 'board/a.mjs'), ...BASE.slice(1));
  const r = run(work, ['pr']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /1 scripts still decide or orchestrate now, 2 at merge base/);
}));

test('a launcher needs the bundle in Replaced by, not in Purpose', withFixture(({ work }) => {
  change(work, row('a.sh', 'launcher', 'execs board/a.mjs'), ...BASE.slice(1));
  assert.equal(run(work, ['pr']).status, 1);
}));

test('paired naming only a rule fails', withFixture(({ work }) => {
  change(work, row('a.sh', 'paired', 'pairs with rules/a.ts'), ...BASE.slice(1));
  assert.equal(run(work, ['pr']).status, 1);
}));

test('paired naming only a corpus test fails', withFixture(({ work }) => {
  change(work, row('a.sh', 'paired', 'held by corpus/a.corpus.test.ts'), ...BASE.slice(1));
  assert.equal(run(work, ['pr']).status, 1);
}));

test('paired naming the rule and the corpus test passes', withFixture(({ work }) => {
  change(work, row('a.sh', 'paired', 'rules/a.ts held by corpus/a.corpus.test.ts'), ...BASE.slice(1));
  const r = run(work, ['pr']);
  assert.equal(r.status, 0, r.out);
}));

test('one row converted with its bundle and one new decision row is equal and passes', withFixture(({ work }) => {
  change(work, row('a.sh', 'launcher', 'execs', 'board/a.mjs'), BASE[1], BASE[2], BASE[3], row('e.sh', 'decision'));
  const r = run(work, ['pr']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /2 scripts still decide or orchestrate now, 2 at merge base/);
}));

test('a new row that starts as readings without a bundle fails', withFixture(({ work }) => {
  change(work, ...BASE, row('e.sh', 'readings'));
  assert.equal(run(work, ['pr']).status, 1);
}));

test('a purpose cell containing a pipe is read from the end', withFixture(({ work }) => {
  const piped = row('p.sh', 'decision', 'Reads a | b and c | d');
  change(work, ...BASE, piped);
  const r = run(work, ['pr']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /3 scripts still decide or orchestrate now/);
}, readme(...BASE)));

test('a pipe in a launcher purpose still reads the kind as launcher', withFixture(({ work }) => {
  const r = run(work, ['pr']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /: 1 scripts still decide or orchestrate now, 1 at merge base/);
}, readme(row('a.sh', 'launcher', 'a | b | c', 'board/a.mjs'), row('b.sh', 'decision'))));

test('a missing origin/main fails', withFixture(({ work }) => {
  git(work, 'update-ref', '-d', 'refs/remotes/origin/main');
  const r = run(work, ['pr']);
  assert.equal(r.status, 1);
  assert.match(r.out, /absent/);
}));

test('a base with no README fails and does not read as zero', withFixture(({ work }) => {
  git(work, 'rm', '-q', README);
  commit(work, 'drop readme');
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(work, 'fetch', '-q', '--no-tags', 'origin', 'main:refs/remotes/origin/main');
  put(work, readme(...BASE));
  commit(work, 'restore readme');
  const r = run(work, ['pr']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /absent/);
}));

test('a base table with no Kind header fails', withFixture(({ work }) => {
  put(work, readme(...BASE));
  commit(work, 'change');
  const r = run(work, ['pr']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /no script table with a Kind column/);
}, '# Helper Scripts\n\n| Script | Purpose |\n|---|---|\n| `a.sh` | x |\n'));

test('a table with a Kind header and no rows fails', withFixture(({ work }) => {
  const r = run(work, ['pr']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /no rows/);
}, `# Helper Scripts\n\n${HEADER}`));

test('push compares HEAD with the before SHA', withFixture(({ work, start }) => {
  change(work, ...BASE, row('e.sh', 'decision'));
  const r = run(work, ['push', start]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /push: 3 scripts still decide or orchestrate now, 2 at push start/);
}));

test('push without a before SHA fails', withFixture(({ work }) => {
  assert.equal(run(work, ['push']).status, 1);
}));

test('an unknown mode fails with usage', withFixture(({ work }) => {
  const r = run(work, ['bogus']);
  assert.equal(r.status, 1);
  assert.match(r.out, /usage/);
}));
