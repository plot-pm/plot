import fs from 'node:fs';
import path from 'node:path';

/**
 * THE IN-FLIGHT SET, SHARED BY EVERY BOARD ON ONE REPOSITORY.
 *
 * A branch a board has just dispatched is invisible: `plot-dispatch.sh` is
 * spawned detached, so on the next pulse it shows neither a manifest nor a claim
 * ref. `auto-dispatch.ts` covers that window with an in-flight set — but that set
 * lived in one process's memory, so a SECOND board on the same repository saw an
 * empty fleet and spent the whole budget again. Two boards seconds apart reached
 * `2 × parallelAgents`.
 *
 * This file is the same set, on disk, where every board reads it.
 *
 * ## Not a claim ref, and that distinction is the point
 *
 * `plot-dispatch.sh` stopped pushing a claim at dispatch when the hand-over
 * became the registry's, and re-adding one would reverse that decision as a side
 * effect of fixing a cap. A mark here is machine-local, gitignored, carries no
 * git object and blocks no push — it is a board telling the other boards on this
 * machine *I have already spent this slot*, and nothing more. Nothing outside
 * `.plot/state/` observes it.
 *
 * ## Modelled on `fleet-settings.ts`, which shares the cap's VALUE the same way
 *
 * Same directory, same read-fresh-every-call rule, same temp-plus-`rename` write
 * with the pid in the temp name — *"two board processes on one repo cannot hand
 * each other a torn file"*. What is copied is the mechanism; the failure rule is
 * deliberately the opposite. See {@link readInFlight}.
 *
 * ## Marks EXPIRE, and that is the trade this makes honest
 *
 * The cost of persisting is a board that dies mid-dispatch holding budget
 * forever. So every mark carries the wall-clock time it was written and is read
 * back only while it is younger than {@link IN_FLIGHT_TTL_MS}. A dead board's
 * marks retire on their own; a live board's are refreshed every pulse by
 * {@link writeInFlight}, so a mark expires exactly when nobody is renewing it.
 *
 * The TTL is the ONLY retirement path this file owns. The pulse-driven ones —
 * claimed, merged, gone, held by a live registry entry — stay in `pruneInFlight`
 * where they already are.
 */

/**
 * How long a mark counts against the budget with nothing renewing it.
 *
 * 90 seconds: long enough that a slow dispatch is never uncharged (the scan's
 * cadence is ~5 s, and a board renews its own marks every pulse, so a live board
 * refreshes each mark ~18 times before it could lapse), short enough that a
 * board killed mid-dispatch returns its budget within about a minute and a half
 * rather than until somebody notices.
 *
 * ERRING LONG IS THE SAFE DIRECTION, the asymmetry `runAutoDispatch` already
 * states: over-marking makes the fleet briefly more conservative, under-marking
 * is the bug this file exists to fix.
 */
export const IN_FLIGHT_TTL_MS = 90_000;

/** One board's marks, as they sit on disk. */
interface InFlightFile {
  /** Branch name → the epoch-millisecond time the mark was last renewed. */
  marks: Record<string, number>;
}

/**
 * Where the file lives: beside the pulse and the fleet controls, under
 * `.plot/state/`.
 *
 * Machine-local by construction and gitignored for it, the same as
 * `fleetSettingsPath`. A committed copy would be one machine telling another
 * which of ITS branches are mid-dispatch, which is a claim ref by another route.
 */
export function inFlightPath(repoRoot: string): string {
  return path.join(repoRoot, '.plot', 'state', 'auto-in-flight.json');
}

/**
 * Coerce anything on disk into a mark map, dropping what is not well-shaped.
 *
 * Forgiving in one direction only, the rule `coerce` in `fleet-settings.ts`
 * keeps: a mark whose timestamp is not a finite number is DROPPED rather than
 * guessed at. Dropping a mark is the unsafe direction here, which is why a
 * malformed FILE is a refusal ({@link readInFlight}) while a malformed ENTRY
 * inside an otherwise valid file is not: the first means the shared answer is
 * unknown, the second means one branch's mark is unreadable and the rest of the
 * file still says what the other boards are holding.
 */
function coerceMarks(raw: unknown): Record<string, number> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const marks = (raw as Record<string, unknown>).marks;
  if (typeof marks !== 'object' || marks === null) return null;
  const out: Record<string, number> = {};
  for (const [branch, at] of Object.entries(marks as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at)) out[branch] = at;
  }
  return out;
}

/** What a read of the shared marks answered. */
export interface InFlightReading {
  /**
   * The unexpired marks, or `null` when the file exists and could not be read.
   *
   * `null` is NOT an empty set and callers must not treat it as one — see
   * {@link readInFlight} for the failure direction, and
   * {@link sharedInFlightBlocks} for the one decision that turns on it.
   */
  branches: Set<string> | null;
  /** Why the reading failed, for the log. Empty when it did not. */
  error: string;
}

/**
 * The branches every board on this repository currently holds in flight, minus
 * the ones whose marks have expired.
 *
 * READ FRESH ON EVERY CALL, uncached, for `readFleetSettings`'s reason: neither
 * board process holds authoritative state in memory, both read this file, and
 * the file is the shared answer. A cache here would recreate the bug one layer
 * up.
 *
 * ## An unreadable file answers `null`, and `null` must start NOTHING
 *
 * THE OPPOSITE RULE FROM `readFleetSettings`, deliberately. That function falls
 * back to defaults on an unreadable file, and that is safe because a cap is a
 * number with a sensible default. This is not: the tempting fallback here is
 * *count what I can see*, which reproduces the bug exactly — a board that cannot
 * read the shared record concludes it is alone and spends the whole budget. Same
 * call `plot-pr-merged.sh` makes on an unreachable host: silence is never
 * permission.
 *
 * A MISSING file is the one case that is not a failure. It is the ordinary first
 * state — no board on this machine has dispatched anything — so it reads as an
 * empty set rather than as an unreadable one.
 */
export function readInFlight(repoRoot: string, now: number = Date.now()): InFlightReading {
  let raw: string;
  try {
    raw = fs.readFileSync(inFlightPath(repoRoot), 'utf8');
  } catch (err) {
    // ENOENT is the ordinary first state, not an error: nothing has been
    // dispatched on this machine, so the empty set IS the shared answer. Any
    // other errno (a permission denied, an I/O failure) is a file that exists
    // and cannot be read, which is the case that must refuse.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { branches: new Set(), error: '' };
    }
    return { branches: null, error: err instanceof Error ? err.message : String(err) };
  }
  let marks: Record<string, number> | null;
  try {
    marks = coerceMarks(JSON.parse(raw));
  } catch (err) {
    return { branches: null, error: err instanceof Error ? err.message : String(err) };
  }
  if (marks === null) {
    return { branches: null, error: 'in-flight file is not a mark map' };
  }
  const live = new Set<string>();
  for (const [branch, at] of Object.entries(marks)) {
    // Expired marks are not returned, so a board that died mid-dispatch stops
    // holding budget without anything having to notice it died.
    if (now - at < IN_FLIGHT_TTL_MS) live.add(branch);
  }
  return { branches: live, error: '' };
}

/**
 * Renew this board's marks and retire everything expired, atomically.
 *
 * MERGES RATHER THAN REPLACES. Two boards write this file and neither owns it:
 * a write that replaced the map would erase the other board's marks and hand
 * back the budget they are holding, which is the bug with extra steps. So the
 * file is re-read, the caller's branches are stamped `now`, and marks this board
 * does not name are kept at whatever time they already carried — they expire on
 * their own clock, or the board that owns them renews them on its next pulse.
 *
 * Temp file plus `rename`, with the pid in the temp name, the discipline
 * `writeFleetSettings` documents: `rename` is atomic within a filesystem, so a
 * reader mid-write sees the old file whole or the new file whole; and two
 * writers must not collide on one temp path.
 *
 * THE MERGE IS READ-MODIFY-WRITE AND IS NOT ATOMIC ACROSS PROCESSES. Two boards
 * writing in the same instant can lose one board's renewal of its own marks —
 * and that is survivable in exactly one direction: the lost renewal is a mark
 * that keeps its OLDER timestamp, so the worst case is a mark expiring up to one
 * pulse early, on a board that renews it again 5 seconds later. A lock would
 * close it, and the plan rules out a lock; the residue is bounded by the TTL
 * being ~18 pulses wide rather than one.
 *
 * Failures are swallowed and RETURNED rather than thrown. This runs on the
 * scan's success path beside the dispatch itself: a board that cannot write its
 * marks must still dispatch (it is the only board, or the only one holding the
 * budget), and the caller logs it. The read side is where the conservative
 * refusal lives.
 *
 * @returns the error message when the write failed, else the empty string.
 */
export function writeInFlight(
  repoRoot: string,
  branches: Iterable<string>,
  now: number = Date.now(),
): string {
  const file = inFlightPath(repoRoot);
  const marks: Record<string, number> = {};
  // Re-read so another board's marks survive this write. An unreadable file is
  // REPLACED here rather than refused: the read side already refuses on it, and
  // leaving a corrupt file in place would keep every board refusing forever.
  let existing: Record<string, number> | null = null;
  try {
    existing = coerceMarks(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    existing = null;
  }
  if (existing) {
    for (const [branch, at] of Object.entries(existing)) {
      // Expired marks are dropped at write time as well as at read time, so the
      // file does not grow without bound across a long-running board.
      if (now - at < IN_FLIGHT_TTL_MS) marks[branch] = at;
    }
  }
  for (const branch of branches) marks[branch] = now;

  const payload: InFlightFile = { marks };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return '';
}
