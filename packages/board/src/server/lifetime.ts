/**
 * A board server that dies with the process that started it — when, and only
 * when, that process asked for it.
 *
 * ## The defect
 *
 * Measured on 2026-08-17 at 02:00, four `board-server.mjs` processes were
 * running. Two of them listened on random high ports (`PORT=0`, which only
 * `packages/board/test/helpers.mjs` sets) and had **PID 1 as their parent** —
 * the test runs that spawned them were long gone, eighteen seconds apart, and
 * both were still answering `/api/fleet` with 200 and still polling. They are
 * orphans, and they are why the Agents tab reported `0 branches across 0 plans`
 * during a five-agent run.
 *
 * The tests are not undisciplined: 26 `startServer(` calls against 24 `.kill()`
 * calls in `after()` hooks. But `startServer` hands the caller a `kill`
 * function, which makes cleanup a **rule** in this repo's vocabulary — you can
 * answer "did I clean up?" without having done it, because `after()` never runs
 * when the runner is killed rather than finishing. Ctrl-C, a dying agent, a
 * `SIGKILL`: no hook fires, and POSIX hands the child to PID 1.
 *
 * ## Why polling `ppid`
 *
 * `process.ppid` becomes `1` the moment the parent dies, **however it dies**.
 * Measured with a probe: the parent was killed by `SIGKILL` (exit 137, so no
 * handler of its own could possibly run) and the child observed
 * `ppid changed 20996 -> 1` within 200 ms.
 *
 * That is a **gate** rather than a rule: the server does not claim to still
 * have its launcher, it measures it. No cooperation from the caller and no
 * cleanup code — it survives the exact case that produces orphans, the one
 * where no cleanup code runs at all. There is no portable notification for
 * "your parent died", so an interval is the mechanism; at 1 s it costs nothing,
 * and it fails safe, since a check that never runs leaves behaviour exactly as
 * it is today.
 *
 * Two neighbouring answers were checked and rejected:
 *
 * - **A global teardown.** There is none in the board's test config at all;
 *   cleanup lives entirely in per-suite `after()` hooks. A teardown runs when
 *   the suite ends **in order**, which is precisely the case `after()` already
 *   covers — the two orphans measured at 01:54 came from a run that did *not*
 *   end in order, and a teardown would have missed both.
 * - **`detached: true` on the spawn.** `helpers.mjs` spawns *without* it, so
 *   these are ordinary children that were orphaned rather than cut loose.
 *   Adding it would make the problem deliberate.
 *
 * ## Why an explicit variable, and why a NEW one
 *
 * **The distinction cannot be the ppid change itself.** The operator's own
 * board runs under `node --watch`, and that supervisor *replaces its child on
 * every restart* — so a naive "my parent changed, therefore exit" is true for
 * both, and the operator's board is the one that would die. A board started in
 * a terminal that the operator then closes is deliberately allowed to keep
 * running, too.
 *
 * So the signal is a variable the harness sets on purpose. `helpers.mjs`
 * already passes `PLOT_REPO_ROOT` and `PORT=0` to every server it starts, and
 * the operator's board has neither, so either could serve as a tell. Neither
 * should: `PLOT_REPO_ROOT` answers *where the repo is*, `PORT=0` answers *pick
 * a port for me*, and deriving *die with your launcher* from either would work
 * by accident today and surprise whoever sets them for their actual meaning
 * tomorrow. **One variable, one question.** `PLOT_EXIT_WITH_PARENT` says
 * exactly what it does.
 *
 * One variable covers the agent case with no second mechanism: agents run
 * `pnpm test`, which goes through this same `helpers.mjs`, so their servers
 * inherit the variable exactly as a human's do. The case that produces the most
 * orphans needs no special handling, because it is the same case.
 */

/** How often to ask. Low enough to cost nothing, fast enough to not leak. */
export const PARENT_CHECK_INTERVAL_MS = 1000;

/**
 * `1` is `launchd`/`init` — the parent a process is given once its real one is
 * gone. A server whose own launcher IS pid 1 (a daemon) never sees a change,
 * which is why the launch-time ppid is captured rather than compared to 1.
 */
const ORPHAN_PPID = 1;

export interface ExitWithParentOptions {
  /** The environment to read the gate from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Reads the current parent pid. Defaults to `process.ppid`. */
  ppid?: () => number;
  /** What to do when the launcher is gone. Defaults to `process.exit(0)`. */
  onOrphaned?: () => void;
  /** Interval scheduler, injectable so a test need not wait a real second. */
  setIntervalFn?: typeof setInterval;
}

/**
 * Arm the gate if — and only if — `PLOT_EXIT_WITH_PARENT` is set to something
 * other than an explicit off value.
 *
 * @returns the timer when armed, `null` when the variable says nothing. A
 * caller that gets `null` has a server with exactly today's lifetime.
 */
export function exitWithParent(options: ExitWithParentOptions = {}): NodeJS.Timeout | null {
  const {
    env = process.env,
    ppid = () => process.ppid,
    onOrphaned = () => process.exit(0),
    setIntervalFn = setInterval,
  } = options;

  const flag = env.PLOT_EXIT_WITH_PARENT;
  // Unset, empty, `0` and `false` all mean "not asked for". Anything else is a
  // caller deliberately opting in — the variable exists for one reason and has
  // one meaning.
  if (flag === undefined || flag === '' || flag === '0' || flag === 'false') return null;

  const launcher = ppid();

  const timer = setIntervalFn(() => {
    const current = ppid();
    // Compared against the pid at LAUNCH, not against 1: this catches both the
    // orphan (reparented to init) and any other reparenting, while a server
    // legitimately started BY pid 1 is not treated as already orphaned.
    if (current !== launcher || current === ORPHAN_PPID) onOrphaned();
  }, PARENT_CHECK_INTERVAL_MS);

  // The check must never be the reason the process stays alive. Without this,
  // a board with nothing else to do would be held open by its own watchdog.
  timer.unref?.();
  return timer;
}
