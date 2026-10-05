// `briefReading` reads every asker's log for the ask, and the recorded exit
// for a failure — never a process.
//
// THE DEFECT THIS COVERS: since `aa1f36296` ("a dispatch names the act it
// started", 2026-09-29) the dispatch controller writes a slice's brief through
// the implement route with `--brief-only`, logging to
// `.worktrees/plot-implement-<plan-slug>.log`. `briefAskLogPaths` named only
// the two older askers, so every brief a dispatch asked for since that date
// read as "nobody has taken it". See docs/plans/2026-10-04-a-brief-the-fleet-
// writes-shows-as-asked.md.
//
// THE ASKER-LIST TEST RUNS EACH ASKER'S OWN PATH FUNCTION, not three strings
// copied by hand — a test that lists its own paths would keep passing when a
// fourth asker logs elsewhere, which is exactly the defect measured above.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  briefAskLogPaths, briefReading, DISPATCH_SCRIPT_ASK_LOG,
} from '../../src/server/brief-ask-log.js';
import { askForBriefLogPath } from '../../src/server/brief-ask.js';
import { implementLogPath, implementStatePath } from '../../src/server/implement.js';
import { rmTree } from '../helpers.mjs';

const BRANCH = 'bug/a-brief-the-fleet-writes-shows-as-asked';
const BRANCH_SLUG = 'a-brief-the-fleet-writes-shows-as-asked';
const PLAN_SLUG = 'a-brief-the-fleet-writes-shows-as-asked';

/** The two halves of one `briefReading`, named for the row fields they fill. */
const briefAskedAt = (root: string, branch: string, planSlug: string): number | null =>
  briefReading(root, branch, planSlug).askedAt;
const briefFailed = (root: string, branch: string, planSlug: string): string | null =>
  briefReading(root, branch, planSlug).failed;

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/** A repo root under a fresh tmpdir; agent logs live beside it, in its parent. */
const repo = (): string => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-brief-ask-log-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const write = (file: string, content = ''): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

/** Sets a file's mtime to `ms` epoch milliseconds. */
const touchAt = (file: string, ms: number): void => {
  fs.utimesSync(file, ms / 1000, ms / 1000);
};

describe('briefAskLogPaths names every asker, by its own path function', () => {
  it('covers the dispatch script, the board asker, and the implement route', () => {
    const root = repo();
    const paths = briefAskLogPaths(root, BRANCH_SLUG, PLAN_SLUG);

    expect(paths).toContain(DISPATCH_SCRIPT_ASK_LOG(BRANCH_SLUG));
    expect(paths).toContain(path.relative(root, askForBriefLogPath(root, PLAN_SLUG)));
    expect(paths).toContain(path.relative(root, implementLogPath(root, PLAN_SLUG)));
    expect(paths).toHaveLength(3);
  });

  it('pins the dispatch script constant to the script\'s own line', () => {
    // A shell string a test cannot import, so the literal path is captured from
    // the script's `log="$repo_root/..."` assignment, its slug expression is
    // replaced with a placeholder, and the result is compared with the constant.
    const scriptPath = path.resolve(__dirname, '../../../../skills/plot/scripts/plot-dispatch.sh');
    const script = fs.readFileSync(scriptPath, 'utf8');
    const match = /^\s*log="\$repo_root\/(\.plot\/brief-.*\.log)"$/m.exec(script);
    expect(match).not.toBeNull();

    const literal = match![1].replace(`$(printf '%s' "\${branch##*/}")`, 'SLUG');
    expect(literal).toBe(DISPATCH_SCRIPT_ASK_LOG('SLUG'));
  });
});

describe('briefAskedAt reads the implement route\'s log beside the other two', () => {
  it('returns the implement log\'s mtime while its run is unfinished — no state file', () => {
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));
    const at = briefAskedAt(root, BRANCH, PLAN_SLUG);
    expect(at).not.toBeNull();
    expect(at).toBe(fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs);
  });

  it('returns the implement log\'s mtime when its run recorded a failure', () => {
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));
    write(implementStatePath(root, PLAN_SLUG), '1');
    expect(briefAskedAt(root, BRANCH, PLAN_SLUG)).toBe(fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs);
  });

  it('is null when the implement run recorded 0 and the brief is still missing', () => {
    // The implement log is per PLAN and a `--brief-only` run writes ONE
    // branch's brief: a finished run is not an ask for a sibling slice.
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));
    write(implementStatePath(root, PLAN_SLUG), '0');
    expect(briefAskedAt(root, BRANCH, PLAN_SLUG)).toBeNull();
    expect(briefAskedAt(root, 'feature/a-sibling-slice', PLAN_SLUG)).toBeNull();
  });

  it('reports the earliest of several asks', () => {
    const root = repo();
    write(path.join(root, DISPATCH_SCRIPT_ASK_LOG(BRANCH_SLUG)));
    const early = fs.statSync(path.join(root, DISPATCH_SCRIPT_ASK_LOG(BRANCH_SLUG))).mtimeMs;
    // Backdate the dispatch script's log so it is unambiguously earliest,
    // rather than relying on two writes in the same millisecond to order
    // themselves.
    fs.utimesSync(path.join(root, DISPATCH_SCRIPT_ASK_LOG(BRANCH_SLUG)), early / 1000 - 10, early / 1000 - 10);
    write(implementLogPath(root, PLAN_SLUG));

    const at = briefAskedAt(root, BRANCH, PLAN_SLUG);
    expect(at).toBe(fs.statSync(path.join(root, DISPATCH_SCRIPT_ASK_LOG(BRANCH_SLUG))).mtimeMs);
  });

  it('a stale failure does not set the age once another asker re-asked', () => {
    // Day 1: the implement run failed. Day 3: the dispatch script asked again.
    // The row reads the day-3 ask, not "asked 2d ago", and no failure.
    const root = repo();
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    write(implementLogPath(root, PLAN_SLUG));
    write(implementStatePath(root, PLAN_SLUG), '1');
    touchAt(implementLogPath(root, PLAN_SLUG), now - 2 * day);
    touchAt(implementStatePath(root, PLAN_SLUG), now - 2 * day);
    const dispatchLog = path.join(root, DISPATCH_SCRIPT_ASK_LOG(BRANCH_SLUG));
    write(dispatchLog);
    touchAt(dispatchLog, now);

    const reading = briefReading(root, BRANCH, PLAN_SLUG);
    expect(reading.askedAt).toBe(fs.statSync(dispatchLog).mtimeMs);
    expect(reading.failed).toBeNull();
  });

  it('answers null where none of the three askers left a log', () => {
    const root = repo();
    expect(briefAskedAt(root, BRANCH, PLAN_SLUG)).toBeNull();
  });
});

describe('briefFailed reads the recorded exit, never a process', () => {
  it('holds the log path for a non-zero recorded exit', () => {
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));
    write(implementStatePath(root, PLAN_SLUG), '1');

    expect(briefFailed(root, BRANCH, PLAN_SLUG)).toBe(path.relative(root, implementLogPath(root, PLAN_SLUG)));
  });

  it('is null for a running run — a log with no state file', () => {
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));

    expect(briefFailed(root, BRANCH, PLAN_SLUG)).toBeNull();
  });

  it('is null for a recorded exit of 0', () => {
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));
    write(implementStatePath(root, PLAN_SLUG), '0');

    expect(briefFailed(root, BRANCH, PLAN_SLUG)).toBeNull();
  });

  it('is null where no run ever happened', () => {
    const root = repo();
    expect(briefFailed(root, BRANCH, PLAN_SLUG)).toBeNull();
  });

  it('is null for an old failure when the dispatch script\'s log is newer', () => {
    const root = repo();
    const now = Date.now();
    write(implementLogPath(root, PLAN_SLUG));
    write(implementStatePath(root, PLAN_SLUG), '1');
    touchAt(implementLogPath(root, PLAN_SLUG), now - 200_000);
    touchAt(implementStatePath(root, PLAN_SLUG), now - 100_000);
    const dispatchLog = path.join(root, DISPATCH_SCRIPT_ASK_LOG(BRANCH_SLUG));
    write(dispatchLog);
    touchAt(dispatchLog, now);

    expect(briefFailed(root, BRANCH, PLAN_SLUG)).toBeNull();
  });

  it('is null for an old failure when the board asker\'s log is newer', () => {
    const root = repo();
    const now = Date.now();
    write(implementLogPath(root, PLAN_SLUG));
    write(implementStatePath(root, PLAN_SLUG), '1');
    touchAt(implementStatePath(root, PLAN_SLUG), now - 100_000);
    write(askForBriefLogPath(root, PLAN_SLUG));
    touchAt(askForBriefLogPath(root, PLAN_SLUG), now);

    expect(briefFailed(root, BRANCH, PLAN_SLUG)).toBeNull();
  });

  it('still reports the failure when the other askers\' logs are older than it', () => {
    // Compared against the LATEST other ask, not the earliest: an old dispatch
    // log does not hide a failure recorded after it.
    const root = repo();
    const now = Date.now();
    const dispatchLog = path.join(root, DISPATCH_SCRIPT_ASK_LOG(BRANCH_SLUG));
    write(dispatchLog);
    touchAt(dispatchLog, now - 300_000);
    write(implementLogPath(root, PLAN_SLUG));
    write(implementStatePath(root, PLAN_SLUG), '1');
    touchAt(implementStatePath(root, PLAN_SLUG), now);

    expect(briefFailed(root, BRANCH, PLAN_SLUG)).toBe(path.relative(root, implementLogPath(root, PLAN_SLUG)));
  });
});
