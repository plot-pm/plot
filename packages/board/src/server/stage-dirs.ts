// The temp directories a board build stages plan text into, and their removal
// when the process ends in the middle of a build.
//
// A build removes its own stage directory in a `finally`. A signal ends the
// process without running that `finally`: the server has no other SIGTERM
// handler, so the default action ends it at once. CI left a
// `plot-board-plans-` directory in the run's TMPDIR this way on 2026-10-15
// (run 38792458763), with every test passing, after a test stopped its server
// mid-build.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const live = new Set<string>();

/**
 * Create a stage directory under `os.tmpdir()` and record it as live.
 *
 * @param prefix the `mkdtemp` prefix, such as `plot-board-plans-`.
 * @returns the exact path `mkdtempSync` returned.
 */
export const makeStageDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  live.add(dir);
  return dir;
};

/**
 * Remove one stage directory by its exact path and stop recording it.
 *
 * @throws what `fs.rmSync` throws; the directory then stays recorded, so
 *   `removeLiveStageDirs` tries it again at exit.
 */
export const removeStageDir = (dir: string): void => {
  fs.rmSync(dir, { recursive: true, force: true });
  live.delete(dir);
};

/**
 * Remove every stage directory still recorded. Synchronous, so it can run in a
 * `process` `exit` listener. A directory that cannot be removed stays recorded
 * and is skipped.
 *
 * @returns the directories still recorded afterwards.
 */
export const removeLiveStageDirs = (): readonly string[] => {
  for (const dir of [...live]) {
    try {
      removeStageDir(dir);
    } catch {
      // Left recorded: nothing else in an exiting process can act on it.
    }
  }
  return [...live];
};

/**
 * Remove live stage directories when the process exits or receives SIGTERM,
 * SIGINT or SIGHUP. A signal is raised again after the removal, with the
 * listener gone, so the process still ends by that signal.
 */
export const removeStageDirsOnExit = (): void => {
  process.on('exit', () => {
    removeLiveStageDirs();
  });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.once(signal, () => {
      removeLiveStageDirs();
      process.kill(process.pid, signal);
    });
  }
};
