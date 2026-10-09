import type { FleetReading } from '@plot-pm/domain';

import { runAutoDeliverPass } from './auto-deliver.js';
import { maybeAutoDispatch } from './auto-dispatch.js';
import type { ActOptions } from './action-log.js';
import { readMachine } from './machine-reading.js';
import { readFleetSettings } from './fleet-settings-store.js';
import { bashCleanliness, readAgentRegistryWithInfo } from './registry.js';

/**
 * Builds the pass that makes the fleet's automatic writes: auto-dispatch, then
 * auto-delivery, on the pulse the scan just wrote.
 *
 * The pass reads its inputs fresh: the settings file, the registry with
 * refreshed states, and one machine measurement. Dispatch runs before delivery
 * because a delivery frees a slice only on a later pulse, never in the same one.
 * In-flight marks for both writes persist under `.plot/state/`, so a daemon
 * restart inside their 90 s lifetime starts nothing twice.
 *
 * A delivery mark file that exists and cannot be read starts no delivery.
 *
 * @param opts - where the fleet acts; `scripts` is the daemon's own port.
 * @param warn - receives a one-line reason when the pass throws.
 * @returns the function to hand to {@link fleetScan} as `after`.
 */
export const fleetAutoWrites = (
  opts: ActOptions,
  warn: (line: string) => void,
): ((pulse: FleetReading) => Promise<void>) => {
  // IN MEMORY, FOR THE DAEMON'S LIFE: a restart loses it, the brief either
  // landed or did not, and the next pass asks again.
  const briefsAsked = new Set<string>();
  // WHAT THIS DAEMON DISPATCHED, the set it renews each pass. The shared marks
  // on disk are merged in by `maybeAutoDispatch` for the budget arithmetic.
  let own = new Set<string>();
  return async (pulse) => {
    try {
      const controls = await readFleetSettings(opts);
      const { entries } = await readAgentRegistryWithInfo(opts.repoRoot, undefined, {
        scriptsDir: opts.scriptsDir,
        cleanliness: bashCleanliness,
      });
      const machine = await readMachine(opts);
      own = maybeAutoDispatch(opts, pulse, controls, entries, own, machine, briefsAsked);
      runAutoDeliverPass(opts, pulse);
    } catch (e) {
      warn(`plot-fleetd: automatic writes failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
};
