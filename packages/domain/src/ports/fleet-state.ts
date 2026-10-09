import type { PortResult } from '../port-result.js';
import type { FleetReading } from '../entities/fleet.js';

/**
 * The last good fleet pulse, bridged across process restarts.
 *
 * **WHY A PORT AND NOT A FIELD ON A CONNECTOR.** Nothing here reaches a remote
 * service — it reads and writes one local file — so it sits beside
 * `PrIndexStore` rather than beside `Host`.
 *
 * **ONE WRITER.** After `the-fleet-owns-the-scan-and-pr-index`, `plot-fleetd`
 * is the only process that calls `write`. The board reads; it does not write
 * while a fleet is running. Two writers would race on the same file, and
 * `rename` is atomic only for the write itself, never for the read-decide-write
 * sequence around it.
 *
 * **THE PULSE NEVER SAYS NO.** A missing, unparseable, wrong-version or expired
 * file is `answered(null)`, not `failed`. All four mean the same thing to the
 * caller — there is nothing trustworthy to serve — and that is the state of
 * every fresh process. `failed` is reserved for a store that could not be
 * asked at all.
 */
export interface FleetState {
  /**
   * Reads the bridged pulse, or `null` where there is nothing trustworthy to
   * serve.
   *
   * `null` covers every way of not having an answer: no file, an unreadable
   * one, a shape this build does not recognise, or one older than the
   * adapter's own expiry. Each ends in the same place — the caller renders as
   * though no scan has completed yet, which is true.
   *
   * @returns the bridged pulse, `null` where there is none to read, or `failed`.
   */
  read(): Promise<PortResult<BridgedPulse | null>>;

  /**
   * Writes the bridged pulse, replacing whatever was there.
   *
   * **ONLY EVER CALLED AFTER A SCAN SUCCEEDS.** A failed scan must not
   * overwrite the last good answer — the one thing standing between a restart
   * and an empty board.
   *
   * **A FAILED WRITE IS A VALUE, NEVER A THROW.** A read-only checkout or a
   * full disk must cost the caller nothing but a missed write.
   *
   * @param pulse - the bridge to write, carrying every field the board renders from.
   * @returns nothing on success; `failed` where the write did not land.
   */
  write(pulse: BridgedPulse): Promise<PortResult<void>>;
}

/**
 * What survives a restart: the pulse and the facts read on its own timer.
 *
 * The same shape `pulse-bridge.ts` defined before this port existed — six
 * fields, all six written together on every success so a thin or partial
 * write can never become the bridge's final content.
 */
export interface BridgedPulse {
  /** Epoch ms the scan that produced this completed — NOT when it was written. */
  at: number;
  pulse: FleetReading;
  /** Branch → minutes since its tip commit, or null. */
  ages: Map<string, number | null>;
  branchUrlBase: string;
  /** Plan basename → approval date, epoch ms. */
  approvedAt: Map<string, number>;
  /** Idea branch → the plan file it carries. */
  ideaPlans: Map<string, string>;
}
