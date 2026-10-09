// The one recursive removal under packages/board/test. CI's *A teardown does
// not race a child* step allows exactly one raw recursive `fs.rmSync` here, and
// this is it: `helpers.mjs`'s `rmTree` and the catalogue's browser launcher
// both call it, and the catalogue must not import `helpers.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Delete a fixture tree, retrying only while a dying process still writes into
 * it.
 *
 * `after()` hooks await `server.stop()`, but that resolves when the SERVER
 * exits — not when the `git` children it spawned mid-scan do. A grandchild is
 * outside the scope of the SIGTERM sent to its parent, so it can still create
 * `.git/index.lock` or an object file a few milliseconds after the server is
 * gone. `rmSync` walks a directory, deletes what it saw, then `rmdir`s the
 * parent; a file appearing between those two steps fails the `rmdir` with
 * ENOTEMPTY. CI failed exactly this way on `outer/.git`.
 *
 * `force: true` does not cover this. It suppresses "no such file" — the
 * absence of something expected — while this is the presence of something
 * unexpected, the opposite failure.
 *
 * This is the same reasoning as `helpers.mjs`'s `git` retry, applied to the other half of the
 * fixture's life: contention with a doomed process is transient by definition,
 * so a bounded retry converts a spurious teardown failure into a marginally
 * slower one. Awaiting the server was the previous attempt at this and did not
 * hold, because it addressed the process that was waited for rather than the
 * ones that were not.
 *
 * Bounded and specific for the same reason the git retry is: ENOTEMPTY/EBUSY
 * clear on their own, and any other error means the fixture is wrong in a way
 * patience cannot fix, so it must surface on the first attempt.
 */
const STILL_BEING_WRITTEN = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM']);

/** Directories a desk never sits under, skipped by the search below. */
const NOT_A_DESK = new Set(['.git', 'node_modules']);

/** How deep under a fixture the search for desks goes: box, repo, `.worktrees`, desk. */
const DESK_DEPTH = 4;

/** Every `.plot-worker.wrapper.pid` under `dir`, to `depth` levels. */
const wrapperFiles = (dir, depth) => {
  if (depth < 0) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === '.plot-worker.wrapper.pid') return [full];
    if (entry.isDirectory() && !NOT_A_DESK.has(entry.name)) return wrapperFiles(full, depth - 1);
    return [];
  });
};

/**
 * Whether a pid is a Plot wrapper, read from its command line. A pid file can
 * outlive its process and name a recycled pid, so nothing is signalled on the
 * file alone: the wrapper's `sh -c` body opens by writing its own pid file.
 */
const isWrapper = (pid) =>
  (spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '')
    .includes('PLOT_WRAPPER_PID_FILE');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * End every agent a fixture's desks still run, and wait for their wrappers.
 *
 * Since #1168 a started agent leads its own process group, holding its wrapper,
 * monitors, loop and agent, and `--start` returns while it runs. Its wrapper is
 * re-parented away from the server that started it, so stopping the server's
 * process tree misses it, and it goes on writing `.plot-worker.exit`, findings
 * and agent logs into a tree being removed. Measured in CI on 2026-10-02: a
 * `plot-board-test-` box left in the run's TMPDIR by `owned-run.sh`.
 *
 * @param target the fixture tree about to be removed.
 */
const endDesks = (target) => {
  const wrappers = wrapperFiles(target, DESK_DEPTH)
    .map((file) => {
      try {
        return Number(fs.readFileSync(file, 'utf8').trim());
      } catch {
        return 0;
      }
    })
    .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid && isWrapper(pid));
  const waitGone = (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && wrappers.some(alive)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  };
  // SIGTERM FIRST: `plot-tmp.sh` traps remove their temp entries on it and
  // cannot on SIGKILL; the wrapper ignores it and ends once its agent has.
  for (const pid of wrappers) {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* not a group leader, or gone */ }
  }
  waitGone(10_000);
  for (const pid of wrappers.filter(alive)) {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* not a group leader, or gone */ }
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  waitGone(5_000);
};

export const removeTree = (target, { retries = 10, delayMs = 25 } = {}) => {
  endDesks(target);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt >= retries || !STILL_BEING_WRITTEN.has(err?.code)) throw err;
      // Synchronous, to stay a drop-in for the `fs.rmSync` calls it replaces:
      // `after()` hooks are not all async, and making them so to accommodate a
      // cleanup helper would spread this detail across every suite.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
};
