import type { RunningChannel } from '@plot-pm/domain/adapters';
import { findingKey, type Finding, type MonitorName } from '@plot-pm/domain/entities/finding';
import type { Desk } from '@plot-pm/domain/ports/desk';
import type { Trees } from '@plot-pm/domain/ports/trees';

/** The monitors whose logs the relay carries; the IndexMonitor's slots are never its to touch. */
const DESK_MONITORS: ReadonlySet<MonitorName> = new Set(['WorkerMonitor', 'AgentMonitor', 'BuildMonitor']);

/** What the desk relay reads and publishes through. */
export interface DeskRelayWorld {
  /** The worktrees on this machine; a failed list publishes nothing and clears nothing. */
  trees: Pick<Trees, 'list'>;
  /** The findings a desk's monitor logs hold. */
  desk: Pick<Desk, 'readFindings'>;
  /** The channel the findings go to. Its `publish` and `seen` are not offered, because both move a monitor's `lastSeen`. */
  channel: Pick<RunningChannel, 'findings' | 'relay'>;
  /** The current time, ISO-8601. */
  now(): string;
  /** Receives one line per publish and per clear. */
  log(line: string): void;
}

const line = (verb: 'publish' | 'clear', f: Finding): string =>
  `plot-fleetd: desk-relay ${verb} ${f.monitor} ${f.branch}: ${f.finding} (${f.evidence})\n`;

/** Whether a held finding and a wanted one say the same thing; `since` and `measuredAt` do not count. */
const same = (a: Finding, b: Finding): boolean => a.finding === b.finding && a.evidence === b.evidence;

/**
 * Brings the channel's desk-monitor slots in line with the findings the desks'
 * monitor logs hold.
 *
 * A desk contributes a finding only where it names the desk's checked-out
 * branch; a detached head contributes nothing. Two desks holding a finding for
 * the same monitor and branch share a slot, and the one with the newest
 * `measuredAt` wins. A finding is published verbatim, with its own monitor,
 * `since` and `measuredAt`, when its slot holds none or differs in `finding` or
 * `evidence`. A held desk-monitor slot that no desk finding supports is
 * retracted with `clear`.
 *
 * An unreadable estate is not an empty one: a failed `trees.list()` publishes
 * and clears nothing, and a desk whose logs cannot be read keeps its held slots.
 * The relay measures nothing, so it publishes through `relay`, which leaves every
 * monitor's `lastSeen` unchanged.
 *
 * @param world - the reads, the channel, the clock and the log.
 * @returns nothing.
 */
export const runDeskRelay = async (world: DeskRelayWorld): Promise<void> => {
  const listed = await world.trees.list();
  if (!listed.ok) return;

  const wanted = new Map<string, Finding>();
  const unreadable = new Set<string>();
  for (const tree of listed.value) {
    if (tree.branch === '') continue;
    const read = await world.desk.readFindings(tree.path);
    if (!read.ok) {
      unreadable.add(tree.branch);
      continue;
    }
    for (const f of read.value) {
      if (f.branch !== tree.branch || !DESK_MONITORS.has(f.monitor)) continue;
      const key = findingKey(f);
      const rival = wanted.get(key);
      if (rival === undefined || Date.parse(f.measuredAt) > Date.parse(rival.measuredAt)) wanted.set(key, f);
    }
  }

  const held = new Map(
    world.channel
      .findings()
      .filter((f) => DESK_MONITORS.has(f.monitor) && f.finding !== 'clear')
      .map((f) => [findingKey(f), f]),
  );
  const now = world.now();
  for (const [key, current] of held) {
    if (wanted.has(key) || unreadable.has(current.branch)) continue;
    const retraction: Finding = {
      monitor: current.monitor,
      branch: current.branch,
      worktree: current.worktree,
      finding: 'clear',
      since: now,
      evidence: `${current.finding} no longer holds`,
      measuredAt: now,
    };
    world.channel.relay(retraction);
    world.log(line('clear', retraction));
  }
  for (const [key, f] of wanted) {
    const current = held.get(key);
    if (current !== undefined && same(current, f)) continue;
    world.channel.relay(f);
    world.log(line('publish', f));
  }
};
