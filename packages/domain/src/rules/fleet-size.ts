import type { Headroom } from '../entities/machine.js';

/**
 * How many agents a start defaults to.
 *
 * **THREE.** Small enough to be wrong about cheaply, large enough to prove the
 * hand-over matches more than one agent to more than one slice: a fleet of one
 * cannot distinguish *the registry assigned* from *the only agent took the only
 * slice*.
 *
 * It is not `--max`, and the two are different quantities that a shared name
 * would merge. `--max` bounds how many agents ONE TICK may act on — a rate
 * limit on decisions. This is how many workers the machine runs at once.
 */
export const DEFAULT_FLEET_SIZE = 3;

/** What one start read of the machine and the fleet already on it. */
export interface FleetSizeReadings {
  /**
   * How many agents were asked for.
   *
   * A REQUEST, never a promise. `DESIGN-machine.md` measures *"7 workers died
   * `exit 124`"* against *"five workers ran fine at load 10"*, so the machine
   * has the last word and this is the first.
   */
  requested: number;
  /**
   * How many workers are already running on this machine.
   *
   * Counted rather than predicted: `DESIGN-agent.md:173` — *"a dispatch never
   * asks the machine for capacity"* — and `0 free` is a count of the same kind
   * as *this branch is claimed*.
   */
  running: number;
  /**
   * What one fork cost, in milliseconds, or `null` where nothing measured it.
   *
   * Carried for the SENTENCE and never for the verdict: the shortfall quotes it
   * so an operator can see what the machine was doing, and {@link headroom} is
   * what decides. Two fields for one measurement is deliberate — the derivation
   * is `headroomFor`'s and re-running it here would be a second copy of the
   * thresholds.
   */
  spawnCostMs: number | null;
  /**
   * What that cost came to, as `headroomFor` reads it.
   *
   * A READING, NOT A DERIVATION. The caller has already asked the Machine
   * entity — the same discipline `QueuedSlice.briefPresent` follows, and for
   * the same reason: a rule that re-derived it would have to decide what
   * *starved* means a second time, and the two spellings would drift.
   *
   * `unmeasured` is what an unsampled machine answers, and it is not `starved`.
   */
  headroom: Headroom;
}

/** What a start decided, and enough to say why. */
export interface FleetSize {
  /** How many agents to start now. */
  start: number;
  /** How many were asked for. */
  requested: number;
  /** How many workers were already running. */
  running: number;
  /** What the machine reading came to. */
  headroom: Headroom;
  /**
   * Why fewer than requested, or `''` when the request was met in full.
   *
   * A sentence rather than a code, because it goes to an operator who then runs
   * the command again. **The shortfall is reported and never remembered** — no
   * target is stored, so the second run re-derives everything this one did.
   */
  shortfall: string;
}

/**
 * How many workers a starved machine may still be asked for.
 *
 * **ONE, NOT ZERO.** A starved machine that starts nothing is a fleet that can
 * never recover on its own: the load that starves it comes from work already
 * running, and refusing outright means an operator must watch for the moment it
 * clears. One agent makes progress at the cost the machine can currently bear,
 * and the shortfall names the reading so nobody reads it as the request being
 * met.
 */
const STARVED_CEILING = 1;

/**
 * How many workers a tight machine may be asked for at once.
 *
 * `tight` is the band between the two headroom thresholds — the machine is
 * working but still answering. Two is the default's request minus the one a
 * starved machine still gets, which is a shape rather than a measurement and is
 * stated as such: nothing here has been measured at the tight edge, and a
 * number that pretended otherwise would be a claim.
 */
const TIGHT_CEILING = 2;

/**
 * How many agents this start may bring into existence.
 *
 * **THE COUNT IS A REQUEST AND THE MACHINE HAS THE LAST WORD.** The request is
 * reduced by what is already running and then by what the machine can bear, in
 * that order: a fleet already at its size needs nothing started whatever the
 * load, and a starved machine gets a smaller number rather than a refusal.
 *
 * **AN UNMEASURED MACHINE IS NOT A STARVED ONE.** `headroom: 'unmeasured'`
 * means nobody sampled. It is treated as clear: the reading is the machine's
 * own veto, and an absent veto is not a refusal. A caller that wants the
 * machine consulted takes the sample.
 *
 * **NOTHING IS REMEMBERED.** A start that gives two of three says so and
 * returns; the operator runs it again. A stored target would be the first piece
 * of state in a component whose statelessness is measured rather than assumed.
 *
 * @param readings - the request, the fleet already running, and the machine.
 * @returns how many to start, and why it is fewer than asked for.
 */
export const fleetSize = (readings: FleetSizeReadings): FleetSize => {
  const headroom = readings.headroom;
  const requested = Math.max(0, Math.trunc(readings.requested));
  const running = Math.max(0, Math.trunc(readings.running));

  // THE FLEET ALREADY ON THE MACHINE IS SUBTRACTED FIRST, because `start N`
  // asks for a fleet of N rather than for N more. Running it twice must not
  // give six agents, and an operator who lost track of what is up must be able
  // to ask for the size they want rather than the difference.
  const wanted = Math.max(0, requested - running);
  if (wanted === 0) {
    return {
      start: 0,
      requested,
      running,
      headroom,
      shortfall:
        requested === 0
          ? ''
          : `started 0 of ${requested} — ${running} worker${running === 1 ? '' : 's'} already running, which is the fleet you asked for`,
    };
  }

  const ceiling = ceilingFor(headroom);
  const start = Math.min(wanted, ceiling);
  if (start === wanted) {
    return { start, requested, running, headroom, shortfall: '' };
  }

  return {
    start,
    requested,
    running,
    headroom,
    shortfall: `started ${start} of ${wanted} — the machine is at its bound (${headroom}, one fork costs ${format(readings.spawnCostMs)}, ${running} worker${running === 1 ? '' : 's'} already running). Run it again when it clears.`,
  };
};

/**
 * The most agents one start may bring up at this headroom.
 *
 * @param headroom - what the machine reading came to.
 * @returns the ceiling; `Infinity` where the machine does not bound it.
 */
const ceilingFor = (headroom: Headroom): number => {
  if (headroom === 'starved') return STARVED_CEILING;
  if (headroom === 'tight') return TIGHT_CEILING;
  // `clear` and `unmeasured` alike: the machine is not vetoing, so the request
  // is what bounds the start.
  return Number.POSITIVE_INFINITY;
};

/**
 * The spawn cost, for a sentence an operator reads.
 *
 * @param spawnCostMs - the reading, or null where nothing measured it.
 * @returns the cost with its unit, or `unmeasured`.
 */
const format = (spawnCostMs: number | null): string =>
  spawnCostMs === null ? 'unmeasured' : `${Math.round(spawnCostMs)}ms`;
