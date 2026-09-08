import type { BuildRun, ShaRun } from '../../entities/build.js';
import type { LimitReading } from '../../entities/limit.js';
import { unaskable, type PortResult } from '../../port-result.js';
import type { BuildPort, BuildSystem } from '../../ports/build.js';

/**
 * A CI system a repository never declared.
 *
 * EVERY OPERATION IS `unaskable`, and that is the point of having this rather
 * than an empty array. **An empty run list and an unaskable CI are different
 * facts**: the first says the system was asked and holds no run for this
 * branch, the second says there is no system to ask — and the board renders
 * them differently, because *no checks* and *not asked* mean opposite things
 * to a reader deciding whether to merge.
 *
 * That distinction is the estate's own standing rule. `plot-board-probe.sh`
 * treats an unrecognised auth answer as *cannot verify* and never as
 * *authenticated*, and a CI connector answering `[]` for an absence would break
 * it in the one place it costs a merge.
 *
 * IT IS NOT A FIXTURE. A fixture stands in for a service so a test need not
 * reach one; this stands for a real and common configuration — the default one
 * — where there is no service to reach.
 *
 * NO VENDOR IS NAMED HERE, deliberately. A repository with no CI has not chosen
 * one, so routing this case through a connector would make the absence wear a
 * vendor's failure shape.
 *
 * @returns a `BuildPort` that reaches nothing and says so.
 */
export const buildNone = (): BuildPort => ({
  system: (): BuildSystem => '',
  runs: async (): Promise<PortResult<readonly BuildRun[]>> => unaskable(),
  runForSha: async (): Promise<PortResult<ShaRun | null>> => unaskable(),
  limit: async (): Promise<PortResult<readonly LimitReading[]>> => unaskable(),
  // NEVER A REFUSAL. A CI system nobody declared is not refusing anything; it is
  // answering, permanently and correctly, that there is nothing to ask.
  lastRefusal: (): string | null => null,
});
