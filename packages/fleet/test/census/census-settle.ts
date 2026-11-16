// What the fleetd census entry reads to decide that fleetd's scan has settled.
// Pure, so `census-settle.unit.test.ts` covers it without `strace`.

/** What the entry read of fleetd's bridge, `.plot/state/last-pulse.json`. */
export interface BridgeReading {
  /** The file's text; `null` where the file is absent or unreadable. */
  text: string | null;
  /** The file's last write, epoch milliseconds of the real clock; `null` where the file is absent. */
  mtimeMs: number | null;
}

/**
 * Whether fleetd's bridge names a scan that is still running, or was written
 * so recently that the scan may still be in its automatic writes.
 *
 * `fleetScan` writes `attempt.outcome: 'running'` before `scanOnce` and the
 * landed or failed attempt after it. A scan between those writes may start no
 * child for longer than the entry's quiet window, so a child count alone can
 * read settled while the scan runs.
 *
 * @param bridge - the bridge as read.
 * @param nowMs - the real clock, epoch milliseconds.
 * @param quietMs - how long after its last write the bridge counts as settled.
 * @param boundMs - how long a `running` attempt counts as busy after its last
 *   write; past it the attempt counts as settled, so a scan that never records
 *   its end cannot hold a pass open.
 * @returns `true` while the attempt reads `running` within `boundMs` of the
 *   last write, or the last write is under `quietMs` old; `false` for an absent
 *   or unparseable bridge and for one with no attempt.
 */
export const scanBusy = (bridge: BridgeReading, nowMs: number, quietMs: number, boundMs: number): boolean => {
  if (bridge.text === null || bridge.mtimeMs === null) return false;
  const age = nowMs - bridge.mtimeMs;
  if (age < quietMs) return true;
  let outcome: unknown;
  try {
    outcome = (JSON.parse(bridge.text) as { attempt?: { outcome?: unknown } } | null)?.attempt?.outcome;
  } catch {
    return false;
  }
  return outcome === 'running' && age < boundMs;
};

/**
 * The census marks around consecutive passes, as `[from, to]` pairs.
 *
 * @param last - the number of the last pass.
 * @param count - how many passes, ending at `last`.
 * @returns one `[pass-(n-1), pass-n]` pair per pass, oldest first.
 */
export const passWindows = (last: number, count: number): [string, string][] =>
  Array.from({ length: count }, (_, i) => {
    const n = last - count + 1 + i;
    return [`pass-${n - 1}`, `pass-${n}`];
  });

/**
 * Whether fleetd's bridge records a scan that started at or after `sinceMs`
 * and has ended.
 *
 * `fleetScan` stamps `attempt.startedAt` from fleetd's `Date.now()` when the
 * scan starts and writes `outcome: 'ok'` or `'failed'` when it ends.
 *
 * @param bridge - the bridge as read.
 * @param sinceMs - the earliest start that counts, on the clock fleetd's
 *   `Date.now()` reads.
 * @returns `true` where the attempt started at or after `sinceMs` and its
 *   outcome is not `running`; `false` for an absent or unparseable bridge, a
 *   bridge with no attempt, an older attempt and a running one.
 */
export const scanEndedSince = (bridge: BridgeReading, sinceMs: number): boolean => {
  if (bridge.text === null) return false;
  let attempt: { startedAt?: unknown; outcome?: unknown } | undefined;
  try {
    attempt = (JSON.parse(bridge.text) as { attempt?: { startedAt?: unknown; outcome?: unknown } } | null)?.attempt;
  } catch {
    return false;
  }
  return typeof attempt?.startedAt === 'number' && attempt.startedAt >= sinceMs && typeof attempt.outcome === 'string' && attempt.outcome !== 'running';
};

/**
 * Whether a normal pass has settled: nothing in flight, the quiet window
 * passed since the last settle, and no scan running.
 *
 * `inFlight` counts direct children, in-process HTTP requests and supervision
 * ticks, so a tick that has started and not yet returned holds the pass open
 * across a gap in which it starts no child.
 *
 * @param reading - `inFlight`, the count in flight; `sinceSettledMs`, ms since
 *   the last settle; `scanBusy`, the bridge's reading; `quietMs`, the quiet window.
 * @returns `true` where `inFlight` is 0, `sinceSettledMs >= quietMs` and the scan is not busy.
 */
export const passSettled = (reading: { inFlight: number; sinceSettledMs: number; scanBusy: boolean; quietMs: number }): boolean =>
  reading.inFlight === 0 && reading.sinceSettledMs >= reading.quietMs && !reading.scanBusy;
