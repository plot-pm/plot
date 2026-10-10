import type { RunningChannel } from '@plot-pm/domain/adapters';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { Finding } from '@plot-pm/domain/entities/finding';
import type { PrIndex } from '@plot-pm/domain/entities/pr-index';
import { diffFindings, indexFindings } from '@plot-pm/domain/rules/index-findings';

/** What the IndexMonitor reads and publishes through. */
export interface IndexMonitorWorld {
  /** The stored PR index; `null` where it is missing, unreadable or another version. */
  index(): Promise<PrIndex | null>;
  /** The default-branch reading; `null` where there is none. */
  defaultBranch(): Promise<DefaultBranchReading | null>;
  /** The branches some plan names under `## Slices`; `null` where the plans cannot be read. */
  sliceBranches(): Promise<ReadonlySet<string> | null>;
  /** The channel the findings go to. */
  channel: Pick<RunningChannel, 'findings' | 'publish' | 'seen'>;
  /** The current time, ISO-8601. */
  now(): string;
  /** Receives one line per publish and per clear. */
  log(line: string): void;
}

const line = (verb: 'publish' | 'clear', f: Finding): string =>
  `plot-fleetd: index-monitor ${verb} ${f.monitor} ${f.branch}: ${f.finding} (${f.evidence})\n`;

/**
 * Reads the stored index and the default-branch file once and brings the
 * channel in line with them.
 *
 * Publishes the findings that differ from what the channel holds and retracts
 * those that stopped holding, logging one line each. Calls `seen` after a run
 * that read the index and the slice branches, and not otherwise: a run that
 * threw, or that could not read them, did not measure. An unreadable index
 * publishes nothing and retracts nothing.
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
  if (index !== null && sliceBranches !== null) world.channel.seen('IndexMonitor');
};
