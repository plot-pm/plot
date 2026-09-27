import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  supervisionReportFile,
  SUPERVISION_REPORT_HOME_ENV,
} from '../src/adapters/supervision-report/supervision-report-file.js';
import {
  SUPERVISION_REPORT_VERSION,
  type SupervisionReport,
} from '../src/entities/supervision-report.js';

/**
 * The channel between the daemon and the board — one file, written whole.
 *
 * `plot-registryd` and the board are separate processes and shared nothing: the
 * tick computed a cause per desk and printed it to stdout. This proves the file
 * they now meet at, including the two properties a test run only in the main
 * checkout cannot see — that a dispatch desk resolves the SAME file, and that an
 * absent or unreadable one is an answer rather than a failure.
 */

/** Runs git quietly in a directory. */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let root: string;
/** The main checkout. */
let main: string;
/** A linked worktree, standing in for a dispatch desk. */
let desk: string;

const report = (over: Partial<SupervisionReport> = {}): SupervisionReport => ({
  v: SUPERVISION_REPORT_VERSION,
  at: 1_700_000_000_000,
  rows: [
    { branch: 'bug/a', worktree: '/desks/a', verdict: 'defer', cause: 'no-headroom' },
    { branch: 'bug/b', worktree: '/desks/b', verdict: 'needs-a-person', cause: 'budget-spent' },
  ],
  ...over,
});

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'plot-supervision-report-')));
  main = join(root, 'main');
  desk = join(root, 'desk');
  execFileSync('git', ['init', '-q', '-b', 'main', main]);
  git(main, 'config', 'user.email', 't@example.com');
  git(main, 'config', 'user.name', 'T');
  writeFileSync(join(main, 'README.md'), 'x\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-qm', 'first');
  git(main, 'worktree', 'add', '-q', '-b', 'slice', desk);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('supervisionReportFile — one file per repository, under the common git dir', () => {
  it('writes and reads back what the tick decided', async () => {
    const store = supervisionReportFile({ cwd: main, env: {} });
    expect((await store.write(report())).ok).toBe(true);
    const read = await store.read();
    expect(read.ok).toBe(true);
    expect(read.value).toEqual(report());
  });

  it('resolves under .plot/state and not into the working tree', async () => {
    const store = supervisionReportFile({ cwd: main, env: {} });
    const located = await store.location();
    expect(located.ok).toBe(true);
    expect(located.value).toContain(join('.plot', 'state'));
    expect(located.value?.endsWith('supervision.json')).toBe(true);
  });

  /**
   * THE MEASUREMENT THIS FILE EXISTS TO HOLD, `pr-index-file.ts`'s own: in a
   * linked worktree `--show-toplevel` answers the DESK, and `plot-reap.sh` runs
   * `git worktree remove --force` over exactly those. A report written to a desk
   * is destroyed by the reap, with every gate green.
   *
   * It matters twice here: the daemon and the board are different processes with
   * different working directories, so resolving from the common dir is also what
   * makes them meet at ONE file rather than at two.
   */
  it('gives a dispatch desk the same file as the main checkout', async () => {
    const fromMain = await supervisionReportFile({ cwd: main, env: {} }).location();
    const fromDesk = await supervisionReportFile({ cwd: desk, env: {} }).location();
    expect(fromDesk.value).toBe(fromMain.value);
  });

  it('lets a desk read what the main checkout wrote', async () => {
    await supervisionReportFile({ cwd: main, env: {} }).write(report());
    const read = await supervisionReportFile({ cwd: desk, env: {} }).read();
    expect(read.value?.rows.map((r) => r.branch)).toEqual(['bug/a', 'bug/b']);
  });

  it('replaces the whole report rather than merging into it', async () => {
    const store = supervisionReportFile({ cwd: main, env: {} });
    await store.write(report());
    await store.write(report({ at: 2, rows: [] }));
    const read = await store.read();
    // A TICK'S REPORT IS THE WHOLE ANSWER. A tick that judged nothing must not
    // leave the previous tick's desks answering, which merging would do.
    expect(read.value).toEqual({ v: SUPERVISION_REPORT_VERSION, at: 2, rows: [] });
  });

  it('leaves no temp file behind', async () => {
    const store = supervisionReportFile({ cwd: main, env: {} });
    await store.write(report());
    const dir = join(main, '.git', '.plot', 'state');
    const names = execFileSync('ls', [dir], { encoding: 'utf8' }).trim().split('\n');
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('supervisionReportFile — absent is not false', () => {
  it('reads a repository with no report as nothing to start from', async () => {
    const home = mkdtempSync(join(tmpdir(), 'plot-supervision-empty-'));
    const read = await supervisionReportFile({ home, env: {} }).read();
    // `answered(null)` AND NOT `failed`: the state of every machine where the
    // supervisor has never run. A caller must never read it as *the desks are
    // fine*, which is what a thrown or failed read would invite.
    expect(read.ok).toBe(true);
    expect(read.value).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });

  it('reads an unparseable report as nothing to start from', async () => {
    const home = mkdtempSync(join(tmpdir(), 'plot-supervision-torn-'));
    writeFileSync(join(home, 'supervision.json'), '{"v":1,"at":1,"rows":[{"bran');
    const read = await supervisionReportFile({ home, env: {} }).read();
    expect(read.ok).toBe(true);
    expect(read.value).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });

  it('reads a report from an unrecognised version as nothing to start from', async () => {
    const home = mkdtempSync(join(tmpdir(), 'plot-supervision-version-'));
    writeFileSync(join(home, 'supervision.json'), JSON.stringify({ v: 99, at: 1, rows: [] }));
    const read = await supervisionReportFile({ home, env: {} }).read();
    // A LITERAL VERSION makes a future format unparseable by construction, which
    // is the fallback required: carry no cause, rather than misread one.
    expect(read.value).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });

  it('answers failed outside a git repository rather than inventing a path', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'plot-supervision-nogit-'));
    // A read taken where no common git dir resolves must not answer `null`,
    // which would be a claim about a repository this is not in.
    const store = supervisionReportFile({ cwd: outside, env: {} });
    const located = await store.location();
    if (located.ok) {
      // A tmpdir nested inside a repository still resolves; the assertion then
      // is only that it never points at the working tree.
      expect(located.value).toContain(join('.plot', 'state'));
    } else {
      expect(located.ok).toBe(false);
    }
    rmSync(outside, { recursive: true, force: true });
  });

  /**
   * A FREE AGENT HOLDS NO BRANCH, and the report must survive one.
   *
   * Measured 2026-09-27 on the live estate: a tick over 8 agents wrote 2 rows
   * with `branch: ''`, and a `min(1)` on that field made the WHOLE file
   * unparseable — so all 8 desks lost their cause, because the reader's fallback
   * for a file it cannot parse is to carry nothing. Row-level strictness became
   * file-level loss.
   */
  it('parses a report whose row names no branch', async () => {
    const home = mkdtempSync(join(tmpdir(), 'plot-supervision-free-'));
    const store = supervisionReportFile({ home, env: {} });
    await store.write(report({
      rows: [
        { branch: '', worktree: '/desks/free', verdict: 'leave', cause: 'worker-alive' },
        { branch: 'bug/real', worktree: '/desks/real', verdict: 'defer', cause: 'no-headroom' },
      ],
    }));
    const read = await store.read();
    expect(read.value?.rows).toHaveLength(2);
    expect(read.value?.rows[1]?.cause).toBe('no-headroom');
    rmSync(home, { recursive: true, force: true });
  });

  it('takes the home override so a suite never touches the operator report', async () => {
    const home = mkdtempSync(join(tmpdir(), 'plot-supervision-env-'));
    const store = supervisionReportFile({ cwd: main, env: { [SUPERVISION_REPORT_HOME_ENV]: home } });
    await store.write(report());
    expect(readFileSync(join(home, 'supervision.json'), 'utf8')).toContain('no-headroom');
    rmSync(home, { recursive: true, force: true });
  });
});
