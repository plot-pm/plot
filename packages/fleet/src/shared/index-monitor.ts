import type { RunningChannel } from '@plot-pm/domain/adapters';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { Finding } from '@plot-pm/domain/entities/finding';
import type { PrIndex } from '@plot-pm/domain/entities/pr-index';
import type { PlanStore } from '@plot-pm/domain/ports/plan-store';
import { diffFindings, indexFindings } from '@plot-pm/domain/rules/index-findings';

/** What the IndexMonitor reads and publishes through. */
export interface IndexMonitorWorld {
  /** The stored PR index; `null` where it is missing, unreadable or another version. */
  index(): Promise<PrIndex | null>;
  /** The default-branch reading; `null` where there is none. */
  defaultBranch(): Promise<DefaultBranchReading | null>;
  /** The branches some plan names under `## Slices`, empty where no plan names one; `null` where the plans cannot be read. */
  sliceBranches(): Promise<ReadonlySet<string> | null>;
  /** The channel the findings go to. */
  channel: Pick<RunningChannel, 'findings' | 'publish' | 'seen'>;
  /** The current time, ISO-8601. */
  now(): string;
  /** Receives one line per publish and per clear. */
  log(line: string): void;
}

/**
 * Reads the branches every plan names under `## Slices`.
 *
 * @param plans - the plan store.
 * @returns the branches, an empty set where no plan names one, or `null` where
 *   the plans cannot be listed or read.
 */
export const sliceBranchesOf = async (
  plans: Pick<PlanStore, 'listPlans' | 'readPlans'>,
): Promise<ReadonlySet<string> | null> => {
  const files = await plans.listPlans();
  if (!files.ok) return null;
  const records = await plans.readPlans(files.value);
  return records.ok ? new Set(records.value.flatMap((plan) => plan.branches)) : null;
};

const line = (verb: 'publish' | 'clear', f: Finding): string =>
  `plot-fleetd: index-monitor ${verb} ${f.monitor} ${f.branch}: ${f.finding} (${f.evidence})\n`;

/**
 * Reads the stored index and the default-branch file once and brings the
 * channel in line with them.
 *
 * Publishes the findings that differ from what the channel holds and retracts
 * those that stopped holding, logging one line each. Calls `seen` after a run
 * that read the index, whatever the slice branches hold, and not otherwise: a
 * run that threw, or that could not read the index, did not measure. `seen` is
 * the monitor's only heartbeat, because `publish` leaves `lastSeen` unchanged.
 * An unreadable index, or a plan store that cannot be read, publishes and
 * retracts no PR finding.
 *
 * @param world - the reads, the channel, the clock and the log.
 * @returns nothing; a rejected read propagates before `seen` is called.
 */
export const runIndexMonitor = async (world: IndexMonitorWorld): Promise<void> => {
  const [index, defaultBranch, sliceBranches] = await Promise.all([
    world.index(),
    world.defaultBranch(),
    world.sliceBranches(),
  ]);
  const now = world.now();
  const wanted = indexFindings({
    index: sliceBranches === null ? null : index,
    defaultBranch,
    now,
    sliceBranches: sliceBranches ?? new Set(),
  });
  const { publish, clear } = diffFindings(world.channel.findings(), wanted, now);
  for (const f of clear) {
    world.channel.publish(f);
    world.log(line('clear', f));
  }
  for (const f of publish) {
    world.channel.publish(f);
    world.log(line('publish', f));
  }
  if (index !== null) world.channel.seen('IndexMonitor');
};
