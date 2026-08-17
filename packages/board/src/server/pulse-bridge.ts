import fs from 'node:fs';
import path from 'node:path';
import { FleetPulseSchema, type FleetPulse } from '../contract/schema.js';

/**
 * The last good pulse, on disk, so a restart does not serve an empty board.
 *
 * ## The defect
 *
 * Measured on 2026-08-17 with five agents in flight: the Agents tab rendered
 * **`0 branches across 0 plans`** — an EMPTY view, not a stale one. Three of the
 * five agents were editing files under `packages/board/`, and the operator's
 * board runs under `node --watch`, so every save restarted the server.
 *
 * The cache that should have covered this already exists and its design is
 * right: `fleet.ts` keeps one entry per repo, every request reads it, and the
 * scan refreshes it asynchronously — which is why the tab polls at 4 s without
 * running a scan per request. It is **process memory**, and that is the whole
 * defect. A freshly restarted process has no cached pulse to fall back on, so
 * the *degrade, do not hide* behaviour from #141 has nothing to degrade *to*:
 * the banner worked perfectly and named the exact failing command, and there
 * was simply no last-good payload behind it.
 *
 * So the in-memory cache gains a copy on disk. Nothing about the cache changes;
 * this only lets it outlive the thing it protects against.
 *
 * ## Why the file AND an immediate rescan
 *
 * Rescanning at startup was the obvious alternative and is not enough on its
 * own. A scan costs 500–1050 ms, and a cold boot was measured at 21.2 s during
 * the dimming work — scanning at startup narrows the empty window without
 * closing it, and a `--watch` restart storm reopens it on every save. The file
 * alone is the mirror failure: it leaves the board stale until the next poll.
 *
 * The two compose rather than compete, so `ensureCache` does both — the file
 * covers the gap, the scan ends it.
 *
 * ## A bridge, not a store
 *
 * Plot derives state from git (Manifesto Principle 1), and a JSON file that
 * outlives its usefulness is a second source of truth that can disagree with
 * the repository. Past {@link BRIDGE_MAX_AGE_MS} the honest answer is *no
 * data* — which is what the board says today, and is correct once the numbers
 * are meaningless. The file is a cache with an expiry, never a record.
 *
 * It is not the authority even while it is being served:
 *
 * - a scan that SUCCEEDS replaces it immediately, and
 * - a scan that FAILS does not overwrite it — the same one-directional rule the
 *   local signals obey. A failure must not destroy the last good answer, which
 *   is the only thing standing between a restart and an empty board.
 *
 * The payload is served through #141's existing stale rendering — the banner,
 * the `(frozen)` footer, the stopped clocks — rather than through a second
 * vocabulary for "these numbers are old".
 */

/**
 * How old a bridged pulse may be before it is discarded unread.
 *
 * The window this exists to cover is a `node --watch` restart: measured in
 * seconds, occasionally the 21.2 s of a cold boot. Fifteen minutes is far
 * longer than that on purpose — a board reopened after lunch should still get
 * *something* labelled with its age rather than an empty page — and far shorter
 * than the horizon over which a fleet's branches change out from under it.
 *
 * Past it the file is not merely stale, it is about a different repository
 * state, and every honest thing the page could say about it is "no data".
 */
export const BRIDGE_MAX_AGE_MS = 15 * 60_000;

/**
 * Bumped when the payload shape changes incompatibly. A file this build does
 * not recognise is dropped rather than coerced — the cost is one empty poll,
 * and the alternative is a confidently wrong board.
 */
const BRIDGE_VERSION = 1;

/** What survives a restart: the pulse and the facts read on its own timer. */
export interface BridgedPulse {
  /** Epoch ms the scan that produced this completed — NOT when it was written. */
  at: number;
  pulse: FleetPulse;
  /** Branch → minutes since its tip commit, or null. */
  ages: Map<string, number | null>;
  branchUrlBase: string;
  /** Plan basename → approval date, epoch ms. */
  approvedAt: Map<string, number>;
  /** Idea branch → the plan file it carries. */
  ideaPlans: Map<string, string>;
}

/**
 * Where the file lives, per repo: beside the rest of `.plot`, under `state/`.
 *
 * Machine-local by construction — it describes worktrees and refs on THIS
 * machine — so it is gitignored rather than committed. A checked-in pulse would
 * be one repository telling another what its branches are doing.
 */
export function bridgePath(repoRoot: string): string {
  return path.join(repoRoot, '.plot', 'state', 'last-pulse.json');
}

/** Maps do not survive `JSON.stringify`; entry arrays do. */
function toEntries<K extends string, V>(map: Map<K, V>): [K, V][] {
  return [...map.entries()];
}

/**
 * Rebuild a Map from whatever was on disk, keeping only well-shaped pairs.
 *
 * Deliberately forgiving in one direction only: a malformed entry is DROPPED,
 * never guessed at. A missing age renders as unknown, which the row already
 * handles; an invented one would be a confident lie in the one place the page
 * is trying to be honest about what it knows.
 */
function toMap<V>(raw: unknown, valid: (v: unknown) => v is V): Map<string, V> {
  const map = new Map<string, V>();
  if (!Array.isArray(raw)) return map;
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [key, value] = pair as [unknown, unknown];
    if (typeof key !== 'string') continue;
    if (!valid(value)) continue;
    map.set(key, value);
  }
  return map;
}

const isAge = (v: unknown): v is number | null => v === null || typeof v === 'number';
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isString = (v: unknown): v is string => typeof v === 'string';

/**
 * Write the last good pulse. Only ever called after a scan SUCCEEDS.
 *
 * Written through a temp file and renamed, because `rename` is atomic within a
 * filesystem: a reader that starts while the writer is mid-write sees the old
 * file whole or the new file whole, never half of either. Two board servers on
 * one repo — routine here — would otherwise be able to hand each other a
 * truncated payload.
 *
 * Every failure is swallowed on purpose. A read-only checkout, a full disk, a
 * `.plot` nobody may write to: none of that is a reason for the board to stop
 * serving, and the cost of the miss is exactly today's behaviour.
 */
export function writeBridge(repoRoot: string, data: BridgedPulse): void {
  const file = bridgePath(repoRoot);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload = JSON.stringify({
      version: BRIDGE_VERSION,
      at: data.at,
      pulse: data.pulse,
      ages: toEntries(data.ages),
      branchUrlBase: data.branchUrlBase,
      approvedAt: toEntries(data.approvedAt),
      ideaPlans: toEntries(data.ideaPlans),
    });
    // The temp name carries the pid: two servers writing at once must not
    // collide on the SAME temp file, which would produce exactly the torn
    // payload the rename exists to prevent.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    /* a board that cannot write its bridge still serves — it just cannot span a restart */
  }
}

/**
 * Read the bridged pulse, or null when there is nothing trustworthy to serve.
 *
 * Null covers every way of not having an answer, and they are deliberately not
 * distinguished here: no file, an unreadable one, a shape this build does not
 * know, a pulse that no longer validates, or one older than
 * {@link BRIDGE_MAX_AGE_MS}. Each ends in the same place — the board says it is
 * waiting for its first scan, which is true.
 *
 * The pulse is re-validated through `FleetPulseSchema` rather than trusted: the
 * file is written by a build that may not be this one, and the board's rule for
 * host data (parse, do not assume) is not weaker for data it wrote itself.
 */
export function readBridge(repoRoot: string, now = Date.now()): BridgedPulse | null {
  let raw: string;
  try {
    raw = fs.readFileSync(bridgePath(repoRoot), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== BRIDGE_VERSION) return null;
    const at = parsed.at;
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    // A file from the FUTURE is as untrustworthy as an ancient one — a clock
    // that moved backwards, or a copied checkout — and `now - at` would read it
    // as freshly written. Rejected rather than clamped.
    const age = now - at;
    if (age < 0 || age > BRIDGE_MAX_AGE_MS) return null;
    const pulse = FleetPulseSchema.parse(parsed.pulse);
    return {
      at,
      pulse,
      ages: toMap(parsed.ages, isAge),
      branchUrlBase: typeof parsed.branchUrlBase === 'string' ? parsed.branchUrlBase : '',
      approvedAt: toMap(parsed.approvedAt, isNumber),
      ideaPlans: toMap(parsed.ideaPlans, isString),
    };
  } catch {
    return null;
  }
}
