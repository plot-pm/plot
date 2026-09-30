// Contract test for plot-reconcile-scan.sh section 25 — the three advisory
// counts for what a killed process left: temp entries the sweep would remove,
// fleet-scan caches earlier releases left as `tmp.*`, and broken ledger locks.
//
// Each count must sit below `== blocking sections end ==`, and the legacy count
// must never print a removal command, because `tmp.*` is every template-less
// `mktemp` on the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

const age = (p, hours) => {
  const t = Date.now() / 1000 - hours * 3600;
  fs.utimesSync(p, t, t);
};

const fixture = () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scantemp-'));
  const repo = path.join(box, 'repo');
  const T = path.join(box, 'T');
  const budget = path.join(box, 'budget');
  fs.mkdirSync(repo);
  fs.mkdirSync(T);
  fs.mkdirSync(budget);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  const run = () => execFileSync('bash', [scan, '--offline'], {
    encoding: 'utf8', cwd: repo, env: { ...process.env, TMPDIR: T, PLOT_BUDGET_HOME: budget },
  });
  return { box, T, budget, run };
};

const section25 = (report) => {
  const start = report.indexOf('== 25.');
  const end = report.indexOf('\n== ', start + 1);
  return report.slice(start, end === -1 ? undefined : end);
};

test('scan: section 25 reads zero on a clean machine, and an absent lock record is zero', () => {
  const f = fixture();
  const report = f.run();
  fs.rmSync(f.box, { recursive: true, force: true });
  assert.match(report, /temp_sweepable=0 legacy_tmp_caches=0 broken_locks=0 /);
  assert.match(section25(report), /\(none/);
});

test('scan: section 25 counts sweepable entries, legacy caches and broken locks, below the blocking marker', () => {
  const f = fixture();
  for (const name of ['plot-host-pTFuyG', 'plot-run.x']) {
    const p = path.join(f.T, name);
    fs.mkdirSync(p);
    age(p, 30);
  }
  // Two fleet-scan caches from an earlier release, and one tmp.* that is not
  // Plot's: only the marker files make a tmp.* directory a legacy cache.
  for (const [name, marker] of [['tmp.AAAAAAAAAA', '.list-arrived'], ['tmp.BBBBBBBBBB', 'pr-list-open.json'], ['tmp.CCCCCCCCCC', 'other']]) {
    fs.mkdirSync(path.join(f.T, name));
    fs.writeFileSync(path.join(f.T, name, marker), '');
  }
  fs.writeFileSync(path.join(f.budget, 'budget-lock-broken.tsv'), 'a\t1\t12\nb\t2\t15\nc\t3\t11\n');

  const report = f.run();
  const blockingEnd = report.indexOf('== blocking sections end ==');
  fs.rmSync(f.box, { recursive: true, force: true });

  assert.match(report, /temp_sweepable=2 legacy_tmp_caches=2 broken_locks=3 /);
  assert.ok(blockingEnd !== -1 && report.indexOf('== 25.') > blockingEnd, 'section 25 is advisory');
  const s = section25(report);
  assert.match(s, /remove: plot-reap\.sh --sweep-temp --yes/);
  assert.match(s, /2 fleet-scan cache/);
  assert.doesNotMatch(s, /rm |trash /, 'no removal command for tmp.* entries');
});
