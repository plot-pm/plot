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
// A group whose leader has exited is signalled member by member: `member`
// (string, RegExp or an array of them) names what a member's command line
// must contain, and `recordedAt` bounds its start time.
//
// `record(pid)` stamps a pid the test just launched; `signalRecorded(file)`
// takes the stamp from the pid file's mtime.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * Allowed skew between the start time `ps` reports and the stamp. `ps` prints whole
 * seconds, and procps on Linux reports a start 0.8 to 1.2 s earlier than the wall clock
 * (it cuts the boot time to whole seconds, then cuts the printed value again), so 3 s
 * covers both. A pid does not recur within 3 s at observed fork rates (macOS: about 800
 * pids/s against a 99 999 limit, about 2 min per wrap), and a command expectation still applies.
 */
export const SKEW_MS = 3_000;

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

/** One line of `ps -A -o pid=,pgid=,lstart=,command=`, with `lstart` in C locale. */
const PS_LINE = /^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)(?:\s+(.*))?$/;

/**
 * Every live process in process group `pgid`.
 *
 * @param pgid the process group id, as a number or a numeric string.
 * @returns `[{ pid, pgid, startedAt, command }]`, or null when `ps` fails, exits
 *   non-zero, prints nothing, or prints a line that does not parse.
 */
export const groupMembers = (pgid) => {
  const g = asPid(pgid);
  if (g === undefined) return null;
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,lstart=,command='],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  if (ps.error || ps.status !== 0) return null;
  const lines = (ps.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const rows = [];
  for (const line of lines) {
    const m = line.match(PS_LINE);
    if (!m) return null;
    const startedAt = Date.parse(m[3]);
    if (Number.isNaN(startedAt)) return null;
    rows.push({ pid: Number(m[1]), pgid: Number(m[2]), startedAt, command: m[4] ?? '' });
  }
  return rows.filter((r) => r.pgid === g);
};

const matchesAny = (text, patterns) => [patterns].flat()
  .some((p) => (p instanceof RegExp ? p.test(text) : typeof p === 'string' && text.includes(p)));

/**
 * The members of group `pgid` that the test can prove it started.
 *
 * A member is proven when it started no earlier than `recordedAt` minus the
 * clock skew and its command line matches one of the `member` patterns.
 *
 * @param pgid the process group id.
 * @param expect `{ recordedAt?, member }`; `recordedAt` defaults to the stamp
 *   `record` left for `pgid`. `member` is a string (substring), a RegExp, or an
 *   array of either.
 * @returns the proven members as `groupMembers` rows, or null when `ps` cannot
 *   answer or `recordedAt` or `member` is unknown.
 */
export const ownMembers = (pgid, { recordedAt, member } = {}) => {
  const g = asPid(pgid);
  if (g === undefined) return null;
  const since = recordedAt ?? stamps.get(g);
  if (since === undefined || member === undefined) return null;
  const rows = groupMembers(g);
  if (rows === null) return null;
  return rows.filter((r) => r.startedAt >= since - SKEW_MS && matchesAny(r.command, member));
};

/** True only when `kill(pid, 0)` fails with ESRCH: no process holds the pid. */
const absent = (n) => {
  try {
    process.kill(n, 0);
    return false;
  } catch (e) {
    return e?.code === 'ESRCH';
  }
};

/**
 * Sends `signal` to a pid only when `isOwn` holds for it.
 *
 * With `group: true` and an own leader, the signal goes to the whole group
 * (`kill(-pid)`). With `group: true` and a leader that `kill(pid, 0)` reports
 * as absent (ESRCH), the signal goes to each member `ownMembers` proves, one
 * pid at a time, and each member's start time and command are read again just
 * before its signal. Any other case sends nothing: a leader that is alive but
 * not own, a `ps` that fails, or no `member` expectation.
 *
 * @param pid the pid, as a number or a numeric string.
 * @param signal the signal name, e.g. `SIGKILL`.
 * @param expect `{ recordedAt?, command?, group?, member? }`; `command` checks
 *   the leader, `member` checks the members of a gone leader's group (see
 *   `ownMembers`).
 * @returns true when at least one signal was sent.
 */
export const signalOwn = (pid, signal, { group = false, member, ...expect } = {}) => {
  const n = asPid(pid);
  if (n === undefined) return false;
  if (isOwn(n, expect)) {
    try {
      process.kill(group ? -n : n, signal);
      return true;
    } catch {
      return false;
    }
  }
  if (!group || !absent(n)) return false;
  const members = ownMembers(n, { recordedAt: expect.recordedAt, member });
  if (members === null) return false;
  let sent = false;
  for (const m of members) {
    const id = identityOf(m.pid);
    if (id === null || id.startedAt !== m.startedAt || id.command.trim() !== m.command.trim()) continue;
    try {
      process.kill(m.pid, signal);
      sent = true;
    } catch { /* already gone */ }
  }
  return sent;
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
 * @param expect `{ command?, group?, member? }`, as for `signalOwn`.
 * @returns true when the signal was sent.
 */
export const signalRecorded = (file, signal, expect = {}) => {
  const rec = readPid(file);
  return rec !== undefined && signalOwn(rec.pid, signal, { ...expect, recordedAt: rec.recordedAt });
};
