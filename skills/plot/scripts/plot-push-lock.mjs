#!/usr/bin/env node
// The default-branch write lock behind `plot-push-main.sh` (#1349).
//
// Usage: plot-push-lock.mjs take <holder-pid> <action>
//        plot-push-lock.mjs release <holder-pid>
// Exit:  take — 0 once the lock is held; 6 after PLOT_PUSH_LOCK_WAIT seconds
//        (default 120), naming the holder's pid and action on stderr.
//        release — 0 always; removes the lock only where its owner line names
//        <holder-pid>.
//
// Measured 2026-10-07: a 4-plan /api/release batch ended 4 of 4 `push=rejected`
// and a 6-plan /api/approve batch ended 3 rejected, 1 bypassed, 1 micro-pr and
// 1 refused, because both routes start their scripts in the background. The same
// batches run one at a time landed every plan.
//
// The lock is a directory under the COMMON git dir, so every worktree of one
// repository contends for it. `mkdir` is atomic and fails where the name is
// taken; `flock` is not shipped on macOS. Its `owner` file holds
// `pid<TAB>taken-at-ms<TAB>action`.
//
// STALE IS A DEAD PID, or a live one older than PLOT_PUSH_LOCK_STALE_S (default
// 600). `plot-budget.sh` uses 10 s because its lock spans one rename; a push
// spans a network round trip, so the bound must clear the 120 s wait with
// margin, and a holder past it is a hung push rather than a slow one. A stale
// lock is renamed first, so one breaker moves a given directory, and the renamed
// copy is the only thing removed.
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
    return { pid: Number(pid), at: Number(at), action: rest.join('\t') };
  } catch {
    return null;
  }
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const take = () => {
  const waitMs = Number(process.env.PLOT_PUSH_LOCK_WAIT ?? 120) * 1000;
  const staleMs = Number(process.env.PLOT_PUSH_LOCK_STALE_S ?? 600) * 1000;
  const mine = `${pidArg}\t${Date.now()}\t${action.join(' ')}\n`;
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(ownerFile, mine);
      return 0;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    const held = readOwner();
    if (held && Number.isInteger(held.pid) && (!alive(held.pid) || Date.now() - held.at > staleMs)) {
      const moved = `${lock}.broken.${process.pid}`;
      try {
        fs.renameSync(lock, moved);
        process.stderr.write(`plot-push-main: broke a stale lock held by pid ${held.pid} (${held.action})\n`);
        fs.rmSync(moved, { recursive: true, force: true });
      } catch {
        // another breaker moved it first
      }
      continue;
    }
    if (Date.now() - started >= waitMs) {
      process.stderr.write(
        `push: locked — held by pid ${held?.pid ?? 'unknown'} running ${held?.action || 'an unknown action'}; waited ${waitMs / 1000}s. Retry once it finishes; nothing was pushed.\n`,
      );
      return 6;
    }
    sleep(250);
  }
};

const release = () => {
  if (readOwner()?.pid === Number(pidArg)) fs.rmSync(lock, { recursive: true, force: true });
  return 0;
};

process.exit(verb === 'take' ? take() : verb === 'release' ? release() : 2);
