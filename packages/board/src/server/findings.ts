// The monitors' findings, from the desks they were written on to the row.
//
// THE MONITORS PUBLISH TO A FILE AND THE BOARD READS IT. Each monitor appends
// one NDJSON line per change to `.plot-worker.monitor.<subject>.jsonl` inside
// the worktree it watches, and `plot-agent-monitor.sh` states why that is the
// durable half: *"the file is what a subscriber reads"*, with stdout going to
// the worker log beside it.
//
// A FILE READ RATHER THAN A SOCKET SUBSCRIPTION, and that is this slice's
// scope guard rather than an oversight. The channel is a protocol between
// processes and has its own slice; this is a payload field. A board that
// subscribed would need a channel running to show a finding, and the failures
// these monitors catch happen on machines where nothing but the monitors is
// up. Reading the file the monitor already wrote costs one `readFileSync` per
// watched worktree and needs no second process alive.
//
// PUBLISHED ONLY ON CHANGE, which is what makes the read cheap. A monitor that
// republished every pass would grow its log without bound; these write a line
// when the answer moves and a `clear` when it stops holding, so a desk's whole
// history is a handful of lines.
//
// IT ADDS NO FACTS. Every finding here was measured by a monitor and is carried
// verbatim — the same rule `worker` and `worker_activity` follow onto the row.
// Nothing in this file decides whether a branch owes a review; it reads what
// the monitor decided and hands it on.
import fs from 'node:fs';
import path from 'node:path';
import { currentFindings, FindingSchema, type Finding } from '../contract/index.js';

/**
 * The three logs a dispatched worktree can hold, by the filenames the monitor
 * scripts write.
 *
 * Named rather than globbed, for `.gitignore`'s reason in the same plan: a
 * glob over `.jsonl` would also read an agent's own output, and an agent
 * writing a file that happened to parse as a finding would be publishing
 * findings nobody measured.
 */
export const MONITOR_LOGS: readonly string[] = [
  '.plot-worker.monitor.worker.jsonl',
  '.plot-worker.monitor.agent.jsonl',
  '.plot-worker.monitor.build.jsonl',
];

/**
 * How much of a monitor log is read, in bytes.
 *
 * A BOUND RATHER THAN A TRUST. The monitors publish on change, so a log is
 * normally a few hundred bytes and this never fires. It exists because the
 * board reads these files every pulse on a single thread, and one runaway
 * monitor must not be able to stall the read path for every branch.
 */
const MAX_LOG_BYTES = 256 * 1024;

/**
 * The findings one monitor log currently holds.
 *
 * Every line that is not a valid finding is SKIPPED rather than thrown on — the
 * tolerance `decode` already applies to the socket, for the same reason: a
 * board that died on one malformed line would be a board any stray write could
 * take down. A truncated last line is the ordinary case, since a monitor
 * appends while this reads.
 *
 * @param file absolute path to the log.
 * @returns the findings that hold, or [] where the file is absent or unreadable.
 */
export function findingsInLog(file: string): readonly Finding[] {
  let raw: string;
  try {
    const handle = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(handle).size;
      // THE TAIL, NOT THE HEAD. A log longer than the bound has its OLDEST
      // lines dropped, which is the safe half to lose: the reduction is
      // last-wins, so the newest lines carry the current answer.
      const start = size > MAX_LOG_BYTES ? size - MAX_LOG_BYTES : 0;
      const length = size - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, start);
      raw = buffer.toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    // ABSENT IS THE COMMON CASE. A branch with no dispatched worktree has no
    // monitor and no log, and that is not an error — it is *nothing was
    // looked for*, which the empty answer says exactly.
    return [];
  }

  const parsed: Finding[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const result = FindingSchema.safeParse(JSON.parse(trimmed));
      if (result.success) parsed.push(result.data);
    } catch {
      // Not JSON — a partially written line, or something else's output.
    }
  }
  return currentFindings(parsed);
}

/**
 * Every monitor's current findings about the branch checked out at `worktree`.
 *
 * READ FROM THE DESK THE FINDING IS ABOUT, and filtered by branch afterwards.
 * A worktree's logs describe the branch its monitors were started on, but a
 * worktree can be switched to another branch while its logs stay — so a
 * finding is kept only where it names the branch being asked about. Without
 * that test a leftover log would attribute one branch's debts to another.
 *
 * @param worktree absolute path to the worktree, or "" when the branch is
 *   checked out nowhere on this machine.
 * @param branch the branch being asked about.
 * @returns the findings that hold, [] when there are none to read.
 */
export function findingsFor(worktree: string, branch: string): Finding[] {
  if (!worktree) return [];
  const found: Finding[] = [];
  for (const name of MONITOR_LOGS) {
    for (const finding of findingsInLog(path.join(worktree, name))) {
      if (finding.branch === branch) found.push(finding);
    }
  }
  return found;
}
