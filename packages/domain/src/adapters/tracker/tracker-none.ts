import type { Issue } from '../../entities/issue.js';
import type { LimitReading } from '../../entities/limit.js';
import { unaskable, type PortResult } from '../../port-result.js';
import type { StatusOutcome, Tracker, TrackerConfig } from '../../ports/tracker.js';

/**
 * A tracker a repository never declared.
 *
 * EVERY OPERATION IS `unaskable`, INCLUDING THE WRITE, and that is the point of
 * having this rather than a null. A caller handed `null` writes an `if` and
 * eventually forgets one; a caller handed this gets the same three-outcome
 * answer it gets everywhere else, and *nothing was written* arrives as a value
 * it must read rather than a silence it can miss.
 *
 * IT IS NOT A FIXTURE. A fixture stands in for a service so a test need not
 * reach one; this stands for a real and common configuration — the default one
 * — where there is no service to reach. Plans in the repository are the tracker,
 * and that is an answer rather than a gap.
 *
 * NO VENDOR IS NAMED HERE, deliberately. A repository with no tracker has not
 * chosen one, so routing this case through either connector would make the
 * absence wear a vendor's failure shape.
 *
 * @returns a `Tracker` that reaches nothing and says so.
 */
export const trackerNone = (): Tracker => ({
  config: (): TrackerConfig => ({ scheme: '', baseUrl: '' }),
  issueList: async (): Promise<PortResult<readonly Issue[]>> => unaskable(),
  issueView: async (): Promise<PortResult<Issue>> => unaskable(),
  statusWrite: async (): Promise<PortResult<StatusOutcome>> => unaskable(),
  limit: async (): Promise<PortResult<readonly LimitReading[]>> => unaskable(),
  // NEVER A REFUSAL. A tracker nobody declared is not refusing anything; it is
  // answering, permanently and correctly, that there is nothing to ask.
  lastRefusal: (): string | null => null,
});
