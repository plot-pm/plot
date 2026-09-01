import { execFileSync } from 'node:child_process';
import type { FleetReading } from '../contract/schema.js';
import { readConfig, type BuildBoardOptions } from './board.js';
import { pulseFor } from './fleet.js';
import { transcriptFacts, type TranscriptFacts } from './transcript.js';

/**
 * What one WORKING row can honestly say about the agent holding it.
 *
 * **Assembled on demand, exactly like the log, and for the same reason.** Every
 * field here is either already in the pulse the board caches or is one bounded
 * local read away — none of it is worth multiplying by every agent, every open
 * tab, four times a minute. The row asks; this answers.
 *
 * `ok: false` carries the same shape of three-way answer `/api/worker-log`
 * draws, and for the same reason: *this machine holds no worktree for that
 * branch* is a different statement from *there is no such branch*, and they send
 * a reader to different places.
 */
export type AgentPanel =
  | {
      ok: true;
      branch: string;
      /** Where the branch is checked out on THIS machine. */
      worktree: string;
      /** The plan governing the branch, as the scan reported it — or "". */
      plan: string;
      /** The wave the branch belongs to, or "". */
      wave: string;
      /** The worker's state, forwarded from the scan — never re-derived here. */
      worker: string;
      /** The worker's pid as the scan read it, or "". */
      pid: string;
      /**
       * How long the worker's PROCESS has been alive, in seconds — or null.
       *
       * **Derived from the pid, never from a stored timestamp.** A launch time
       * written to disk outlives the process it describes, so a dead worker's
       * row would keep counting: uptime is the one field where a stale value is
       * indistinguishable from a live one. Asking the OS about the pid answers
       * *and* proves the process is there — see {@link uptimeSeconds}.
       *
       * Null whenever the process is gone, which is what "no fabricated uptime"
       * means concretely.
       */
      uptimeSeconds: number | null;
      /**
       * The command the dispatcher starts workers with (`Worker command`), or "".
       *
       * The CONFIGURED command, not the process's own argv. It answers *what was
       * this agent asked to do*, which is a property of the fleet's
       * configuration; reading argv would answer *what is this pid running*, and
       * for a detached worker behind a shell those differ in ways that mislead.
       */
      command: string;
    } & TranscriptFacts
  | { ok: false; branch: string; reason: AgentPanelMiss };

/** Why a panel could not be assembled. */
export type AgentPanelMiss =
  /** No worktree for the branch on this machine — ask the machine that holds it. */
  | 'no-worktree'
  /** The pulse knows the branch but reports no worktree path for it. */
  | 'unknown-branch';

/**
 * Everything the cached pulse holds about one branch — or null.
 *
 * **A lookup rather than a check, the same security boundary
 * `worktreeForBranch` documents.** The request names a branch; the answer is a
 * record the scan already produced for it. Nothing from the request becomes a
 * path segment, so `../../etc` and a NUL byte match no `b.branch` and come back
 * as null rather than as a read attempt.
 */
export function branchFromPulse(
  pulse: FleetReading | null,
  branch: string,
): { worktree: string; plan: string; wave: string; worker: string; pid: string } | null {
  if (!pulse) return null;
  for (const plan of pulse.plans) {
    for (const wave of plan.slices) {
      for (const b of wave.branches) {
        if (b.branch !== branch) continue;
        return {
          worktree: b.local_worktree ?? '',
          plan: plan.file ?? '',
          wave: wave.name ?? '',
          worker: b.worker ?? 'elsewhere',
          pid: b.worker_pid ?? '',
        };
      }
    }
  }
  return null;
}

/**
 * `ps -o etime=` output → seconds, or null for anything it does not recognise.
 *
 * The four shapes `etime` emits, all measured on macOS 2026-08-19:
 * `MM:SS`, `HH:MM:SS`, `DD-HH:MM:SS`, and (for a dead pid) nothing at all.
 * Linux adds no fifth shape. Anything else — a localised `ps`, a future format —
 * yields null, which the panel renders as an absent uptime rather than as a zero.
 *
 * Exported for test: the day-bearing form is the one a short-lived test process
 * can never produce, so it has to be asserted directly.
 */
export function parseEtime(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [, d, h, min, s] = m;
  const days = d ? Number(d) : 0;
  const hours = h ? Number(h) : 0;
  return days * 86_400 + hours * 3_600 + Number(min) * 60 + Number(s);
}

/**
 * How long a pid has been running, in seconds — or null if it is not.
 *
 * **The absence of an answer IS the answer for a worker that has exited.** `ps`
 * exits non-zero for a pid nobody is running, so the same call that measures
 * uptime also establishes there is something to measure. That is why uptime is
 * derived here rather than stored at launch: a stored timestamp keeps returning
 * a larger number forever, and a row reading *up 4h* for a process that died in
 * its first minute is worse than one reading nothing.
 *
 * `pid` arrives as the string the scan recorded. A non-numeric or empty one is
 * refused before it reaches the shell — not as sanitisation theatre, but because
 * `execFileSync` passes an argument vector and there is no shell to inject
 * into; the check exists so a malformed record fails as null instead of as a
 * spawn.
 *
 * **`0` is refused explicitly.** `kill -0 0` signals the caller's entire process
 * group and succeeds, and the equivalent trap has been sprung in this repo
 * before. The scan already rejects it, so a `0` here means a record that should
 * not exist — answering null is the honest reading.
 */
export function uptimeSeconds(pid: string): number | null {
  if (!/^\d+$/.test(pid)) return null;
  if (Number(pid) <= 0) return null;
  try {
    const out = execFileSync('ps', ['-o', 'etime=', '-p', pid], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseEtime(out);
  } catch {
    // Non-zero exit: no such process. Uptime is absent, not zero.
    return null;
  }
}

/**
 * Assemble one agent's panel from the pulse, the process table and the transcript.
 *
 * The three sources are kept strictly in their lanes: the pulse says what Plot
 * knows (branch, plan, worktree, pid, state), the OS says whether the process is
 * alive and for how long, and the transcript says what the runtime knows (model,
 * context, last activity). Nothing is re-derived across that boundary — worker
 * liveness in particular is the scan's verdict, forwarded, never a second
 * opinion computed here.
 */
export function agentPanel(
  opts: BuildBoardOptions,
  branch: string,
  env: { home?: string } = {},
): AgentPanel {
  const found = branchFromPulse(pulseFor(opts), branch);
  if (!found) return { ok: false, branch, reason: 'unknown-branch' };
  if (!found.worktree) return { ok: false, branch, reason: 'no-worktree' };

  return {
    ok: true,
    branch,
    worktree: found.worktree,
    plan: found.plan,
    wave: found.wave,
    worker: found.worker,
    pid: found.pid,
    uptimeSeconds: uptimeSeconds(found.pid),
    command: readConfig(opts, 'Worker command', ''),
    // Spread LAST and deliberately: every key in it is optional, so a
    // transcript that yielded nothing adds nothing, and the fields above are
    // never shadowed by an absent one.
    ...transcriptFacts(found.worktree, { home: env.home }),
  };
}
