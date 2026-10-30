import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { RepairRecord } from '@plot-pm/domain/entities/repair-record';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { Host } from '@plot-pm/domain/ports/host';
import type { RepairRecordStore } from '@plot-pm/domain/ports/repair-record';
import type { Containment, Refs } from '@plot-pm/domain/ports/refs';
import { mainRepairBranchOf } from '@plot-pm/domain/rules/repair-pr';
import { redMainStep } from '@plot-pm/domain/rules/repair';
import { rerunSettledOf } from '@plot-pm/domain/rules/repair-start';

/** What one repair-start pass did, for the log and the tests. */
export type RepairStartOutcome =
  | 'none'
  | 'held'
  | 'awaiting-rerun'
  | 'rerun-asked'
  | 'claim-lost'
  | 'claim-failed'
  | 'role-started'
  | 'role-failed'
  | 'awaiting-repair'
  | 'review-started'
  | 'review-refused';

/** What one repair-start pass reads and acts through. */
export interface RepairStartWorld {
  /** The default-branch reading, or null where there is none. */
  reading(): Promise<DefaultBranchReading | null>;
  /** The repair record's file. */
  repair: RepairRecordStore;
  /** Ancestry of the record's first red SHA. */
  refs: Pick<Refs, 'contains'>;
  /** The CI connector: the first red SHA's runs, and the re-run. */
  build: Pick<BuildPort, 'runsForSha' | 'rerunFailed'>;
  /** The host: the fix branch's PR, asked per branch. */
  host: Pick<Host, 'prState'>;
  /** The default branch's remote tip, the base of the claim commit; null where it could not be read. */
  baseSha(): Promise<string | null>;
  /** Pushes an empty claim commit for the branch without a checkout. */
  claim(branch: string, baseSha: string): Promise<'won' | 'lost' | 'failed'>;
  /** Whether this machine holds a desk for the branch. */
  hasDesk(branch: string): Promise<boolean>;
  /** Creates the desk where absent and starts the `main-repair` role in it. */
  startRole(branch: string): Promise<'started' | 'failed'>;
  /** Whether the branch's role run is alive on this machine. */
  roleAlive(branch: string): boolean;
  /** Starts the review of the fix PR's head. */
  review(pr: number, head: string): Promise<'started' | 'refused'>;
  /** Runs one host call, inside a host slot where the CI system is GitHub Actions. */
  slot<T>(call: () => Promise<T>): Promise<T>;
  /** Epoch ms. */
  now(): number;
  /** The `Checks wait` bound, in milliseconds. */
  checksWaitMs: number;
  /** The `Main repair bound`, in milliseconds. */
  mainRepairBoundMs: number;
  /** The workflow names `Default branch checks` declares. */
  checks: readonly string[];
}

/**
 * Takes the next repair step for a red default branch: the re-run, the claim
 * and start of the repair role, and the review of the fix PR.
 *
 * Reads the record and the reading, asks `redMainStep`, and acts on three of
 * its answers; `revert`, `close-prs` and `exhausted` are left to their own
 * callers. A held host answer (`unaskable` or `failed`) ends the pass with
 * `held` and writes nothing.
 *
 * - `await-rerun`: re-runs the first red SHA's failed jobs once, then records
 *   `rerun: 'asked'`.
 * - `start-repair`: claims `bug/main-repair-<lastGreenSha first 12 hex>`
 *   before any worktree exists, records the attempt, and starts the role on a
 *   won claim only. A branch with a desk on this machine is resumed without a
 *   second claim.
 * - `await-repair`: looks up the fix PR by its branch, records its number as
 *   `repairPr`, and starts its review.
 *
 * @param world - the reads and the actions.
 * @param warn - receives one line for each held pass and refusal.
 * @returns what the pass did.
 */
export const repairStartTick = async (
  world: RepairStartWorld,
  warn: (line: string) => void = () => undefined,
): Promise<RepairStartOutcome> => {
  const reading = await world.reading();
  const read = await world.repair.read();
  if (!read.ok || read.value === null) return 'none';
  const record = read.value;
  const now = world.now();
  const stamp = new Date(now).toISOString();

  let descends: Containment = 'yes';
  if (reading?.settled !== undefined && reading.settled.sha !== record.firstRedSha) {
    const asked = await world.refs.contains(record.firstRedSha, reading.settled.sha);
    descends = asked.ok ? asked.value : 'unknown';
  }

  let rerunSettled: 'pending' | 'green' | 'red' | 'none' = 'none';
  if (reading !== null && record.rerun === 'asked') {
    const asked = await world.slot(() => world.build.runsForSha(reading.branch, record.firstRedSha));
    rerunSettled = rerunSettledOf(record, asked.ok ? asked.value : null, world.checks, now);
  }

  const attempt = record.attempt?.branch;
  let pr: Awaited<ReturnType<Host['prState']>> | null = null;
  if (attempt !== undefined) pr = await world.slot(() => world.host.prState(attempt));
  if (pr !== null && !pr.ok) {
    warn(`plot-fleetd: repair-start held — the host did not answer for '${attempt}'`);
    return 'held';
  }
  const prOpen = pr?.ok === true && pr.value !== null && pr.value.state === 'OPEN' ? pr.value : null;
  const repairInFlight = attempt !== undefined && (prOpen !== null || world.roleAlive(attempt));

  const step = redMainStep(reading, record, {
    now,
    checksWaitMs: world.checksWaitMs,
    mainRepairBoundMs: world.mainRepairBoundMs,
    descendsFromRecordedRed: descends,
    pickerAnswer: 'unknown',
    rerunSettled,
    repairInFlight,
    lastGreenRerunSettled: 'none',
  });

  if (step === 'await-rerun') {
    if (record.rerun !== 'none' || reading === null) return 'awaiting-rerun';
    const asked = await world.slot(() => world.build.rerunFailed(reading.branch, record.firstRedSha));
    if (!asked.ok) {
      warn(`plot-fleetd: repair-start held — the re-run of ${record.firstRedSha} was not accepted`);
      return 'held';
    }
    await world.repair.write({ ...record, state: 'rerun', rerun: 'asked', at: stamp });
    return 'rerun-asked';
  }

  if (step === 'start-repair') return startRepair(world, record, stamp, warn);

  if (step === 'await-repair') {
    if (prOpen === null) return 'awaiting-repair';
    if (record.repairPr !== prOpen.number) await world.repair.write({ ...record, repairPr: prOpen.number, at: stamp });
    if (prOpen.headSha === undefined) {
      warn(`plot-fleetd: repair-start held — the host named no head for PR ${prOpen.number}`);
      return 'held';
    }
    return (await world.review(prOpen.number, prOpen.headSha)) === 'started' ? 'review-started' : 'review-refused';
  }

  return 'none';
};

/**
 * The `start-repair` step: claim, record the attempt, start the role.
 *
 * The attempt is recorded before the claim so a crash between the two leaves a
 * record naming the branch; a desk on this machine then proves the claim was
 * won here, and the next pass starts the role without claiming again.
 */
const startRepair = async (
  world: RepairStartWorld,
  record: RepairRecord,
  stamp: string,
  warn: (line: string) => void,
): Promise<RepairStartOutcome> => {
  const branch = record.attempt?.branch ?? mainRepairBranchOf(record.lastGreenSha);
  if (branch === null) {
    warn('plot-fleetd: repair-start held — the episode has no last green SHA to name a repair branch from');
    return 'held';
  }
  if (record.attempt === undefined) {
    await world.repair.write({ ...record, state: 'repairing', attempt: { branch }, at: stamp });
  }
  if (!(await world.hasDesk(branch))) {
    const base = await world.baseSha();
    if (base === null) {
      warn(`plot-fleetd: repair-start held — the default branch's tip could not be read to claim '${branch}'`);
      return 'held';
    }
    const claimed = await world.claim(branch, base);
    if (claimed === 'failed') {
      warn(`plot-fleetd: repair-start held — the claim of '${branch}' could not be pushed`);
      return 'claim-failed';
    }
    if (claimed === 'lost') return 'claim-lost';
  }
  return (await world.startRole(branch)) === 'started' ? 'role-started' : 'role-failed';
};
