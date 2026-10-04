// `briefAskedAt` reads every asker's log, and `briefFailed` reads a recorded
// exit — never a process.
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
  briefAskedAt, briefAskLogPaths, briefFailed, DISPATCH_SCRIPT_ASK_LOG,
} from '../../src/server/brief-ask-log.js';
import { askForBriefLogPath } from '../../src/server/brief-ask.js';
import { implementLogPath, implementStatePath } from '../../src/server/implement.js';
import { rmTree } from '../helpers.mjs';

const BRANCH = 'bug/a-brief-the-fleet-writes-shows-as-asked';
const BRANCH_SLUG = 'a-brief-the-fleet-writes-shows-as-asked';
const PLAN_SLUG = 'a-brief-the-fleet-writes-shows-as-asked';

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/** A repo root under a fresh tmpdir; agent logs live beside it, in its parent. */
function repo(): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-brief-ask-log-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function write(file: string, content = ''): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

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
    // A shell string a test cannot import, so the script's TEXT is read and the
    // constant's directory, prefix and suffix are asserted against it — a
    // changed shell path then fails this test rather than the operator's board.
    // `plot-dispatch.sh:805` composes its slug in shell
    // (`${branch##*/}`), so only the literal parts around it are compared.
    const scriptPath = path.resolve(__dirname, '../../../../skills/plot/scripts/plot-dispatch.sh');
    const script = fs.readFileSync(scriptPath, 'utf8');
    const line = script.split('\n').find((l) => l.includes('.plot/brief-') && l.includes('.log"'));
    expect(line).toBeDefined();

    const constantPath = DISPATCH_SCRIPT_ASK_LOG('SLUG');
    const [dirAndPrefix, suffix] = constantPath.split('SLUG');
    expect(line).toContain(dirAndPrefix);
    expect(line).toContain(suffix);
  });
});

describe('briefAskedAt reads the implement route\'s log beside the other two', () => {
  it('returns the implement log\'s mtime when it is the only ask', () => {
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));
    const at = briefAskedAt(root, BRANCH, PLAN_SLUG);
    expect(at).not.toBeNull();
    expect(at).toBe(fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs);
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

  it('answers null where none of the three askers left a log', () => {
    const root = repo();
    expect(briefAskedAt(root, BRANCH, PLAN_SLUG)).toBeNull();
  });
});

describe('briefFailed reads the recorded exit, never a process', () => {
  it('holds the log path for a non-zero recorded exit after the ask', () => {
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));
    const askedAt = fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs;
    write(implementStatePath(root, PLAN_SLUG), '1');

    expect(briefFailed(root, PLAN_SLUG, askedAt)).toBe(path.relative(root, implementLogPath(root, PLAN_SLUG)));
  });

  it('is null for a running run — a log with no state file', () => {
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));
    const askedAt = fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs;

    expect(briefFailed(root, PLAN_SLUG, askedAt)).toBeNull();
  });

  it('is null for a recorded exit of 0', () => {
    const root = repo();
    write(implementLogPath(root, PLAN_SLUG));
    const askedAt = fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs;
    write(implementStatePath(root, PLAN_SLUG), '0');

    expect(briefFailed(root, PLAN_SLUG, askedAt)).toBeNull();
  });

  it('is null where nothing asked at all', () => {
    const root = repo();
    expect(briefFailed(root, PLAN_SLUG, null)).toBeNull();
  });

  it('is null for an exit recorded BEFORE the ask — an old failure, not this one', () => {
    // The implement log is per PLAN and outlives any one run, so an earlier
    // slice's failed attempt must not be read as THIS ask's writer failing.
    const root = repo();
    write(implementStatePath(root, PLAN_SLUG), '1');
    const oldExit = fs.statSync(implementStatePath(root, PLAN_SLUG)).mtimeMs;
    // The new ask's log, written after the old exit was recorded.
    fs.utimesSync(implementStatePath(root, PLAN_SLUG), oldExit / 1000 - 100, oldExit / 1000 - 100);
    write(implementLogPath(root, PLAN_SLUG));
    const askedAt = fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs;

    expect(briefFailed(root, PLAN_SLUG, askedAt)).toBeNull();
  });
});
