import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { removeTree } from '../rm-tree.mjs';

const GATE = join(import.meta.dirname, 'census-gate.mjs');

const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0)) removeTree(dir);
});

const git = (cwd: string, ...args: string[]): string => {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout.trim();
};

/**
 * A repository whose "product" is a file `count`, committed as `before` and
 * then as `after`. Returns the repository path. A missing count writes no file.
 */
const repo = (before: number | null, after: number): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-census-gate-'));
  sandboxes.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'census@example.invalid');
  git(dir, 'config', 'user.name', 'census');
  if (before !== null) writeFileSync(join(dir, 'count'), `${before}\n`);
  writeFileSync(join(dir, 'README'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'branch', 'base');
  writeFileSync(join(dir, 'count'), `${after}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'head');
  return dir;
};

// The census row stand-in: reads the product's count and records S4 with it,
// every image a `git rev-parse`. Records nothing when the product has no count.
const ROW = (tolerance: string): string =>
  `[ -f "$PLOT_CENSUS_PRODUCT/count" ] || exit 0; n=$(cat "$PLOT_CENSUS_PRODUCT/count"); ` +
  `printf '{"id":"S4","fixture":{"desks":3,"openPrs":5,"host":"github"},"count":%s,"unit":"execve per pass","tolerance":${tolerance},"commands":{"git rev-parse":%s}}\\n' "$n" "$n" >> "$PLOT_CENSUS_REPORT"`;

const gate = (cwd: string, run: string, ...args: string[]) =>
  spawnSync(process.execPath, [GATE, ...args, '--build', 'true', '--run', run], { cwd, encoding: 'utf8' });

describe('census-gate.mjs', () => {
  it('refuses a strict count that grew from a merge-base 0 and names the command', () => {
    const dir = repo(0, 1);

    const actual = gate(dir, ROW('"strict"'), '--base', 'base');

    expect(actual.status, actual.stdout + actual.stderr).toBe(1);
    expect(actual.stdout).toContain('FAIL S4 github desks=3 prs=5: HEAD 1, merge base 0 execve per pass; tolerance strict, limit 0');
    expect(actual.stdout).toContain('+1  git rev-parse (0 -> 1)');
    expect(git(dir, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('passes noise on a strict count whose merge base is not 0, and refuses real growth', () => {
    expect(gate(repo(1428, 1429), ROW('"strict"'), '--base', 'base').stdout).toContain(
      'ok   S4 github desks=3 prs=5: HEAD 1429, merge base 1428 execve per pass; tolerance strict→noise 10 % + 2 (base > 0)',
    );
    const grown = gate(repo(100, 120), ROW('"strict"'), '--base', 'base');
    expect(grown.status, grown.stdout + grown.stderr).toBe(1);
    expect(grown.stdout).toContain('FAIL S4 github desks=3 prs=5: HEAD 120, merge base 100 execve per pass; tolerance strict→noise 10 % + 2 (base > 0), limit 112');
  });

  it('passes growth inside the stated tolerance', () => {
    const dir = repo(10, 12);

    const actual = gate(dir, ROW('{"ratio":0.1,"plus":1}'), '--base', 'base');

    expect(actual.status, actual.stdout + actual.stderr).toBe(0);
    expect(actual.stdout).toContain('ok   S4 github desks=3 prs=5: HEAD 12, merge base 10');
  });

  it('passes a row the merge base cannot record, with one "no before" line', () => {
    const dir = repo(null, 9);

    const actual = gate(dir, ROW('"strict"'), '--before', 'base');

    expect(actual.status, actual.stdout + actual.stderr).toBe(0);
    expect(actual.stdout).toContain('S4 github desks=3 prs=5: no before');
  });

  it('fails when the census run against HEAD fails', () => {
    const dir = repo(3, 3);

    expect(gate(dir, `${ROW('"strict"')}; [ "$PLOT_CENSUS_PRODUCT" != "$(pwd)" ] || exit 1`, '--base', 'base').status).toBe(1);
  });

  it('adds no worktree when the census against HEAD fails in the one-process mode', () => {
    const dir = repo(3, 3);
    const marker = join(dir, '..', `${dir.split('/').pop()}-runs`);
    const run = `echo run >> '${marker}'; [ "$PLOT_CENSUS_PRODUCT" != "$(pwd)" ] || exit 1`;

    const actual = gate(dir, run, '--base', 'base');

    expect(actual.status, actual.stdout + actual.stderr).toBe(1);
    expect(actual.stdout).toContain('the merge base is not run');
    expect(readFileSync(marker, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(git(dir, 'worktree', 'list').split('\n')).toHaveLength(1);
    sandboxes.push(marker);
  });

  it('--only head writes HEAD report and adds no worktree', () => {
    const dir = repo(0, 4);
    const report = join(dir, '..', `${dir.split('/').pop()}-head.jsonl`);
    sandboxes.push(report);

    const actual = gate(dir, ROW('"strict"'), '--only', 'head', '--report', report);

    expect(actual.status, actual.stdout + actual.stderr).toBe(0);
    expect(readFileSync(report, 'utf8')).toContain('"count":4');
    expect(git(dir, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('--only head exits 1 when the census fails', () => {
    const dir = repo(1, 1);
    const report = join(dir, '..', `${dir.split('/').pop()}-head.jsonl`);
    sandboxes.push(report);

    expect(gate(dir, 'exit 3', '--only', 'head', '--report', report).status).toBe(1);
  });

  it('--only before writes the report from the "before" product and is not gated', () => {
    const dir = repo(7, 9);
    const report = join(dir, '..', `${dir.split('/').pop()}-before.jsonl`);
    sandboxes.push(report);

    const actual = gate(dir, `${ROW('"strict"')}; exit 1`, '--only', 'before', '--base', 'base', '--report', report);

    expect(actual.status, actual.stdout + actual.stderr).toBe(0);
    expect(readFileSync(report, 'utf8')).toContain('"count":7');
    expect(git(dir, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('--only before writes no report when the build fails', () => {
    const dir = repo(7, 9);
    const report = join(dir, '..', `${dir.split('/').pop()}-before.jsonl`);
    sandboxes.push(report);

    const actual = spawnSync(process.execPath, [GATE, '--only', 'before', '--base', 'base', '--report', report, '--build', 'false', '--run', ROW('"strict"')], { cwd: dir, encoding: 'utf8' });

    expect(actual.status, actual.stdout + actual.stderr).toBe(0);
    expect(existsSync(report)).toBe(false);
  });

  it('--compare refuses growth between two reports and reads a missing "before" as "no before"', () => {
    const dir = repo(1, 1);
    const stem = join(dir, '..', dir.split('/').pop() as string);
    const [headFile, beforeFile, missing] = [`${stem}-h.jsonl`, `${stem}-b.jsonl`, `${stem}-none.jsonl`];
    sandboxes.push(headFile, beforeFile);
    const row = (n: number) =>
      `${JSON.stringify({ id: 'S4', fixture: { desks: 3, openPrs: 5, host: 'github' }, count: n, unit: 'execve per pass', tolerance: 'strict', commands: { 'git rev-parse': n } })}\n`;
    writeFileSync(headFile, row(1));
    writeFileSync(beforeFile, row(0));

    const grown = spawnSync(process.execPath, [GATE, '--compare', headFile, beforeFile], { cwd: dir, encoding: 'utf8' });
    const none = spawnSync(process.execPath, [GATE, '--compare', headFile, missing], { cwd: dir, encoding: 'utf8' });

    expect(grown.status, grown.stdout + grown.stderr).toBe(1);
    expect(grown.stdout).toContain('FAIL S4 github desks=3 prs=5: HEAD 1, merge base 0');
    expect(none.status, none.stdout + none.stderr).toBe(0);
    expect(none.stdout).toContain('S4 github desks=3 prs=5: no before');
  });

  it('refuses --only without --report, and --compare with another half', () => {
    const dir = repo(1, 1);
    expect(gate(dir, 'true', '--only', 'head').status).toBe(2);
    expect(gate(dir, 'true', '--only', 'both', '--report', 'x').status).toBe(2);
    expect(spawnSync(process.execPath, [GATE, '--compare', 'a', 'b', '--only', 'head'], { cwd: dir, encoding: 'utf8' }).status).toBe(2);
  });

  it('refuses a call that names neither or both of --base and --before', () => {
    const dir = repo(1, 1);
    expect(gate(dir, 'true').status).toBe(2);
    expect(gate(dir, 'true', '--base', 'base', '--before', 'base').status).toBe(2);
  });
});
