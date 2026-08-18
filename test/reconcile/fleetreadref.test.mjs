// Contract test for the ref plot-fleet-scan.sh NAMES versus the ref it READS.
//
// The scan derives every fact from `origin/$MAIN`, but once labelled its
// report with local `HEAD`. On `main` right after a fetch those agree, so a
// test written in the common case passes against the buggy code and proves
// nothing. This file therefore CONSTRUCTS the divergence: a second clone
// pushes to origin, the first clone fetches WITHOUT fast-forwarding, and the
// banner is asserted to name the ref that was actually read.
//
// Measured 2026-08-18, standing on a diverged checkout:
//   scan header: plot-fleet pulse — 91a9a60 on origin/main
//   origin/main: ee199aa
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

let tmp, repo, localHead, readRef, report, payload;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

const CONFIG = `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
`;

const PLAN = `# Diverging plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/one\` — the only implementation branch
`;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-readref-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), CONFIG);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-diverge.md'), PLAN);
  fs.symlinkSync('../2026-01-01-diverge.md', path.join(repo, 'plans', 'active', 'diverge.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');

  // THE DIVERGENCE. A second clone stands in for the other agents that were
  // pushing during the live dispatch this bug was found in. The first clone
  // fetches but never merges, so `origin/main` moves ahead while the checkout
  // stays where the operator left it — the exact shape of the real failure.
  const other = path.join(tmp, 'other');
  git(tmp, 'clone', '-q', origin, other);
  git(other, 'config', 'user.email', 'test@example.invalid');
  git(other, 'config', 'user.name', 'Plot Test');
  git(other, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(other, 'advance.txt'), 'pushed by someone else\n');
  git(other, 'add', '-A');
  git(other, 'commit', '-qm', 'advance main');
  git(other, 'push', '-q', 'origin', 'main');

  git(repo, 'fetch', '-q', 'origin');
  localHead = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  readRef = git(repo, 'rev-parse', '--short', 'origin/main').trim();

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  payload = JSON.parse(
    execFileSync('bash', [scan, '--offline', '--json'], { encoding: 'utf8', cwd: repo }),
  );
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('readref: the sandbox actually diverges', () => {
  // Guard on the guard. If this ever passes trivially the assertions below
  // stop testing anything, and they would keep reporting green while doing it.
  assert.notEqual(localHead, readRef);
});

test('readref: the banner names the ref that was read, not the local checkout', () => {
  const banner = report.trim().split('\n')[0];
  assert.match(banner, new RegExp(`${readRef} on origin/main`));
  assert.doesNotMatch(banner, new RegExp(`${localHead} on origin/main`));
});

test('readref: a diverging checkout is stated, not left silent', () => {
  // The operator's tree and this report describe different worlds. Naming the
  // read ref correctly is only half the fix — saying nothing about the gap
  // leaves the reader to assume there is none.
  const banner = report.trim().split('\n')[0];
  assert.match(banner, new RegExp(localHead));
});

test('readref: --json carries read_ref and local_head as distinct facts', () => {
  assert.equal(payload.read_ref, readRef);
  assert.equal(payload.local_head, localHead);
  assert.notEqual(payload.read_ref, payload.local_head);
});

test('readref: --json keeps head as an alias for one release', () => {
  // The board reads `head` today. Renaming a field out from under a live
  // consumer is a break nobody asked for; it goes away once the board reads
  // the pair above.
  assert.equal(payload.head, payload.local_head);
});

test('readref: an unresolvable origin ref reports unknown, never HEAD', () => {
  // A fresh clone with no remote is where this bug is HARDEST to notice: with
  // nothing to compare against, a plausible-looking SHA is simply believed.
  // "unknown" gets investigated in seconds. Falling back to HEAD here would
  // reintroduce the whole bug in its least visible form.
  const solo = path.join(tmp, 'solo');
  git(tmp, 'init', '-q', '-b', 'main', solo);
  git(solo, 'config', 'user.email', 'test@example.invalid');
  git(solo, 'config', 'user.name', 'Plot Test');
  git(solo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(solo, 'CLAUDE.md'), CONFIG);
  fs.mkdirSync(path.join(solo, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(solo, 'plans', '2026-01-01-diverge.md'), PLAN);
  fs.symlinkSync('../2026-01-01-diverge.md', path.join(solo, 'plans', 'active', 'diverge.md'));
  git(solo, 'add', '-A');
  git(solo, 'commit', '-qm', 'plan');
  const soloHead = git(solo, 'rev-parse', '--short', 'HEAD').trim();

  const soloReport = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: solo });
  const banner = soloReport.trim().split('\n')[0];
  assert.match(banner, /unknown on origin\/main/);
  assert.doesNotMatch(banner, new RegExp(`${soloHead} on origin/main`));

  const soloPayload = JSON.parse(
    execFileSync('bash', [scan, '--offline', '--json'], { encoding: 'utf8', cwd: solo }),
  );
  assert.equal(soloPayload.read_ref, 'unknown');
  assert.equal(soloPayload.local_head, soloHead);
});
