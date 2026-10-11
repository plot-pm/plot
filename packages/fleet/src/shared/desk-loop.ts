import fs from 'node:fs';
import path from 'node:path';
import type { DeskManifest } from '@plot-pm/domain/rules/desk-manifest';
import {
  deskLoopAlive,
  deskWaitsFree,
  FREE_WAIT_FILENAME,
  type DeskLoop,
  type DeskPidReading,
  type FreeWaitReading,
} from '@plot-pm/domain/rules/desk-loop-alive';

/**
 * The manifest's `pid` and `wrapperPid`, as {@link DeskPidReading}s; empty
 * strings when the manifest cannot be read, so {@link deskLoopAlive} treats a
 * read failure as nothing to refuse on rather than throwing.
 */
export const recordedLoopPids = (manifestFile: string): DeskPidReading[] => {
  let m: Record<string, unknown> = {};
  try {
    m = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
  } catch {
    /* no manifest to read — both readings fall through as empty */
  }
  const field = (name: string): string => (typeof m[name] === 'string' ? (m[name] as string) : '');
  return [
    { source: 'manifest pid', pid: field('pid') },
    { source: 'manifest wrapperPid', pid: field('wrapperPid') },
  ];
};

/**
 * Whether a pid is alive, reading an unanswerable signal as alive.
 *
 * `EPERM` (alive, not ours to signal) reads as alive and only `ESRCH` (the
 * process is gone) reads as not-alive, because a wrong *not-alive* starts a
 * second loop on a desk that already holds one.
 */
export const pidAliveEverywhere = (pid: string): boolean => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The desk's `.plot-worker.freewait` record, read as a value — `text: null` when it cannot be read. */
export const deskFreeWait = (worktree: string): FreeWaitReading => {
  try {
    return { text: fs.readFileSync(path.join(worktree, FREE_WAIT_FILENAME), 'utf8') };
  } catch {
    return { text: null };
  }
};

/** The desk's `.plot-worker.pid`, trimmed; `''` when the file is absent or unreadable. */
const deskPidFile = (worktree: string): string => {
  try {
    return fs.readFileSync(path.join(worktree, '.plot-worker.pid'), 'utf8').trim();
  } catch {
    return '';
  }
};

/** A desk's live loop, and whether that loop records a free wait. */
export interface DeskLoopReading {
  /** {@link deskLoopAlive}'s answer over the desk's three recorded pids. */
  readonly loop: DeskLoop;
  /** `true` only when `loop` is alive and `.plot-worker.freewait` names its pid. */
  readonly waitsFree: boolean;
}

/**
 * Reads whether a desk holds a live loop: `.plot-worker.pid`, then the
 * manifest's `pid`, then its `wrapperPid`, in that order.
 *
 * @param worktree - the desk.
 * @param manifest - which manifest names the desk; only a `named` answer adds pids.
 * @returns the loop reading and whether the live loop waits free.
 */
export const readDeskLoop = (worktree: string, manifest: DeskManifest): DeskLoopReading => {
  const pids: DeskPidReading[] = [
    { source: '.plot-worker.pid', pid: deskPidFile(worktree) },
    ...(manifest.kind === 'named' ? recordedLoopPids(manifest.path) : []),
  ];
  const loop = deskLoopAlive({ pids, alive: pidAliveEverywhere });
  return { loop, waitsFree: loop.kind === 'alive' && deskWaitsFree(deskFreeWait(worktree), loop.pid) };
};
