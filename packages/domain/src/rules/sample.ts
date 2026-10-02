/**
 * Whether the recorded pid names a live process.
 *
 * Three values, never a boolean. `unrecorded` is the startup window: the
 * wrapper backgrounds the watcher BEFORE it writes the pid file, so an absent
 * or empty file means the birth has not been recorded yet. Collapsing that into
 * `dead` makes `gone` fire on every worker's first pass, which is the one
 * moment it is guaranteed to be wrong.
 */
export type PidStatus = 'alive' | 'dead' | 'unrecorded';

/**
 * Whether the branch already carries the agent's own work.
 *
 * `unanswerable` is distinct from `no` because the readings differ: there is no
 * local ref to count against, so the question was never put. A failure to
 * observe is not evidence of something to see, and counting against nothing
 * would read every branch in a remote-less repository as having committed.
 */
export type CommitReading = 'yes' | 'no' | 'unanswerable';

/**
 * What one pass of the watcher found.
 *
 * `silent` is not a finding and is published nowhere. The distinction is the
 * whole point: a watcher that reports every quiet moment teaches an operator to
 * ignore it, and then it is worse than absent.
 */
export type MonitorVerdict = 'gone' | 'idle' | 'silent';

/**
 * What the watcher publishes, given the finding it last published.
 *
 * A held finding is published ONCE, at the moment it first holds. A watcher
 * that re-published `idle` every pass would fill the findings file with one
 * fact repeated, and a subscriber could not tell a new stall from an old one.
 *
 * The clearing case is a publish too: a finding that held and then stopped
 * holding is news, and a board that never hears it leaves a stale entry up
 * after the worker recovered.
 *
 * @param published The finding currently standing, or `'silent'` where none is.
 * @param verdict What this pass found.
 * @returns The finding to publish, `'clear'` to retract, or null to say nothing.
 */
export const publication = (
  published: MonitorVerdict,
  verdict: MonitorVerdict,
): 'gone' | 'idle' | 'clear' | null => {
  if (verdict === published) return null;
  return verdict === 'silent' ? 'clear' : verdict;
};

/**
 * One pass's readings of a desk, judged on their own.
 *
 * EVERY FIELD IS A DURATION OR A WORD THE DESK ALREADY RECORDS, which is what
 * lets one reading answer what `sample` needed two for. The condition that
 * required a comparison — *the tree did not move between passes* — is read here
 * as `treeQuietSeconds`, seconds since the newest thing in the tree changed.
 * That is a stronger statement than "unchanged across two passes 30 s apart",
 * and the filesystem had been recording it all along.
 *
 * NOTHING HERE IS FETCHED. The caller takes the readings and this scores them,
 * so the rule is a pure function of one value and testable without a clock.
 */
export interface DeskReading {
  /** Whether the recorded pid names a live process. */
  pid: PidStatus;
  /**
   * Whether THIS worker's conversation has written yet.
   *
   * A reading, never an absence. `false` means the probe ran and found no file;
   * a probe that could not run at all is the caller's problem to report as
   * something else, because `false` here withholds `idle` and a missing reading
   * must not.
   */
  spoken: boolean;
  /** Seconds since the newest transcript line, already clamped by the caller. */
  silenceSeconds: number;
  /**
   * Whether a child of the agent is burning CPU — a VETO, not the verdict.
   *
   * True only where the sampler answered `working`. A frozen subtree clock and
   * no child at all are both `false`: past the window, each is an agent that
   * has stopped. That is the opposite of how the removed two-sample rule read
   * the same sampler — there, the absence of a child was not the presence of
   * an idle one. Here the window has already elapsed before this field is
   * consulted at all.
   */
  childOnCore: boolean;
  /**
   * Seconds since the newest of: HEAD's committer time, each dirty path's
   * mtime, and each dirty path's parent directory's mtime below the desk root.
   */
  treeQuietSeconds: number;
  /** Whether the branch already carries commits that touched a file. */
  commits: CommitReading;
}

/**
 * Whether a duration reached the window — and whether it is a duration at all.
 *
 * WRITTEN AS `>=` AND NEGATED, NEVER AS `<`, and that is the whole reason this
 * is a function. `NaN` breaks numeric trichotomy: `NaN < 900`, `NaN > 900` and
 * `NaN === 900` are all false, so a guard reading `if (seconds < window) return
 * 'silent'` lets `NaN` straight through and answers `idle` on a reading nobody
 * took. Found 2026-10-02 by the test that asserts an unreadable duration is
 * silent — the guard was written the readable way and was wrong.
 *
 * `number` HOLDS `NaN`, so the type does not make this unnecessary. The shell's
 * copy validates digits with `case "$x" in *[!0-9]*)`, which refuses every
 * non-number there is; this is the same refusal in the language that needs it
 * spelled out, and it is what keeps the corpus pair from disagreeing on a
 * reading a caller translated badly.
 *
 * @param seconds The duration read, which may be no reading at all.
 * @param window Seconds the duration must reach.
 * @returns Whether this is a real duration that reached the window.
 */
const quietFor = (seconds: number, window: number): boolean =>
  Number.isFinite(seconds) && Number.isFinite(window) && seconds >= window;

/**
 * Whether this desk is idle, from one reading.
 *
 * SIX CONDITIONS, ALL OF THEM TOGETHER: the pid is alive, the conversation has
 * spoken, the transcript has been silent for at least the window, no child is
 * on a core, the tree has not moved for at least the window, and the branch
 * already carries work. Anything else is `silent`, which is not a finding and
 * is published nowhere.
 *
 * ONE READING IS NOT THE HAZARD THE OLD COMMENT WARNED ABOUT. *"A single idle
 * reading is a process caught between syscalls"* was written about a 0.4 s CPU
 * sample. Here each non-CPU condition is already a span of at least `window`
 * seconds, and the CPU is only a veto: a process caught between syscalls has
 * neither 900 seconds of transcript silence nor a 900-second-old tree.
 *
 * `≥ window`, NOT `>`. The window is the point at which the question becomes
 * worth asking, so a desk exactly at it is eligible — the same boundary
 * `quiet -lt window → busy` draws from the other side.
 *
 * A `dead` pid answers `silent` AND NOT `gone`. The wrapper that starts the
 * agent already knows the instant it ends and publishes `gone` itself, so this
 * rule has no `gone` arm and no caller needs one.
 *
 * AN UNREADABLE VALUE IS THE CALLER'S TO TRANSLATE, and every translation is
 * `silent`: an `unrecorded` pid, no transcript, no tree and an `unanswerable`
 * commit question each withhold the finding. A failure to observe is not
 * evidence of something to see — the rule `plot_worker_task_state` reached the
 * hard way after a fallback read every clean branch in a remote-less repository
 * as `stalled`.
 *
 * The commits condition is where the false positives would have been. An agent
 * given a hard first slice is quiet for a long time with nothing to show, and
 * calling that a stall is the cry-wolf that costs the finding its readers.
 *
 * @param reading What one pass measured of the desk.
 * @param window Seconds a duration must reach to count as quiet.
 * @returns `idle` where every condition holds, `silent` otherwise.
 */
export const idleNow = (reading: DeskReading, window: number): MonitorVerdict => {
  if (reading.pid !== 'alive') return 'silent';
  if (!reading.spoken) return 'silent';
  if (!quietFor(reading.silenceSeconds, window)) return 'silent';
  if (reading.childOnCore) return 'silent';
  if (!quietFor(reading.treeQuietSeconds, window)) return 'silent';
  return reading.commits === 'yes' ? 'idle' : 'silent';
};
