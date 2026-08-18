import fs from 'node:fs';
import path from 'node:path';
import type { FleetPulse } from '../contract/schema.js';
import type { BuildBoardOptions } from './board.js';
import { pulseFor } from './fleet.js';

/**
 * What `plot-dispatch.sh` names the worker's log inside the worktree it made
 * (`plot-dispatch.sh:717-722`, beside `.plot-worker.pid` and `.plot-worker.exit`).
 *
 * A CONSTANT rather than a parameter, and that is the security property rather
 * than a style choice: the only variable in the path this module ever builds is
 * a worktree directory the pulse itself reported. Nothing a caller sends
 * contributes a path segment, so there is no input to sanitize — see
 * {@link worktreeForBranch}.
 */
export const WORKER_LOG_NAME = '.plot-worker.log';

/**
 * How much of the log's tail to return, in bytes.
 *
 * 64 KiB, chosen against what the reader is actually doing with it. The
 * question a worker log answers from the board is *what is this agent doing
 * right now* — and the answer is always in the last screenful. Scrollback
 * beyond that is a different errand, served by the path the response carries,
 * which opens the whole file in a pager that is built for it.
 *
 * The number is a budget for the RESPONSE, and it is deliberately smaller than
 * what a worker produces. A four-hour run writes tens of megabytes; shipping
 * that down a localhost socket to a browser that renders the last thirty lines
 * spends the memory twice — once in this process, once in the tab — to display
 * a fraction of it. 64 KiB is roughly 700 lines of agent output, which is more
 * than the panel shows and enough to read backwards through a stack trace.
 *
 * It bounds the READ, not just the reply. See {@link readTail}: the file is
 * never loaded whole and then sliced, so a 2 GB log costs the same as a 2 KB
 * one. A bound that still allocates the file it is bounding is not a bound.
 */
export const TAIL_BYTES = 64 * 1024;

/**
 * Why a log could not be read — three answers, never one blank panel.
 *
 * `no-worktree`, `no-log` and an EMPTY log are three different situations that
 * a single "nothing to show" would collapse, and each sends the reader
 * somewhere else:
 *
 * | outcome       | what is true                          | the reader's move        |
 * |---------------|---------------------------------------|--------------------------|
 * | `no-worktree` | this machine holds no checkout        | ask the machine that has it |
 * | `no-log`      | the worktree is here; no worker wrote | look in the worktree     |
 * | `unreadable`  | the file is there and refused to open | fix the permission       |
 * | empty log     | a worker started and has said nothing | wait, or check its pid   |
 *
 * The empty case is deliberately NOT in this union. It is a successful read of
 * zero bytes — the log exists, the answer is *it has produced no output yet* —
 * and typing it as a failure would put a real observation in the same shape as
 * the three non-observations. `ok: true` with `bytes: 0` says what happened;
 * `reason: 'empty'` would say what didn't.
 *
 * This is the same absence-is-not-emptiness rule the pulse's `local_dirty` and
 * `worker: none` already carry, applied one layer out.
 */
export type LogMissReason = 'no-worktree' | 'no-log' | 'unreadable';

export type WorkerLog =
  | {
      ok: true;
      branch: string;
      /** The log's absolute path — so a reader can open the whole file itself. */
      path: string;
      /** The tail, or "" for a log that exists and holds nothing. */
      text: string;
      /** The log's FULL size in bytes, not the length of `text`. */
      bytes: number;
      /**
       * Whether `text` is the whole log or its end.
       *
       * Stated rather than inferred. A client comparing `text.length` to
       * `bytes` would be comparing UTF-16 code units to bytes and would call a
       * whole log truncated the first time an agent printed an emoji — which
       * they do, constantly. The server knows; it says.
       */
      truncated: boolean;
      /** Last write to the log, ISO-8601 — how stale the tail is. */
      modifiedAt: string;
    }
  | { ok: false; branch: string; reason: LogMissReason; path: string | null };

/**
 * Where a branch is checked out on THIS machine, from the cached pulse — or
 * null.
 *
 * **THIS FUNCTION IS THE SECURITY BOUNDARY, and it is a lookup rather than a
 * check.** The request names a branch; the answer is a directory the scan
 * already reported for it. A path the pulse never mentioned cannot come back
 * out of here, whatever the branch string contains — `../../etc`, a NUL byte, an
 * absolute path — because those are compared against `b.branch` and match
 * nothing. There is no traversal to defend against, since no request-supplied
 * text is ever joined onto a path.
 *
 * That is the same shape `/plan/<file>` uses (resolve the name against the
 * board's OWN collected documents) and it is chosen over validating the branch
 * against a pattern for the reason the plan route gives: a validator is a rule
 * that the next endpoint has to remember, while an allowlist derived from data
 * the server already holds cannot be forgotten. A branch name is also a poor
 * thing to pattern-match — git permits nearly anything in one — so a regex here
 * would be both weaker and more likely to reject a legitimate branch.
 *
 * Null on a cold cache too, and that is honest: no pulse has landed, so this
 * machine has not been asked what it holds. The caller reports `no-worktree`,
 * which is exactly right — *no worktree is KNOWN* — and the next pulse fixes it.
 */
export function worktreeForBranch(pulse: FleetPulse | null, branch: string): string | null {
  if (!pulse) return null;
  for (const plan of pulse.plans) {
    for (const wave of plan.waves) {
      for (const b of wave.branches) {
        if (b.branch === branch && b.local_worktree) return b.local_worktree;
      }
    }
  }
  return null;
}

/**
 * The last {@link TAIL_BYTES} of a file, and whether that was all of it.
 *
 * **Opened and seeked, never read whole.** `readFileSync().slice(-N)` gives the
 * same string and allocates the entire file to do it; on the multi-megabyte
 * logs a long run produces that is the difference between a constant cost and
 * one that grows all day, in a single-threaded server whose event loop every
 * other request shares.
 *
 * The size is taken from the OPEN descriptor (`fstat`) rather than from a
 * `stat` on the path, so the file measured is the file read — a worker is
 * appending to this log as it is served, and a stat-then-open pair invites the
 * two to disagree.
 *
 * **A truncated tail drops its first line.** Seeking to a byte offset lands
 * mid-line and, with any non-ASCII output, mid-character; the fragment that
 * results is at best a half-sentence and at worst a replacement glyph. Dropping
 * it is what makes the rest trustworthy, and `truncated` is what keeps the drop
 * from being silent. A whole file keeps every line — there is no partial first
 * line when the read started at 0.
 */
export function readTail(fd: number, size: number): { text: string; truncated: boolean } {
  if (size === 0) return { text: '', truncated: false };
  const truncated = size > TAIL_BYTES;
  const length = truncated ? TAIL_BYTES : size;
  const buf = Buffer.allocUnsafe(length);
  const read = fs.readSync(fd, buf, 0, length, size - length);
  const text = buf.subarray(0, read).toString('utf8');
  if (!truncated) return { text, truncated };
  // See above: the first line of a mid-file read is a fragment. `indexOf`
  // rather than `split`, so a tail holding no newline at all (one enormous
  // line) yields "" rather than the fragment — the honest answer there is that
  // nothing complete was captured, not half of something.
  const nl = text.indexOf('\n');
  return { text: nl === -1 ? '' : text.slice(nl + 1), truncated };
}

/**
 * A branch's worker log, bounded, with absence and emptiness told apart.
 *
 * The whole read is one `open` + `fstat` + `read`, synchronous like every other
 * handler in this server and for the same reason: it is a bounded local read on
 * a file the machine has open anyway, and an async path would buy nothing but a
 * second shape for callers to hold.
 *
 * Errors are the three-way answer rather than a throw. A missing log is not
 * exceptional — it is the normal state of a branch nobody has dispatched — and
 * the caller has a specific thing to say about each case.
 */
export function workerLog(opts: BuildBoardOptions, branch: string): WorkerLog {
  const worktree = worktreeForBranch(pulseFor(opts), branch);
  if (!worktree) return { ok: false, branch, reason: 'no-worktree', path: null };

  // The ONE path construction in this module, from a scan-reported directory
  // and a constant filename. Nothing from the request is in it.
  const logPath = path.join(worktree, WORKER_LOG_NAME);

  let fd: number;
  try {
    fd = fs.openSync(logPath, 'r');
  } catch (err) {
    // ENOENT is *no worker wrote here*; anything else (EACCES, EISDIR) is a
    // file that exists and would not open. Two different answers, because the
    // moves differ — look in the worktree, versus fix the permission — and
    // collapsing them would rebuild the defect this endpoint exists to avoid
    // one level down from where the plan states it.
    const code = (err as NodeJS.ErrnoException).code;
    return {
      ok: false,
      branch,
      reason: code === 'ENOENT' ? 'no-log' : 'unreadable',
      path: logPath,
    };
  }

  try {
    const st = fs.fstatSync(fd);
    // A directory named `.plot-worker.log` opens fine and reads as garbage.
    // Cheap to rule out, and `unreadable` is the truthful word for it.
    if (!st.isFile()) return { ok: false, branch, reason: 'unreadable', path: logPath };
    const { text, truncated } = readTail(fd, st.size);
    return {
      ok: true,
      branch,
      path: logPath,
      text,
      bytes: st.size,
      truncated,
      modifiedAt: st.mtime.toISOString(),
    };
  } catch {
    return { ok: false, branch, reason: 'unreadable', path: logPath };
  } finally {
    fs.closeSync(fd);
  }
}
