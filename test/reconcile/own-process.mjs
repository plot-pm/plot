// Signals a process only when the test can show the pid still names the
// process it recorded.
//
// The contract suite runs its files concurrently, and a pid read back from a
// file can name a process that has exited and been replaced: the runner reuses
// pids. `signalOwn` reads the pid's start time and command line through `ps`
// and sends nothing when either disagrees with what the test recorded.
//
// Two expectations identify a process:
// - `recordedAt` (ms since the epoch): when the test learned the pid. A process
//   that started later is a different process under a reused pid.
// - `command` (string or RegExp): what its command line must contain.
//
// `record(pid)` stamps a pid the test just launched; `signalRecorded(file)`
// takes the stamp from the pid file's mtime.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

/** Allowed skew between the start time `ps` reports, in whole seconds, and the stamp. */
const SKEW_MS = 1_000;

/** Pids this process stamped through `record`, with the stamp. */
const stamps = new Map();

const asPid = (pid) => {
  const n = Number(String(pid ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * The start time and command line of a live pid.
 *
 * @param pid the pid, as a number or a numeric string.
 * @returns `{ startedAt, command }` with `startedAt` in ms since the epoch, or
 *   null when no process holds the pid or `ps` cannot answer.
 */
export const identityOf = (pid) => {
  const n = asPid(pid);
  if (n === undefined) return null;
  const ps = spawnSync('ps', ['-o', 'lstart=,command=', '-p', String(n)],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  const m = (ps.stdout ?? '').trim()
    .match(/^(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/s);
  if (!m) return null;
  const startedAt = Date.parse(m[1]);
  if (Number.isNaN(startedAt)) return null;
  return { startedAt, command: m[2] };
};

/**
 * Stamps a pid the test just launched, so a later `signalOwn` can check it.
 *
 * @param pid the pid, as a number or a numeric string.
 * @param recordedAt when the test learned the pid; defaults to now.
 * @returns the pid unchanged.
 */
export const record = (pid, recordedAt = Date.now()) => {
  const n = asPid(pid);
  if (n !== undefined) stamps.set(n, recordedAt);
  return pid;
};

/**
 * Whether a pid still names the process the test recorded.
 *
 * @param pid the pid, as a number or a numeric string.
 * @param expect `{ recordedAt?, command? }`; `recordedAt` defaults to the
 *   stamp `record` left. Throws when neither is known.
 * @returns false when the pid is gone, started after `recordedAt`, or runs a
 *   command that does not match `command`.
 */
export const isOwn = (pid, { recordedAt, command } = {}) => {
  const n = asPid(pid);
  if (n === undefined) return false;
  const since = recordedAt ?? stamps.get(n);
  if (since === undefined && command === undefined) {
    throw new TypeError(`own-process: pid ${n} has no recordedAt and no command to check it against`);
  }
  const id = identityOf(n);
  if (id === null) return false;
  if (since !== undefined && id.startedAt > since + SKEW_MS) return false;
  if (command instanceof RegExp && !command.test(id.command)) return false;
  if (typeof command === 'string' && !id.command.includes(command)) return false;
  return true;
};

/**
 * Sends `signal` to a pid only when `isOwn` holds for it.
 *
 * @param pid the pid, as a number or a numeric string.
 * @param signal the signal name, e.g. `SIGKILL`.
 * @param expect `{ recordedAt?, command?, group? }`; `group: true` signals the
 *   process group the pid leads, after checking the leader.
 * @returns true when the signal was sent.
 */
export const signalOwn = (pid, signal, { group = false, ...expect } = {}) => {
  if (!isOwn(pid, expect)) return false;
  const n = asPid(pid);
  try {
    process.kill(group ? -n : n, signal);
    return true;
  } catch {
    return false;
  }
};

/**
 * The pid a file names, with the file's mtime as its stamp.
 *
 * @param file the pid file; its first token is the pid.
 * @returns `{ pid, recordedAt }`, or undefined when the file is missing or names no pid.
 */
export const readPid = (file) => {
  try {
    const pid = asPid(fs.readFileSync(file, 'utf8').trim().split(/\s+/)[0]);
    return pid === undefined ? undefined : { pid, recordedAt: fs.statSync(file).mtimeMs };
  } catch {
    return undefined;
  }
};

/**
 * Sends `signal` to the pid a file names, when that pid is still the process
 * that was running when the file was written.
 *
 * @param file the pid file.
 * @param signal the signal name.
 * @param expect `{ command?, group? }`, as for `signalOwn`.
 * @returns true when the signal was sent.
 */
export const signalRecorded = (file, signal, expect = {}) => {
  const rec = readPid(file);
  return rec !== undefined && signalOwn(rec.pid, signal, { ...expect, recordedAt: rec.recordedAt });
};
