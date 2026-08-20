import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dispatchLog,
  dispatchLogExists,
  dispatchLogPath,
  type DispatchLog,
} from '../../src/server/dispatch.js';

/**
 * THE DISPATCHER LOG, keyed by SLUG and read by a knowable path.
 *
 * Unlike the worker log, this file's address is `dispatchLogPath` and nothing
 * else — no worktree lookup, no request string joined onto a directory. The
 * slug is validated at the route (`SLUG_RE`), so these tests exercise the read
 * and the presence check against a real file, and leave path-traversal to the
 * route contract where the validation lives.
 *
 * The load-bearing distinction here is `no-log` vs an EMPTY log: a plan nobody
 * has dispatched has no file (`no-log`), while a dispatch that has only just
 * started has an empty one (`ok: true, text: ''`). Collapsing the two would put
 * *nobody has clicked* and *the click is in flight* in the same shape — and the
 * Status entry's whole reason to exist is telling those apart.
 */
let repoRoot: string;
let parent: string;

beforeEach(() => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-log-'));
  // The log lives BESIDE the repo (`<repo>/../plot-dispatch-<slug>.log`), so the
  // repo is a directory under a parent this test owns and can write into.
  repoRoot = path.join(parent, 'repo');
  fs.mkdirSync(repoRoot);
});

afterEach(() => {
  fs.rmSync(parent, { recursive: true, force: true });
});

const opts = () => ({ repoRoot }) as unknown as Parameters<typeof dispatchLog>[0];

/** Write a dispatcher log for a slug, returning its path. */
function writeLog(slug: string, contents: string): string {
  const p = dispatchLogPath(repoRoot, slug);
  fs.writeFileSync(p, contents);
  return p;
}

describe('dispatchLog reads the per-slug dispatcher log', () => {
  it('reports no-log where the plan was never dispatched', () => {
    const log = dispatchLog(opts(), 'never-clicked');
    expect(log.ok).toBe(false);
    if (!log.ok) {
      expect(log.reason).toBe('no-log');
      // The path is still named — it is the answer to *then where would it be*.
      expect(log.path).toBe(dispatchLogPath(repoRoot, 'never-clicked'));
    }
  });

  it('reads an empty log as a SUCCESS, not a miss', () => {
    // A dispatch that has just opened the file and written nothing yet. This is
    // the case the whole Status entry exists to distinguish from *no dispatch*.
    writeLog('just-started', '');
    const log = dispatchLog(opts(), 'just-started');
    expect(log.ok).toBe(true);
    if (log.ok) {
      expect(log.text).toBe('');
      expect(log.bytes).toBe(0);
      expect(log.truncated).toBe(false);
    }
  });

  it('returns the log text and its slug', () => {
    writeLog('did-run', 'dispatched=1 started=1\nworker pid 5501\n');
    const log = dispatchLog(opts(), 'did-run');
    expect(log.ok).toBe(true);
    if (log.ok) {
      expect(log.slug).toBe('did-run');
      expect(log.text).toContain('dispatched=1 started=1');
      expect(log.text).toContain('worker pid 5501');
      expect(log.bytes).toBeGreaterThan(0);
    }
  });

  it('reports unreadable where the name is a directory, not a file', () => {
    // A directory at the log path opens fine and reads as garbage; `unreadable`
    // is the honest word, distinct from `no-log`.
    fs.mkdirSync(dispatchLogPath(repoRoot, 'is-a-dir'));
    const log = dispatchLog(opts(), 'is-a-dir');
    expect(log.ok).toBe(false);
    if (!log.ok) expect(log.reason).toBe('unreadable');
  });

  it('never answers no-worktree — the path needs none', () => {
    // The narrowed miss union is a property worth asserting: a dispatcher log's
    // address is knowable without a checkout, so the worktree-absence answer the
    // worker log gives cannot occur here.
    const miss = dispatchLog(opts(), 'absent') as Extract<DispatchLog, { ok: false }>;
    expect(miss.reason).not.toBe('no-worktree');
  });
});

describe('dispatchLogExists is the presence signal, a stat not a read', () => {
  it('is false before any dispatch', () => {
    expect(dispatchLogExists(repoRoot, 'untouched')).toBe(false);
  });

  it('is true once a dispatcher log exists — even an empty one', () => {
    // Presence, not content: the item is offered *whenever a dispatcher log
    // exists*, and an in-flight dispatch's empty log is a log that exists.
    writeLog('has-log', '');
    expect(dispatchLogExists(repoRoot, 'has-log')).toBe(true);
  });
});
