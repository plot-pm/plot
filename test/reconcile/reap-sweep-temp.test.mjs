// Contract test for `plot-reap.sh --sweep-temp` — the backstop for temp paths a
// SIGKILL left behind.
//
// The fixtures are the shapes a wrong matcher gets wrong. A dot-only matcher
// removes `plot-run.x` and misses `plot-host-pTFuyG`, the shape `mkdtempSync`
// leaves (4,850 of 4,952 real entries on 2026-09-30). A `plot*` matcher removes
// `plotter-old`. A `tmp.*` matcher removes every other program's template-less
// `mktemp` output, which a probe did by hand that same day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const reap = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-reap.sh');

const HOUR = 3600;

const age = (p, hours) => {
  const t = Date.now() / 1000 - hours * HOUR;
  utimesSync(p, t, t);
};

// A pid that is certainly not alive: a process that has already exited.
const deadPid = () => {
  const r = spawnSync('sh', ['-c', 'echo $$']);
  return Number(String(r.stdout).trim());
};

const estate = () => {
  const box = mkdtempSync(path.join(tmpdir(), 'plot-sweeptest-'));
  const tmp = path.join(box, 'T');
  const budget = path.join(box, 'budget');
  const cwd = path.join(box, 'cwd');
  mkdirSync(tmp);
  mkdirSync(path.join(budget, 'memo'), { recursive: true });
  mkdirSync(cwd);
  const dir = (rel, hours) => { const p = path.join(tmp, rel); mkdirSync(p); age(p, hours); return p; };
  const file = (rel, hours) => { const p = path.join(tmp, rel); writeFileSync(p, 'x'); age(p, hours); return p; };
  const memo = (pid, hours) => { const p = path.join(budget, 'memo', String(pid)); mkdirSync(p); age(p, hours); return p; };
  const dead = deadPid();
  const paths = {
    host: dir('plot-host-pTFuyG', 30),
    run: dir('plot-run.x', 30),
    reg: file(`plot-reg.${dead}`, 30),
    liveReg: file(`plot-reg.${process.pid}`, 30),
    young: dir('plot-host-young1', 1),
    tmpDot: dir('tmp.AbCdEf1234', 30),
    plotter: dir('plotter-old', 30),
    bare: dir('plot', 30),
    other: dir('someone-else', 30),
    deadMemo: memo(dead, 30),
    liveMemo: memo(process.pid, 30),
    youngMemo: memo(deadPid(), 1),
  };
  const run = (...args) => spawnSync('bash', [reap, '--sweep-temp', ...args], {
    encoding: 'utf8', cwd, env: { ...process.env, TMPDIR: tmp, PLOT_BUDGET_HOME: budget },
  });
  return { box, cwd, paths, run };
};

test('sweep-temp: a dry run by default reports and removes nothing', () => {
  const e = estate();
  const got = e.run();
  assert.equal(got.status, 0, got.stderr);
  assert.match(got.stdout, /would remove .*plot-host-pTFuyG/);
  assert.match(got.stdout, /temp-summary: swept=4 removed=0 .*dry_run=1/);
  for (const p of Object.values(e.paths)) assert.ok(existsSync(p), `dry run removed ${p}`);
  rmSync(e.box, { recursive: true, force: true });
});

test('sweep-temp: --yes removes old plot-* entries and dead-pid memos, and keeps everything else', () => {
  const e = estate();
  const got = e.run('--yes');
  assert.equal(got.status, 0, got.stderr);
  const { paths } = e;
  for (const gone of [paths.host, paths.run, paths.reg, paths.deadMemo]) {
    assert.equal(existsSync(gone), false, `should be removed: ${gone}\n${got.stdout}`);
  }
  for (const kept of [paths.liveReg, paths.young, paths.tmpDot, paths.plotter, paths.bare, paths.other, paths.liveMemo, paths.youngMemo]) {
    assert.equal(existsSync(kept), true, `should be kept: ${kept}\n${got.stdout}`);
  }
  assert.match(got.stdout, /temp-summary: swept=4 removed=4 kept_live=2/);
  rmSync(e.box, { recursive: true, force: true });
});

test('sweep-temp: the bound comes from the Temp sweep after key', () => {
  const e = estate();
  spawnSync('git', ['init', '-q'], { cwd: e.cwd });
  writeFileSync(path.join(e.cwd, 'CLAUDE.md'), '# x\n\n## Plot Config\n\n- **Temp sweep after:** 48\n');
  const got = e.run('--yes');
  assert.equal(got.status, 0, got.stderr);
  assert.match(got.stdout, /bound_hours=48/);
  assert.ok(existsSync(e.paths.host), 'a 30 h entry is younger than a 48 h bound');
  rmSync(e.box, { recursive: true, force: true });
});

test('sweep-temp: --max bounds the removals', () => {
  const e = estate();
  const got = e.run('--yes', '--max', '1');
  assert.equal(got.status, 0, got.stderr);
  assert.match(got.stdout, /temp-summary: swept=1 removed=1/);
  rmSync(e.box, { recursive: true, force: true });
});
