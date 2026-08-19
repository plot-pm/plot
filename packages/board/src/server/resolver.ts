import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BOARD_ARTIFACT_PATH, type Repair, type Stuck } from '../contract/schema.js';
import type { BuildBoardOptions } from './board.js';

/**
 * The ONE automatic write this system grants: an artifact-only merge conflict
 * repaired without a click.
 *
 * ## Why this one repair may be automatic, and nothing else
 *
 * Three properties, each verified rather than assumed:
 *
 *   1. **`-merge` keeps the file valid.** `.gitattributes` marks
 *      {@link BOARD_ARTIFACT_PATH} so git keeps one side whole and writes NO
 *      conflict markers. The artifact stays buildable JavaScript *through* a
 *      conflict.
 *   2. **The rebuild is deterministic.** Measured: `build.mjs` embeds no
 *      timestamp and no randomness, so the output does not depend on which side
 *      was kept.
 *   3. **CI proves it.** The no-diff gate fails the build if the committed
 *      artifact does not match a fresh rebuild.
 *
 * Together: the one repair whose correctness is checkable **without judgement**.
 * That is the whole licence, and it is the reason every fence below is
 * load-bearing rather than cautious. Widening the entry condition, adding a
 * second automatic path, or pushing before the local gate would each remove the
 * argument that grants the permission — while leaving code that still looks
 * correct.
 *
 * ## A SCRIPT, not an agent
 *
 * The sequence is fully determined — merge, take a side, rebuild, test, push on
 * green — and nothing between those steps is a decision. That is *precisely*
 * what licenses the automation, so the work goes to `plot-resolve-artifact.sh`:
 * handing it to an agent would introduce judgement exactly where its absence is
 * the permission.
 *
 * (Measured on 2026-08-17: this repo configures no `Worker command`, so
 * `plot-dispatch.sh` would create a worktree and report `worker=unconfigured` —
 * no agent, no repair. The shape is the reason; the measurement only confirms
 * that the agent path could not have worked either.)
 *
 * ## This module DECIDES nothing about the state
 *
 * It consumes `stuck.state === 'artifact-conflict'` as wave 1 classified it and
 * never re-derives it. Re-deriving would be a second implementation of the
 * `length === 1` fence, and the two would drift the first time one of them was
 * edited. The script re-checks the set once more against the REAL merge, which
 * is a different question from this one: the board's set is a `merge-tree`
 * prediction, and the script's is the merge itself.
 */

/**
 * Is this branch's state the one the resolver may act on?
 *
 * **EXACTLY `artifact-conflict`, and only where a set was actually observed.**
 * Both halves are the permission rather than a precaution:
 *
 * *Exactly the one state.* Not "a conflict involving the artifact", not "any
 * conflict the board thinks is mechanical". `conflict`, `ci-failing` and
 * `unpushed` have none of the three properties above — a real code conflict has
 * no deterministic resolution, a red check has no rebuild that proves it, and an
 * unpushed rebase is someone else's work in progress. An implementation that
 * accepted a second state would pass every assertion about the first.
 *
 * *And only on an observed set.* `stuckState` reports the host's own
 * `pr.state === 'conflicts'` verdict as a plain `conflict` with an empty set,
 * precisely so it can never reach here — the two sources disagree in the
 * REASSURING direction, since `merge-tree` predicts from the refs this machine
 * holds while the host computed against the branch as it stands. This re-asserts
 * the emptiness check locally rather than trusting the caller: the field this
 * decision rests on is the set, and a set of zero is not a set of one.
 *
 * Exported and pure because the refusals ARE the design. A predicate reachable
 * only through a spawn could only be tested by watching for the absence of a
 * side effect, which is the assertion most likely to pass for the wrong reason.
 */
export function mayResolve(stuck: Stuck | null | undefined): stuck is Stuck {
  if (!stuck) return false;
  if (stuck.state !== 'artifact-conflict') return false;
  // The set travels with the state, so it can be COUNTED rather than trusted —
  // and this is the count. `length === 1 && [0] === artifact` is wave 1's fence
  // restated at the point of action, not a re-derivation of the state: if the
  // two ever disagree, nothing is written.
  return stuck.conflicts.length === 1 && stuck.conflicts[0] === BOARD_ARTIFACT_PATH;
}

/**
 * Where a repair's own words go — one log per branch, beside the worktrees.
 *
 * The same neighbourhood `dispatchLogPath` chose and for the same reason: a log
 * inside the repo would show up in the status of the very branch it is
 * describing, and a repair that dirties its own worktree cannot be verified by
 * the suite it then runs.
 */
export function repairLogPath(repoRoot: string, branch: string): string {
  const flat = branch.replace(/\//g, '-');
  return path.join(path.resolve(repoRoot, '..'), `plot-resolve-${flat}.log`);
}

/**
 * Repairs this process has started and not yet seen finish, by branch.
 *
 * **One repair at a time, and never two on one branch.** A second run while the
 * first is working would fight over the same worktree — the merge, the rebuild
 * and the five-minute suite all write into it, and two interleaved produce an
 * artifact belonging to neither. The pulse fires every 5 s against a repair that
 * takes minutes, so without this the SECOND pulse would start a duplicate.
 *
 * Process memory, deliberately paired with the lock the script takes for itself.
 * Neither is redundant: this registry cannot see a repair started by a second
 * board or by a human at a shell, and the script's lock cannot stop this process
 * from spawning (it learns it lost only after the spawn). The lock is the
 * authority; this is what keeps the board from spawning into it every 5 s.
 */
const inFlight = new Map<string, Repair>();

/**
 * The last outcome per branch, so a finished repair is still REPORTED.
 *
 * **Every repair is reported, whether it succeeded or was abandoned.** A silent
 * automatic write is indistinguishable from a defect — which is the failure mode
 * this whole plan exists to remove — so the row says a repair ran and how it
 * ended, rather than only saying so while it happens. A repair that vanished the
 * instant it finished would be visible for minutes and invisible for exactly the
 * moment a reader wants to know what happened.
 */
const lastOutcome = new Map<string, Repair>();

/**
 * Inputs that already produced a `not-observed` refusal, by branch.
 *
 * **Retry when the input changes, not when the clock ticks.** The pulse fires
 * every 5 s and the branch stays `artifact-conflict` throughout, so a refusal
 * that leaves the input untouched is restarted by the very next pulse — measured
 * on 2026-08-17 as five identical log entries in a row, one per pulse, each
 * reaching into the same worktree.
 *
 * Scoped to `not-observed` alone, and that scope is the argument rather than a
 * convenience. The other outcomes may all legitimately differ on a second run
 * against the same board-side input: `tests-failed` and `build-failed` depend on
 * a suite, `push-failed` on a remote that moves, `worktree-busy` and
 * `already-in-flight` on state that clears the moment their owner finishes,
 * `not-artifact-only` on a merge whose result the refs can change. A repair
 * suppressed for one of those would be a repair never retried after the world
 * fixed itself. `not-observed` is the one whose cause is entirely inside this
 * input: nothing was read, and re-reading the same input reads nothing again.
 */
const notObserved = new Map<string, string>();

/**
 * What the resolver would act on, as one comparable value.
 *
 * The decision rests on the state and the set — the same two fields
 * {@link mayResolve} consults — so those are what "unchanged input" means. This
 * is deliberately NOT a commit SHA: the board never handed this layer one, and a
 * fingerprint invented from data this function cannot see would be a guess about
 * change rather than a reading of it. Under-detecting change is the safe
 * direction here anyway, since it only means one more honest refusal.
 */
function inputFingerprint(stuck: Stuck): string {
  return JSON.stringify([stuck.state, stuck.conflicts]);
}

/**
 * How long a finished repair keeps saying so. Long enough to be seen across a
 * few 4 s polls and a glance away; short enough that it reads as a report of
 * something that just happened rather than as a state the branch is in.
 */
export const REPAIR_ECHO_MS = 10 * 60_000;

/** What the row should say about this branch's repair, or null. */
export function repairFor(branch: string, now = Date.now()): Repair | null {
  const running = inFlight.get(branch);
  if (running) return running;
  const done = lastOutcome.get(branch);
  if (!done) return null;
  if (now - done.at > REPAIR_ECHO_MS) {
    lastOutcome.delete(branch);
    return null;
  }
  return done;
}

/** Test seam — the registries are module state, and a test must start empty. */
export function resetRepairs(): void {
  inFlight.clear();
  lastOutcome.clear();
  notObserved.clear();
}

/**
 * The last `summary:` line the script printed, from its log.
 *
 * Read from the log rather than from the child's stdout because the child is
 * DETACHED: its output goes to the file, and the exit code alone cannot say
 * whether a failed run refused (nothing written) or abandoned (a merge undone).
 * A log that cannot be read yields "" and the outcome falls back to the exit
 * code — which is less detail, never a wrong answer.
 */
function readOutcome(log: string): { outcome: Repair['outcome']; reason: string } | null {
  let text: string;
  try {
    text = fs.readFileSync(log, 'utf8');
  } catch {
    return null;
  }
  const lines = text.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = /^summary: branch=\S* outcome=(\S+) reason=(\S+)/.exec(lines[i]);
    if (m) {
      const outcome = m[1];
      if (outcome === 'pushed' || outcome === 'abandoned' || outcome === 'refused') {
        return { outcome, reason: m[2] };
      }
      return null;
    }
  }
  return null;
}

export interface ResolveOptions extends BuildBoardOptions {
  /**
   * Whether the pulse may repair at all. Absent means YES.
   *
   * Optional, and the default is the whole point: the repair is on today, that
   * behaviour is the tested one, and a switch that changes what happens merely
   * by existing is a behaviour change wearing a flag. Every caller that never
   * heard of this field keeps repairing exactly as before.
   */
  repairEnabled?: boolean;
  /** Test seam: what actually starts the script. Defaults to a detached spawn. */
  spawnRepair?: (args: {
    branch: string;
    script: string;
    repoRoot: string;
    log: string;
    onExit: (code: number | null) => void;
  }) => void;
}

/**
 * Read `PLOT_BOARD_REPAIR` — does this board process repair, or only report?
 *
 * A runtime property of ONE board process, so an environment variable rather
 * than a `## Plot Config` key: `plot-config.sh` describes the repo, and two
 * boards on one checkout may legitimately disagree about this. It is read once
 * at startup, beside `PLOT_REPO_ROOT` and `PLOT_SCRIPTS_DIR`, and threaded
 * down — never consulted from inside the pulse, where a mid-flight change
 * would leave a repair started under one answer settling under the other.
 *
 * **Only `0` turns it off.** Unset is on, and so is anything else — the
 * default is the behaviour that shipped and is under test, and this variable's
 * job is to let an operator take it away deliberately, not to make every board
 * whose environment holds a typo stop writing. An operator who means to
 * disable the repair and misspells the value gets a board that still repairs;
 * one who never set it gets today, which is the answer that must not change.
 *
 * Exported because the parse is the claim. A test that could only reach it
 * through a spawned server would assert the default by not observing a repair,
 * which is exactly what a broken parse also looks like.
 */
export function repairEnabledFromEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PLOT_BOARD_REPAIR !== '0';
}

/**
 * Start the repair for one branch, if it may be started at all.
 *
 * Returns whether a repair was STARTED — false covers every reason not to, and
 * they are deliberately not distinguished in the return: a state that may not be
 * repaired and a branch already being repaired both mean *this call wrote
 * nothing*, which is the only thing a caller on a 5 s timer can act on.
 *
 * Never throws. This runs inside the pulse, and a scan that dies because a
 * worktree was missing would take the board's whole read path down with it — the
 * thing detection was designed to never do.
 */
export function startRepair(
  branch: string,
  stuck: Stuck | null | undefined,
  opts: ResolveOptions,
  now = Date.now(),
): boolean {
  // THE OPERATOR'S FENCE, and it stands FIRST — ahead of every fence below it,
  // because those record state as they refuse. `inFlight` marks a branch as
  // being repaired and `notObserved` remembers an input not to retry; both are
  // written on the way past. A switch consulted after either would leave the
  // registries describing a repair this process promised never to start.
  //
  // It subtracts and never adds. Turning the repair OFF is the only thing this
  // can do — the fences below still decide everything about a repair that is
  // allowed to proceed, so `PLOT_BOARD_REPAIR=1` on a conflict touching source
  // is refused by `mayResolve` exactly as an unset one is. The refusal is what
  // licenses the write at all; a variable that could overturn it would be
  // taking the permission with it.
  if (opts.repairEnabled === false) return false;
  if (!mayResolve(stuck)) return false;
  // THE SECOND FENCE, and the one the 5 s pulse makes load-bearing: the branch
  // stays `artifact-conflict` for the whole minutes-long repair, so every pulse
  // in between would otherwise start another one on the same worktree.
  if (inFlight.has(branch)) return false;

  // THE THIRD FENCE: a `not-observed` refusal is not retried until the input
  // changes. Without it the pulse re-runs the identical repair every 5 s and the
  // log fills with identical entries — five of them, measured — none carrying
  // information the one before it lacked. `mayResolve` passed, so this branch
  // still LOOKS repairable; that is exactly why the clock alone must not be
  // enough to try again.
  const fingerprint = inputFingerprint(stuck);
  if (notObserved.get(branch) === fingerprint) return false;

  const log = repairLogPath(opts.repoRoot, branch);
  const script = path.join(opts.scriptsDir, 'plot-resolve-artifact.sh');

  const record: Repair = { branch, state: 'running', outcome: '', reason: '', at: now, log };
  inFlight.set(branch, record);

  const settle = (code: number | null) => {
    inFlight.delete(branch);
    const read = readOutcome(log);
    // The refusal that must not repeat on unchanged input, remembered against
    // the input that produced it. Recorded ONLY for the script's own declared
    // `not-observed` — a run whose log could not be read falls back to the exit
    // code, which cannot distinguish this refusal from any other failure, and
    // suppressing on that guess would silence repairs that should retry.
    if (read?.outcome === 'refused' && read.reason === 'not-observed') {
      notObserved.set(branch, fingerprint);
    } else {
      // Any other ending clears the note: the world moved, and the next pulse
      // is entitled to a fresh reading.
      notObserved.delete(branch);
    }
    lastOutcome.set(branch, {
      branch,
      state: 'finished',
      // The script's own word where it gave one. Falling back to the exit code
      // says less rather than something else: a repair whose log could not be
      // read is reported as finished-unsuccessfully, never as pushed.
      outcome: read?.outcome ?? (code === 0 ? 'pushed' : 'abandoned'),
      reason: read?.reason ?? (code === 0 ? '' : `exit ${code ?? 'signal'}`),
      at: Date.now(),
      log,
    });
  };

  try {
    if (opts.spawnRepair) {
      opts.spawnRepair({ branch, script, repoRoot: opts.repoRoot, log, onExit: settle });
      return true;
    }
    const out = fs.openSync(log, 'a');
    // DETACHED, like every other write this board triggers. The repair runs a
    // merge, a rebuild and a five-minute suite; awaiting it on this
    // single-threaded server would freeze every viewer's board for the duration
    // — and the pulse that started it is a 5 s timer.
    const child = spawn('bash', [script, branch], {
      cwd: opts.repoRoot,
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.on('error', (err) => {
      console.error('artifact repair failed to spawn:', err);
      settle(null);
    });
    child.on('exit', (code) => settle(code));
    child.unref();
    fs.closeSync(out);
    return true;
  } catch (err) {
    console.error('artifact repair could not start:', err);
    inFlight.delete(branch);
    return false;
  }
}
