import {
  type AgentRow,
} from '../../../contract/schema.js';
import { MARKS_CELL } from '../../components/TupleRow.js';
import { isActive, isLive } from './stuck.js';
import { rowKey } from './row-identity.js';

/**
 * How long a SEEN lock keeps the activity marker after the pulse that reported
 * it.
 *
 * **Six seconds, and the measurement decides it.** `.git/index.lock` exists for
 * a fraction of a second to a few seconds — one commit, one rebase step — while
 * `FLEET_POLL_MS` is 4 s. So most locks are born and die BETWEEN two pulses and
 * are never seen at all: the sharpest signal this board has is the one it most
 * often misses, and rendering it only for the instant it is observed would
 * render it almost never.
 *
 * Longer than one poll interval, so a lock seen in one pulse survives the next
 * one — which is the entire point, and the assertion a 3 s value would fail
 * against a 4 s clock. Short enough that it plainly reads as a marker rather
 * than as a state: two lockless pulses (8 s) always clear it.
 *
 * Not the same constant as `CHANGE_MARK_MS`, and not merged with it. That one
 * is calibrated against the 60 s PR refresh for a rare transition; this one is
 * calibrated against the 4 s fleet pulse for a signal that expires on its own.
 * One number serving two clocks is how a value gets tuned for one and silently
 * wrong for the other.
 */
export const LOCK_ECHO_MS = 6_000;

/**
 * The rows whose lock was seen recently enough to still be worth showing.
 *
 * **This is the one place this board lets a marker outlive its fact, and it is
 * bounded by three rules the plan settled — none of them optional:**
 *
 * *It never contradicts a later observation.* The echo only ever ADDS a row to
 * the marked set. A pulse reporting `localDirty` marks for its own reason and
 * needs no echo; a pulse reporting neither lets the echo expire on its own
 * clock and does not extend it. The row's NOTE is untouched throughout and goes
 * on reporting whatever the last pulse actually found — the echo makes a real
 * event visible, it never makes a claim the note would contradict.
 *
 * *A lock never resurrects.* The echo starts only where a lock was SEEN
 * (`localLocked` true in some pulse), never where one is inferred from dirt, an
 * age, or a group. Two lockless pulses therefore produce nothing at all: there
 * is no lock to echo, and inventing one would be the board asserting an event
 * it never observed.
 *
 * *It is a marker, not a state.* Each key clears itself on its own timer rather
 * than waiting for a pulse to clear it — the rule `ChangeMarks` already
 * follows, and what keeps a board whose server has died from sitting lit
 * forever. A frozen page shows its echoes expire and then shows nothing, which
 * is the honest end.
 *
 * Split out and driven by an injected clock for the same reason `ChangeMarks`
 * is: at the board's own rates the echo is invisible to a browser test —
 * `FLEET_POLL_MS` is 4 s, so an assertion "the marker survived a lockless
 * pulse" is really watching a timer that has not expired yet and passes just as
 * happily with the echo removed. Driven by hand, the rule is exact.
 */
export class ActivityEcho {
  private readonly timers = new Map<string, () => void>();
  private readonly lit = new Set<string>();

  constructor(
    private readonly onChange: (lit: ReadonlySet<string>) => void,
    private readonly schedule: (fn: () => void, ms: number) => () => void =
      (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
  ) {}

  /**
   * Record this pulse: every row seen holding a lock starts (or restarts) its
   * echo.
   *
   * **Restarted, not extended and not ignored** — the same rule `ChangeMarks`
   * documents. A lock still held on the next pulse is a longer write, not a
   * finished one, so the echo runs a full span from the latest sighting.
   *
   * Rows NOT holding a lock are left entirely alone: their echo, if any, keeps
   * running down its own clock. That is the "never extends, never contradicts"
   * half — this method is only ever told what was seen, never what was absent.
   */
  seen(locked: Iterable<string>): void {
    let touched = false;
    for (const key of locked) {
      touched = true;
      // Cancel first: the pending timeout belongs to the PREVIOUS sighting and
      // would otherwise take this one's echo with it when it fires.
      this.timers.get(key)?.();
      this.lit.add(key);
      this.timers.set(key, this.schedule(() => {
        this.timers.delete(key);
        this.lit.delete(key);
        this.onChange(new Set(this.lit));
      }, LOCK_ECHO_MS));
    }
    if (touched) this.onChange(new Set(this.lit));
  }

  /** Which rows are currently echoing a lock. */
  get echoing(): ReadonlySet<string> {
    return this.lit;
  }

  /** Drop every pending timer — the component is going away. */
  dispose(): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    this.lit.clear();
  }
}

/**
 * Which rows wear the activity marker: those active in THIS pulse, plus those
 * still echoing a lock seen in a recent one.
 *
 * A union, and the direction matters: the echo only ever adds. A row reporting
 * `localDirty` right now is marked for its own reason whether or not it ever
 * held a lock, and a row reporting nothing at all is marked only for as long as
 * a lock it was actually seen holding is still echoing.
 *
 * Exported for test — it is the whole rendering rule, and vitest runs with
 * `environment: 'node'`.
 */
export function activeRowKeys(
  rows: readonly AgentRow[],
  echoing: ReadonlySet<string>,
): Set<string> {
  const active = new Set<string>();
  for (const row of rows) {
    const key = rowKey(row);
    if (isActive(row) || echoing.has(key)) active.add(key);
  }
  return active;
}

/**
 * How long a changed row wears its marker.
 *
 * **Three seconds, and the measurement decides it — not taste.** The value this
 * watches comes from the host's PR refresh (`PR_REFRESH_MS`, 60 s), not from the
 * 4 s fleet pulse, and `PR_BACKOFF_MAX_MS` pushes it to 120 s under a rate
 * limit. So a transition can surface at most once a minute and often less: it is
 * a RARE event, and a 300 ms flash — calibrated for something frequent enough
 * that missing one hardly matters — would be missed nearly every time.
 *
 * Three seconds is long enough to catch a reader glancing back and short enough
 * that it plainly reads as a marker rather than as a state. Deliberately NOT
 * "until the next pulse": that would tie the marker's life to whichever clock
 * cleared it (4 s or 60 s), and would leave it lit forever on a board whose
 * server died — which is exactly when nothing is changing.
 */
export const CHANGE_MARK_MS = 3_000;

/** The six PR states plus *no PR*, as one value — the row's PR slot. */
export type WatchedPrState = NonNullable<AgentRow['pr']>['state'] | null;

/**
 * Every OBSERVED fact on a row, and no DERIVED TIME.
 *
 * **The boundary is the feature, not a caveat.** The request was *highlight the
 * whole line on every written update*, and a literal reading of "everything
 * visible" flashes a completely idle row once a minute: the note on a WORKING
 * row reads *"last commit 1 min ago"* and `ageMinutes` ticks beneath it, so
 * `1 min ago → 2 min ago` would be an "update". After an hour at the board every
 * row would have flashed sixty times and the marker would mean nothing.
 *
 * So the line is drawn where the contract already draws it:
 *
 * | Watched | Not watched | Because |
 * |---|---|---|
 * | `pr` (state, number, draft) | `ageMinutes` | derived from a timestamp and a clock |
 * | `localDirty`, `localLocked` | `waitingDays` | a SECOND clock, per its own doc |
 * | `localAhead` | `note` | it EMBEDS a clock — see below |
 * | `state`, `group`, `wave`, `phase` | | |
 * | `stuck` | | |
 *
 * **A fact changes because the world changed; a clock changes because time
 * passed**, and only the first is news.
 *
 * **`note` is excluded despite being server-observed**, and it is the trap this
 * whole rule exists to avoid. It is a sentence assembled around the ages —
 * *"last commit 18 min ago"* — so an implementation watching the row's rendered
 * note passes every positive assertion (a new commit really does rewrite it) and
 * flashes every row once a minute. Provenance is not sufficient here; what the
 * value is MADE OF decides.
 *
 * A new commit still flashes, which is the reported gap: the tip moving changes
 * `state`/`group`/`localAhead` — facts — even though the sentence beside them
 * changed for a clock's reason.
 */
export interface WatchedState {
  /** null where the row carries no PR at all — a value, not a gap. */
  pr: WatchedPrState;
  prNumber: number | null;
  prDraft: boolean | null;
  state: AgentRow['state'];
  group: AgentRow['group'];
  wave: string;
  phase: AgentRow['phase'];
  localDirty: boolean;
  localLocked: boolean;
  localAhead: number;
  /** Seconds since the newest write — the field that makes `true → true` a change. */
  /** The epoch second of the newest write — NOT the age, which ticks with the
      clock and would flash every row that has one on every pulse. */
  changedAt: number | null;
  /** Serialised, because `stuck` is an object and this map is compared by value. */
  stuck: string | null;
}

/**
 * The value each row is watched by.
 *
 * `pr` is `.nullable().default(null)` and MOST rows carry none — `not-started`,
 * `quiet`, and every fresh claim — so this reads through an optional chain
 * rather than `row.pr.state`, which crashes on precisely those rows.
 *
 * *No PR* is a value, not a gap: `null → pending` is a PR opening, often the
 * most interesting transition a branch has, and `pending → null` is one merged
 * or closed out from under the row. Both are the watched value changing, which
 * keeps the rule single instead of adding an exception about which changes
 * count.
 *
 * `stuck` is serialised rather than held as an object because the comparison
 * downstream is by value: two structurally equal `stuck` objects arrive as
 * different references on every pulse, and a reference test would flash every
 * stuck row four times a second.
 */
export function watchedState(row: AgentRow): WatchedState {
  // EVERY OBSERVED FACT, AND WRITING AMONG THEM.
  //
  // The three local fields are what make a WRITE an event here: the master
  // agent editing in the project directory, or a worker in its own worktree,
  // moves `localDirty`/`localLocked` and the row flashes. They sit beside the
  // host's facts rather than replacing them — a PR turning red, a row moving
  // section and a phase advancing are all changes worth a glance, and the flash
  // is the one mark that says *this row is not what it was*.
  //
  // The moving DOT is the mark that narrowed instead: it answers *is a process
  // running*, and its pace answers *is that process doing anything*. Two marks,
  // two questions — the flash reports history, the dot reports machines.
  return {
    pr: row.pr?.state ?? null,
    prNumber: row.pr?.number ?? null,
    prDraft: row.pr?.draft ?? null,
    state: row.state,
    group: row.group,
    wave: row.wave,
    phase: row.phase,
    localDirty: row.localDirty,
    localLocked: row.localLocked,
    localAhead: row.localAhead,
    // TRUE → TRUE IS STILL A CHANGE, and this is the field that can say so.
    //
    // `localDirty` is a SWITCH: it flips on the first keystroke of a session
    // and stays flipped for as long as anything is uncommitted. A detector
    // watching it therefore fires once and never again — measured on the live
    // board, three modified files and ZERO flashes across 40 seconds, because
    // the value had not moved since the morning.
    //
    // A timestamp has the shape the reader means. Every save moves it, so a row
    // that was already dirty and is written to again is a row whose watched
    // value changed.
    //
    // IT MUST BE THE INSTANT, NOT THE AGE, and this line watched the age until
    // 2026-08-24. `changed_ago_of` returns *seconds since* the newest evidence,
    // recomputed against `now` on every scan — so it ticks once a second whether
    // or not anything happened, which is exactly the property `ageMinutes` is
    // excluded from this map for having. Measured on the live board:
    // 71805 → 71824 across 12 quiet seconds, flashing 16 rows nobody had
    // touched in 19 hours, while the other 74 (no worktree, so a null age) never
    // flashed at all.
    //
    // `changedAt` is the epoch second the scan already had before it subtracted.
    // It moves only when a commit lands, a file is written, or the worker's log
    // grows. *A fact changes because the world changed* — a save is the world
    // changing; the clock ticking is not.
    changedAt: row.changedAt,
    stuck: row.stuck === null ? null : JSON.stringify(row.stuck),
  };
}

/**
 * Which rows changed since the last pulse, and what to remember for the next.
 *
 * Pure, and exported for test, because this is the whole rule: vitest runs with
 * `environment: 'node'`, so the decision lives here as a function over (prior,
 * current) and the browser tests are left to assert only what genuinely needs a
 * page.
 *
 * **`prior` distinguishes a MISSING key from a stored `null`, and the two mean
 * opposite things:**
 *
 * | `prior` holds | Means | This pulse |
 * |---|---|---|
 * | *(no entry)* | never observed this row | record silently |
 * | `null` | observed, and it had no PR | a move away from `null` marks |
 * | a state | observed, with that state | a different state marks |
 *
 * Collapsing the first two is the tempting simplification and it is wrong in a
 * way that hides itself: it passes the first-pulse assertion (nothing marks on
 * a fresh mount) and silences every branch's FIRST PR forever, because *never
 * seen* and *seen with no PR* would be indistinguishable. Hence a `Map` read
 * with `.has()` rather than a truthiness test.
 *
 * The first pulse after a load, a restart or a reconnect therefore marks
 * nothing: *unknown → conflicts* is a first sighting, not a transition, and
 * treating it as one would flash every row on every reload — the loudest
 * possible way to be wrong. A row that vanishes and returns starts silent for
 * the same reason.
 *
 * Every changed row is returned, with no threshold and no suppression: if ten
 * rows really did change, ten marks are the honest report, and a rule that goes
 * quiet exactly when the most changed would make the board least informative at
 * its most eventful moment.
 *
 * Rows ABSENT from this pulse are dropped from the returned memory rather than
 * carried: the map is one value deep per visible row, not a log.
 *
 * **`unknown` is not a transition, in either direction, and it is not
 * remembered.** See `isUnreadable`: it is a fact about the OBSERVATION, and
 * this function reports changes in the WORLD.
 */
export function changedRows(
  prior: ReadonlyMap<string, WatchedState>,
  rows: readonly AgentRow[],
): { changed: Set<string>; next: Map<string, WatchedState> } {
  const changed = new Set<string>();
  const next = new Map<string, WatchedState>();
  for (const row of rows) {
    const key = rowKey(row);
    const was = prior.get(key) ?? null;
    // An unreadable PR slot carries the LAST KNOWN value forward rather than
    // storing `unknown`, and that is what makes the suppression symmetric with
    // a single rule instead of two. Storing `unknown` would silence the
    // outage's first pulse and then flash on the recovery — or, worse, lose a
    // real change that happened during the outage: `green → unknown → failing`
    // must still flash, and it only can if the memory still holds `green` when
    // `failing` arrives. What is skipped is the moment, never the fact.
    //
    // **Per SLOT, not per row**, and that is what widening the watched value
    // forces: a GitHub 503 makes the PR unreadable and says nothing whatever
    // about whether a worktree is dirty. Freezing the whole record for the
    // outage's duration would suppress a real local change for a remote host's
    // reason — the marker going quiet exactly while an agent writes.
    const now = carryUnreadable(watchedState(row), was);
    // `.has()`, never a truthiness test — a stored value with a `null` PR is
    // KNOWN and an absent key is not, and the two are indistinguishable to one.
    if (prior.has(key) && !sameWatched(was!, now)) changed.add(key);
    next.set(key, now);
  }
  return { changed, next };
}

/**
 * The watched value with any UNREADABLE slot replaced by the last known one.
 *
 * Only `pr` can be unreadable: it is the sole watched fact with an `unknown`
 * value, because it is the sole one that comes from a remote host that can fail
 * to answer. Every other watched fact is observed by the local scan, which
 * either ran or did not — there is no third answer to carry across.
 *
 * **With NO prior value there is nothing to carry, and this is the case the
 * widening makes newly interesting.** Under the old scalar rule such a row was
 * not recorded at all: its only watched value was unreadable, so there was
 * nothing to remember. Now it carries nine other facts worth remembering, so it
 * IS recorded — and the question is what its PR slot should hold meanwhile.
 *
 * **DECIDED: it holds `unknown`, and `sameWatched` treats `unknown` as not
 * comparable rather than as a value.**
 *
 * The three answers to *what should the slot hold* are the same three this
 * repo keeps distinguishing, one field along: `null` means OBSERVED AND THERE
 * IS NO PR, a state means observed with that state, and `unknown` means I
 * COULD NOT ASK. Storing anything else here would invent an observation the
 * board never made — and a sentinel chosen to compare as *different* would
 * flash the host's recovery, which is news about GitHub rather than about the
 * branch.
 *
 * So the memory is honest and the COMPARISON carries the rule: an `unknown` on
 * either side answers neither *same* nor *changed*, because it is the absence
 * of an answer. That is exactly what the paragraph above already promises for
 * the carried case — *what is skipped is the moment, never the fact* — applied
 * to the one case that has no fact to carry yet.
 *
 * The stated cost: a row whose PR was never once readable does not flash on the
 * first state it is finally seen in. `prNumber` covers most of it — `null` to a
 * number IS a change and does flash — and the residue (a PR readable only from
 * its second state onward) is a moment lost about a host that was down, which
 * is the cheaper of the two errors.
 */
function carryUnreadable(now: WatchedState, was: WatchedState | null): WatchedState {
  if (!isUnreadable(now.pr) || was === null) return now;
  return { ...now, pr: was.pr, prNumber: was.prNumber, prDraft: was.prDraft };
}

/**
 * Whether two watched values describe the same world.
 *
 * By VALUE, field by field. The record is rebuilt from the row on every pulse,
 * so a reference test would call every row changed four times a second — and
 * `stuck` arrives as a fresh object each time, which is why `watchedState`
 * serialises it rather than leaving an object to be compared here.
 *
 * Exported for test: it is half the rule, and the half that decides whether a
 * ticking clock is news.
 */
export function sameWatched(a: WatchedState, b: WatchedState): boolean {
  // `unknown` on EITHER side is not a value, so it cannot differ from one. It
  // is the host saying *I could not answer*, and a comparison against silence
  // has no verdict — the row's other ten facts decide, exactly as they do while
  // a known value is being carried forward across an outage.
  //
  // Written as its own clause rather than folded into the equality so that the
  // asymmetry is visible: every other field below compares by value because
  // every other field HAS one.
  const prComparable = !isUnreadable(a.pr) && !isUnreadable(b.pr);
  return (!prComparable || a.pr === b.pr)
    && a.prNumber === b.prNumber
    && a.prDraft === b.prDraft
    && a.state === b.state
    && a.group === b.group
    && a.wave === b.wave
    && a.phase === b.phase
    && a.localDirty === b.localDirty
    // AND THE WRITE INSTANT, which is what makes `true → true` a change. Every
    // comparison here is spelled out one field at a time (see the note above),
    // so a field added to the map and not added HERE travels with the row and
    // is never compared — which is exactly what happened once: `changedAgo`
    // reached the row, moved on every save, and changed nothing.
    //
    // ADDING IT HERE THEN CAUSED THE OPPOSITE DEFECT, because the age ticks with
    // the clock: a dead field became a per-second ticker and every row with a
    // worktree flashed forever. The instant is what both fixes were reaching
    // for — compared here, and watched in the map above.
    && a.changedAt === b.changedAt
    && a.localLocked === b.localLocked
    && a.localAhead === b.localAhead
    && a.stuck === b.stuck;
}

/**
 * Whether a watched value describes the OBSERVATION rather than the world.
 *
 * `unknown` is the board saying *I cannot tell you right now*, and the marker
 * reports what CHANGED — so a move into or out of it is not a change and must
 * not flash.
 *
 * The cost of getting this wrong is measured, not hypothetical. GitHub's API
 * returned `503` at least four times in one afternoon on 2026-08-17, and once
 * `prState` reports unreadable mergeability honestly, each outage turns every
 * row `green → unknown` and the next pulse turns it back — **two flashes per
 * row per outage, for nothing that happened.** A marker that treats every
 * visible difference as a change turns each outage into a light show, and a
 * marker that cries wolf is worse than none: it is read once and then ignored,
 * including on the pulse where something real happened.
 *
 * This is the marker's OWN rule applied one level up. It already refuses to
 * flash on a first sighting — *unknown → conflicts* on a fresh mount is the
 * observation starting, not the branch changing — and this is the same
 * distinction arriving mid-session instead of at the beginning.
 *
 * What it costs: a real transition hidden behind an outage is not marked. Small,
 * and bounded — the state is re-read every 60 s, so the next readable pulse
 * shows the new value, and `changedRows` carries the last known value across the
 * gap so the change still flashes when it becomes visible. The marker misses the
 * moment, not the fact.
 *
 * Not folded into `watchedState`: that function answers *what is this row's
 * value*, and mapping `unknown` to `null` there would make it indistinguishable
 * from *no PR* — a row whose PR merged during an outage would then be
 * permanently confused with one whose mergeability could not be read.
 *
 * **It takes the PR SLOT, not the whole watched record**, because `pr.state` is
 * the only watched fact that can be unreadable — the only one whose source is a
 * remote host rather than the local scan. The principle is universal (*I cannot
 * say right now* is never a change in the world) and it happens to bind on
 * exactly one field, which is why the suppression is applied per slot in
 * `carryUnreadable` rather than to the row as a whole.
 *
 * NAMED FOR WHAT IT ANSWERS. It was `isUnreadable`, which reads as its own
 * opposite at every call site: it returns TRUE for `unknown`, the one value
 * that is not an observation. A predicate whose name inverts its answer is a
 * defect waiting for a reader in a hurry.
 *
 * Exported for test.
 */
export function isUnreadable(state: WatchedPrState): boolean {
  return state === 'unknown';
}

/**
 * The bookkeeping behind the markers: which keys are lit, and when each goes out.
 *
 * Split out of the hook and exported for test because the restart rule is not
 * observable through the board's own clocks. `FLEET_POLL_MS` is 4 s and a mark
 * lives 3 s, so two changes arriving on consecutive polls can never overlap —
 * a browser test "asserting" a restart is really watching a second mark replace
 * an expired first, and passes just as happily with the restart removed. (It
 * did: the sabotage was run.) Driven directly with a fake clock, the rule is
 * exact.
 *
 * `schedule` is the injection point for that clock — `setTimeout` in the app,
 * a controllable stub in the test.
 */
export class ChangeMarks {
  private readonly timers = new Map<string, () => void>();

  constructor(
    private readonly onChange: (lit: ReadonlySet<string>) => void,
    private readonly schedule: (fn: () => void, ms: number) => () => void =
      (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
  ) {}

  private readonly lit = new Set<string>();

  /**
   * Light every key in `changed`, each for a full `CHANGE_MARK_MS` from NOW.
   *
   * **A key already lit has its timer RESTARTED, not extended and not ignored.**
   * The marker claims *something is happening here*, and two changes in quick
   * succession make that more true, not less: an ignored second change would
   * let the first timer expire on its own schedule and imply nothing further
   * happened — the exact false statement the marker exists to prevent.
   */
  mark(changed: Iterable<string>): void {
    let touched = false;
    for (const key of changed) {
      touched = true;
      // Cancel first: the pending timeout belongs to the PREVIOUS change and
      // would otherwise take this one's marker with it when it fires.
      this.timers.get(key)?.();
      this.lit.add(key);
      this.timers.set(key, this.schedule(() => {
        this.timers.delete(key);
        this.lit.delete(key);
        this.onChange(new Set(this.lit));
      }, CHANGE_MARK_MS));
    }
    if (touched) this.onChange(new Set(this.lit));
  }

  /** Drop every pending timer — the component is going away. */
  dispose(): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    this.lit.clear();
  }
}

/**
 * The activity spinner's frame rate, and the fact each rate states: `fast`
 * where an agent writes in this checkout, `slow` where a row is claimed and no
 * write is observed.
 */
export type ActivityPace = 'fast' | 'slow';

/**
 * The pace of a row's activity spinner.
 *
 * | Row | Pace |
 * |---|---|
 * | `localDirty` or `localLocked` | `fast` |
 * | neither | `slow` |
 *
 * Callers show a spinner only where `isActive` holds; this answers the pace.
 * Both local fields default to `false` and are observed only on this machine,
 * so `slow` means *no write observed here*, not *nobody is writing*.
 *
 * @param row - the row's process, PR, state and local worktree signals.
 * @returns `fast` where the worktree shows a write, otherwise `slow`.
 */
export function activityPace(
  row: Pick<AgentRow, 'worker' | 'pr' | 'state' | 'localDirty' | 'localLocked'>,
): ActivityPace {
  return row.localLocked || row.localDirty ? 'fast' : 'slow';
}

/**
 * The pace a group's rows state together, or `null` where none carries a
 * spinner.
 *
 * Returns `fast` where any row is in `active`, otherwise `slow` where any row
 * is live (`isLive`), otherwise `null`. The strongest pace wins, so one
 * measured write is not hidden behind unobserved claims. It reads the same
 * `active` set the rows render from, so a heading cannot disagree with its
 * rows.
 *
 * @param rows - the group's rows.
 * @param active - the keys of the rows the fleet reports active (`isActive`,
 *   or a lock still echoing from a recent pulse).
 */
export function groupPace(
  rows: AgentRow[],
  active: ReadonlySet<string>,
): ActivityPace | null {
  let slow = false;
  for (const row of rows) {
    if (active.has(rowKey(row))) return 'fast';
    if (isLive(row)) slow = true;
  }
  return slow ? 'slow' : null;
}

/**
 * The pace a section or group heading shows: the rows' pace while the heading
 * is collapsed, and `null` while it is open, because the open rows show their
 * own spinners.
 *
 * @param pace - the rows' pace, from `groupPace`.
 * @param folded - whether the heading hides its rows.
 */
export const headingPace = (pace: ActivityPace | null, folded: boolean): ActivityPace | null =>
  folded ? pace : null;

/**
 * Where the marks of a row sit outside a marks track: the row's marks cell,
 * `MARKS_CELL`.
 */
export const ACTIVITY_MARK_PLACE = {
  row: MARKS_CELL,
} as const;
