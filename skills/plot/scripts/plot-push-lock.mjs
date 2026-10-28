#!/usr/bin/env node
// The default-branch write lock behind `plot-push-main.sh` (#1349).
//
// Usage: plot-push-lock.mjs take <holder> <action>
//        plot-push-lock.mjs release <holder>
//        <holder> is a pid, or a board holder `<pid>.<seq>`.
// Exit:  take — 0 once the lock is held; 6 where one holder stays past
//        PLOT_PUSH_LOCK_WAIT seconds (default 120) without the lock changing
//        hands, naming the holder's pid and action on stderr.
//        release — 0 always; removes the lock only where its owner line names
//        <holder>.
//
// Measured 2026-10-07: a 4-plan /api/release batch ended 4 of 4 `push=rejected`
// and a 6-plan /api/approve batch ended 3 rejected, 1 bypassed, 1 micro-pr and
// 1 refused, because both routes start their scripts in the background. The same
// batches run one at a time landed every plan.
//
// The lock is a directory under the COMMON git dir, so every worktree of one
// repository contends for it. `mkdir` is atomic and fails where the name is
// taken; `flock` is not shipped on macOS. Its `owner` file holds
// `holder<TAB>taken-at-ms<TAB>action`.
//
// PLOT_PUSH_LOCK_WAIT IS A NO-PROGRESS BOUND, NOT A TOTAL WAIT (the-push-
// lock-spans-the-booking). Spanning the lock across the fetch, the commit and
// the push (callers now take it before any of that, not just around the push
// line) means a queue of N writers each holding the lock for several seconds
// can legitimately take N times that to drain — measured 2026-10-28, 52
// pushes over roughly 340 s, well past the 120 s bound even though the queue
// never stalled. So `take()` resets its own clock every time the owner file's
// `pid`/`taken-at` changes, and only times out where ONE holder sits unchanged
// for the whole bound — a hung push, not a moving queue.
//
// STALE IS A DEAD PID, or a live one older than PLOT_PUSH_LOCK_STALE_S (default
// 600). `plot-budget.sh` uses 10 s because its lock spans one rename; a push
// spans a network round trip, so the bound must clear the 120 s wait with
// margin, and a holder past it is a hung push rather than a slow one. A stale
// lock is renamed first, so one breaker moves a given directory, and the renamed
// copy is the only thing removed.
//
// A CALLER THAT ALREADY HOLDS THE LOCK NAMES ITSELF via PLOT_PUSH_LOCK_HOLDER
// (the holder that took it). `take()` reads the owner file first and returns 0
// at once where its holder matches — the nested case `commitAndPush` → `plot-push-
// main.sh` needs, so the script does not deadlock waiting on its own caller's
// lock.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [verb, pidArg, ...action] = process.argv.slice(2);
const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const lock = path.join(common, 'plot-push-main.lock');
const ownerFile = path.join(lock, 'owner');

const readOwner = () => {
  try {
    const [pid, at, ...rest] = fs.readFileSync(ownerFile, 'utf8').replace(/\n$/, '').split('\t');
    return { pid, at: Number(at), action: rest.join('\t') };
  } catch {
    return null;
  }
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

// A HOLDER IS A PID OR A BOARD HOLDER `<pid>.<seq>`. `ladder.ts`'s
// `nextHolderId()` appends a call sequence after a dot, so two `commitAndPush`
// calls inside one board process never match each other on the
// `PLOT_PUSH_LOCK_HOLDER` fast path. Only the part before the dot is an OS pid,
// and only a dotted id is read that way: a bare number is the pid itself,
// including a 7-digit Linux pid (`kernel.pid_max` 4194304). Anything else is
// no pid at all, and its lock breaks only by age.
const osPid = (holder) => {
  const match = /^([1-9][0-9]*)(?:\.[0-9]+)?$/.exec(holder ?? '');
  return match ? Number(match[1]) : null;
};

const alive = (holder) => {
  const pid = osPid(holder);
  return pid === null || isAlive(pid);
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const take = () => {
  const waitMs = Number(process.env.PLOT_PUSH_LOCK_WAIT ?? 120) * 1000;
  const staleMs = Number(process.env.PLOT_PUSH_LOCK_STALE_S ?? 600) * 1000;
  const holder = process.env.PLOT_PUSH_LOCK_HOLDER;
  const mine = `${pidArg}\t${Date.now()}\t${action.join(' ')}\n`;
  // The no-progress clock: reset whenever the owner file's pid/taken-at
  // changes, so a draining queue of distinct holders never times out on total
  // elapsed time. Only a holder that sits unchanged for the whole bound does.
  let lastSeen = null;
  let since = Date.now();
  for (;;) {
    const already = readOwner();
    if (holder !== undefined && already?.pid === holder) return 0;
    // THE LOCK APPEARS WITH ITS OWNER, never empty: a staging directory gets
    // the owner file first and is renamed onto the lock name. A process killed
    // between a bare `mkdir` and the owner write left a lock no reader could
    // attribute, break or release.
    const staging = `${lock}.taking.${process.pid}`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, 'owner'), mine);
    try {
      fs.renameSync(staging, lock);
      return 0;
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      if (err.code !== 'EEXIST' && err.code !== 'ENOTEMPTY') throw err;
    }
    const held = readOwner();
    if (held && (!alive(held.pid) || Date.now() - held.at > staleMs)) {
      const moved = `${lock}.broken.${process.pid}`;
      try {
        fs.renameSync(lock, moved);
        process.stderr.write(`plot-push-main: broke a stale lock held by pid ${held.pid} (${held.action})\n`);
        fs.rmSync(moved, { recursive: true, force: true });
      } catch {
        // another breaker moved it first
      }
      lastSeen = null;
      since = Date.now();
      continue;
    }
    const seen = held ? `${held.pid}\t${held.at}` : null;
    if (seen !== lastSeen) {
      lastSeen = seen;
      since = Date.now();
    }
    if (Date.now() - since >= waitMs) {
      process.stderr.write(
        `push: locked — held by pid ${held?.pid ?? 'unknown'} running ${held?.action || 'an unknown action'}; waited ${waitMs / 1000}s with no progress. Retry once it finishes; nothing was pushed.\n`,
      );
      return 6;
    }
    sleep(250);
  }
};

const release = () => {
  if (readOwner()?.pid === pidArg) fs.rmSync(lock, { recursive: true, force: true });
  return 0;
};

process.exit(verb === 'take' ? take() : verb === 'release' ? release() : 2);
