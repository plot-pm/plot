import { useEffect, useRef, useState } from 'react';

/**
 * The board-status panel — one box at the top that carries every status the
 * board has to report, one at a time, with the rest a page away.
 *
 * bug/a-degraded-view-says-so-at-the-top, as CORRECTED. The first reading of
 * this made each failure its own banner in the `UnreachableOverlay` frame — one
 * frame per condition, which is one-per-condition wearing a different coat: two
 * problems stack two frames, and a third pushes the rows down the page. The
 * operator's correction is the right shape — a fixed-size box that holds every
 * status, names how many it holds, and pages through them.
 *
 * TWO SURFACES, TWO QUESTIONS. This answers *is something wrong?* and lives at
 * the top. The view-status line — `74 branches … · scanned 4s ago · PR data 16s
 * ago` — answers *how fresh is what I see?*, is ALWAYS true, and stays at the
 * foot where the eye lands after the rows. A line that is always true cannot
 * live in a panel whose whole contract is to VANISH when there is nothing to
 * say, so the two do not merge.
 *
 * SEVERITY FIRST, ARRIVAL SECOND. The reader's first line is always the worst
 * thing — a dead server outranks a broken scan outranks a shrink outranks a
 * spent host. Within one severity the newest sorts first. A status that has
 * just ARRIVED is worth interrupting for, so it flashes at the top of the stack
 * for a few seconds and then sorts into its place; permanence is not worth
 * interrupting for, so it stops flashing. This is the distinction
 * `the-line-flashes-on-any-written-update` already draws.
 */

/** One thing the board has to report. */
export interface BoardStatus {
  /** Stable identity across pulses — what arrival and paging are keyed on. */
  key: string;
  /**
   * How loud this is. Higher sorts first. A dead server (the whole view is
   * gone) outranks a scan that broke, which outranks a shrink, which outranks a
   * host that answered partially.
   */
  severity: number;
  /** The sentence the reader reads. */
  text: string;
  /**
   * `rose` for *not reaching the board server* — the whole view dead — and
   * `amber` for the lesser states where the rows below are still worth reading.
   */
  tone: 'rose' | 'amber';
}

const TONE: Record<BoardStatus['tone'], string> = {
  rose: 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
};

/** How long a newly-arrived status flashes at the top before sorting in. */
export const FLASH_MS = 4000;

/**
 * Order a set of statuses for display: the flashing arrivals first (newest
 * arrival first), then the rest by severity, then by arrival within a severity.
 *
 * A PURE FUNCTION of the statuses and what is flashing, exported so the order
 * can be pinned without a browser — the arrival flash is invisible to a test
 * driven at the board's own rates, exactly as `ActivityEcho` is.
 *
 * `arrivalOrder` numbers statuses by when they were first seen (larger = more
 * recent). `flashing` is the subset still inside their flash window.
 */
export function orderStatuses(
  statuses: readonly BoardStatus[],
  flashing: ReadonlySet<string>,
  arrivalOrder: ReadonlyMap<string, number>,
): BoardStatus[] {
  const arrival = (s: BoardStatus) => arrivalOrder.get(s.key) ?? 0;
  return [...statuses].sort((a, b) => {
    const aFlash = flashing.has(a.key);
    const bFlash = flashing.has(b.key);
    // A flashing arrival is pinned to the top, whatever its severity — the
    // reader is owed the news before the ranking. Two flashing at once sort by
    // arrival, newest first.
    if (aFlash !== bFlash) return aFlash ? -1 : 1;
    if (aFlash && bFlash) return arrival(b) - arrival(a);
    // Settled statuses: severity first, then newest arrival within a severity.
    if (a.severity !== b.severity) return b.severity - a.severity;
    return arrival(b) - arrival(a);
  });
}

/**
 * Track which statuses have just arrived and are still flashing, and the order
 * they arrived in. Driven by an injected clock so a test can advance it by hand
 * — a real flash is seconds long and would never be observed otherwise.
 */
function useArrivals(keys: readonly string[]): {
  flashing: ReadonlySet<string>;
  arrivalOrder: ReadonlyMap<string, number>;
} {
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef<Map<string, number>>(new Map());
  const counter = useRef(0);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // The statuses already present when the panel FIRST mounts are not arrivals —
  // a board that opens with three existing problems must not strobe all three.
  // The flash is for a status that appears while the reader is watching, so the
  // initial set is recorded as seen without flashing, and only later additions
  // interrupt.
  const mounted = useRef(false);

  useEffect(() => {
    const present = new Set(keys);
    // A key gone from the set is forgotten, so the same condition recurring
    // later flashes again — a rate limit that clears and returns is news twice.
    for (const key of [...seen.current.keys()]) {
      if (!present.has(key)) {
        seen.current.delete(key);
        const timer = timers.current.get(key);
        if (timer) { clearTimeout(timer); timers.current.delete(key); }
      }
    }
    // A key not seen before has just arrived: record its arrival order, and — if
    // this is not the first mount — start it flashing until the window closes.
    const flashOnArrival = mounted.current;
    let added = false;
    for (const key of keys) {
      if (!seen.current.has(key)) {
        seen.current.set(key, ++counter.current);
        if (!flashOnArrival) continue;
        added = true;
        setFlashing((prev) => new Set(prev).add(key));
        const timer = setTimeout(() => {
          setFlashing((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          timers.current.delete(key);
        }, FLASH_MS);
        timers.current.set(key, timer);
      }
    }
    mounted.current = true;
    // Drop any flashing keys that have since left the set.
    if (!added) {
      setFlashing((prev) => {
        const next = new Set([...prev].filter((k) => present.has(k)));
        return next.size === prev.size ? prev : next;
      });
    }
    // The join key is the set of keys — joined on `\0` (the ESCAPE, never a
    // literal: a literal NUL is unreadable in a diff and the repo forbids it),
    // because a status key never contains one, so two different sets cannot
    // collide into one dependency string. This effect runs once per change in
    // what is present, not on every pulse.
  }, [keys.join('\0')]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
  }, []);

  return { flashing, arrivalOrder: seen.current };
}

export interface StatusPanelProps {
  /** Every status currently true, in any order — the panel ranks them. */
  statuses: readonly BoardStatus[];
}

export function StatusPanel({ statuses }: StatusPanelProps) {
  const keys = statuses.map((s) => s.key);
  const { flashing, arrivalOrder } = useArrivals(keys);
  const [index, setIndex] = useState(0);

  const ordered = orderStatuses(statuses, flashing, arrivalOrder);

  // Paging index clamps to the current stack: a status clearing while its page
  // is showing must not leave the reader on a page that no longer exists.
  const safeIndex = ordered.length === 0 ? 0 : Math.min(index, ordered.length - 1);
  useEffect(() => {
    if (index !== safeIndex) setIndex(safeIndex);
  }, [index, safeIndex]);

  // ABSENT WHEN EMPTY. An empty status box is a claim that the board is watching
  // something; a healthy board is not, so it renders nothing at all.
  if (ordered.length === 0) return null;

  const shown = ordered[safeIndex];
  const count = ordered.length;

  return (
    <div
      data-status-panel
      role="status"
      aria-live="polite"
      className={`rounded-md px-4 py-3 text-sm ${TONE[shown.tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p data-status-text className="break-words">
          {shown.text}
        </p>
        {/* The count and the paging live together: a reader must know both that
            there are others and how to reach them. Rendered only when there IS
            more than one — a single status needs no navigation and no "1
            status" tally to read past. */}
        {count > 1 && (
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <button
              type="button"
              data-status-prev
              aria-label="Previous status"
              className="rounded px-1 leading-none hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => setIndex((i) => (i - 1 + count) % count)}
            >
              ‹
            </button>
            <span data-status-count className="tabular-nums">
              {safeIndex + 1} of {count} statuses
            </span>
            <button
              type="button"
              data-status-next
              aria-label="Next status"
              className="rounded px-1 leading-none hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => setIndex((i) => (i + 1) % count)}
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
