import { findingKey, type Finding } from '../entities/finding.js';
import type { DefaultBranchReading } from '../entities/default-branch.js';
import type { PrIndex, PrIndexRow } from '../entities/pr-index.js';
import { defaultBranchRed } from './default-branch.js';

/** How long after the host merged a PR its `pr merged` finding holds. */
export const MERGED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** What {@link indexFindings} reads. */
export interface IndexReadings {
  /** The stored PR index, or `null` where it could not be read. */
  index: PrIndex | null;
  /** The default-branch reading, or `null` where there is none. */
  defaultBranch: DefaultBranchReading | null;
  /** The current time, ISO-8601. */
  now: string;
  /** The branches some plan names under `## Slices`. */
  sliceBranches: ReadonlySet<string>;
}

/** Which slots a reading can retract a finding from. */
export interface Retractable {
  /** Every PR slot: the index is whole, so a missing row means the PR is gone. */
  allPrs: boolean;
  /** PR slots whose row the index holds, whether or not the index is whole. */
  prBranches: ReadonlySet<string>;
  /** The default branch's slot: a reading was present. */
  defaultBranch: boolean;
}

/** The findings that hold now, and which slots the reading may retract. */
export interface IndexFindings {
  /** At most one finding per slot. */
  findings: readonly Finding[];
  /** Where an absent finding means the condition stopped holding. */
  retractable: Retractable;
}

/** What {@link diffFindings} decided. */
export interface FindingDiff {
  /** Findings to publish: new slots and slots whose finding or evidence changed. */
  publish: readonly Finding[];
  /** Retractions (`clear`) for slots that held a finding and no longer should. */
  clear: readonly Finding[];
}

const MONITOR = 'IndexMonitor';

/** The rows merged inside the window, newest first. */
const mergedInWindow = (rows: readonly PrIndexRow[], nowMs: number): PrIndexRow[] =>
  rows
    .filter((row) => {
      if (row.state !== 'MERGED' || row.mergedAt === undefined) return false;
      const at = Date.parse(row.mergedAt);
      return !Number.isNaN(at) && nowMs - at < MERGED_WINDOW_MS;
    })
    .sort((a, b) => Date.parse(b.mergedAt ?? '') - Date.parse(a.mergedAt ?? ''));

/** The commit the checks name, in words. */
const checksBinding = (row: PrIndexRow): string => {
  if (row.checksSha === undefined) {
    return row.headSha === undefined
      ? 'the checks are not bound to a commit'
      : `the checks are not bound to a commit; head ${row.headSha}`;
  }
  return row.checksSha === row.headSha
    ? `on ${row.checksSha}`
    : `for ${row.checksSha}, head ${row.headSha ?? 'unknown'}`;
};

const findingFor = (
  row: PrIndexRow,
  name: Finding['finding'],
  since: string,
  evidence: string,
  now: string,
): Finding => ({
  monitor: MONITOR,
  branch: row.head,
  worktree: '',
  finding: name,
  since,
  evidence,
  measuredAt: now,
});

/** The one finding a branch's rows support, by precedence, or `null`. */
const findingOfBranch = (
  rows: readonly PrIndexRow[],
  nowMs: number,
  now: string,
  fallbackSince: string,
): Finding | null => {
  const merged = mergedInWindow(rows, nowMs)[0];
  if (merged !== undefined) {
    return findingFor(
      merged,
      'pr merged',
      merged.mergedAt ?? fallbackSince,
      `pull request #${merged.number} merged`,
      now,
    );
  }
  const open = rows.find((row) => row.state === 'OPEN');
  if (open === undefined) return null;
  const since = open.headSince ?? fallbackSince;
  if (open.checks === 'failing') {
    const failing = open.failing_checks?.length ? `; failing: ${open.failing_checks.join(', ')}` : '';
    return findingFor(
      open,
      'checks failing',
      since,
      `pull request #${open.number}, ${checksBinding(open)}${failing}`,
      now,
    );
  }
  if (open.checks === 'green') {
    return findingFor(open, 'checks green', since, `pull request #${open.number}, ${checksBinding(open)}`, now);
  }
  return null;
};

/**
 * Derives the findings that hold now from the stored PR index and the
 * default-branch reading.
 *
 * A branch gets a finding when it is a slice branch and either has an open PR
 * or has a PR merged inside {@link MERGED_WINDOW_MS}. Per branch, `pr merged`
 * outranks `checks failing`, which outranks `checks green`; `pending`, `none`
 * and `unknown` checks hold no finding. The default branch gets `default branch
 * red` while {@link defaultBranchRed} holds. A finding's `since` is the row's
 * `headSince` (`mergedAt` for `pr merged`). Its evidence carries no timestamp,
 * so an unchanged row yields an unchanged finding.
 *
 * @param readings - the index, the default-branch reading, the clock and the slice branches.
 * @returns the findings, at most one per slot, and the slots a reading can retract.
 */
export const indexFindings = (readings: IndexReadings): IndexFindings => {
  const { index, defaultBranch, now, sliceBranches } = readings;
  const nowMs = Date.parse(now);
  const findings: Finding[] = [];
  const prBranches = new Set<string>();

  if (index !== null) {
    const byBranch = new Map<string, PrIndexRow[]>();
    for (const row of index.rows) {
      if (row.head === '' || !sliceBranches.has(row.head)) continue;
      byBranch.set(row.head, [...(byBranch.get(row.head) ?? []), row]);
    }
    for (const [branch, rows] of byBranch) {
      prBranches.add(branch);
      const found = findingOfBranch(rows, nowMs, now, index.at);
      if (found !== null) findings.push(found);
    }
  }

  if (defaultBranch !== null && defaultBranchRed(defaultBranch)) {
    const settled = defaultBranch.settled;
    const failing = defaultBranch.failingRuns.map((run) => run.workflow);
    findings.push({
      monitor: MONITOR,
      branch: defaultBranch.branch,
      worktree: '',
      finding: 'default branch red',
      since: settled?.sha === defaultBranch.headSha ? defaultBranch.headSince : defaultBranch.at,
      evidence: `${defaultBranch.branch} is red on ${settled?.sha ?? 'unknown'}${
        failing.length > 0 ? `; failing: ${failing.join(', ')}` : ''
      }`,
      measuredAt: now,
    });
  }

  return {
    findings,
    retractable: {
      allPrs: index !== null && index.complete,
      prBranches,
      defaultBranch: defaultBranch !== null,
    },
  };
};

/**
 * Compares what the channel holds with what should hold.
 *
 * Only the IndexMonitor's own slots are compared, on `finding` and `evidence`;
 * `since` and `measuredAt` do not count. A wanted finding whose slot holds none,
 * or a different one, is published. A held slot with no wanted finding is
 * retracted if the reading may retract it. A held `clear` counts as no
 * finding. Every other slot is left alone, which is what makes an unreadable
 * index retract nothing.
 *
 * @param held - the findings the channel holds.
 * @param wanted - {@link indexFindings}' answer.
 * @param now - the current time, ISO-8601, for the retractions.
 * @returns the publishes and the retractions.
 */
export const diffFindings = (
  held: readonly Finding[],
  wanted: IndexFindings,
  now: string,
): FindingDiff => {
  const mine = new Map(
    held.filter((f) => f.monitor === MONITOR && f.finding !== 'clear').map((f) => [findingKey(f), f]),
  );
  const publish = wanted.findings.filter((finding) => {
    const current = mine.get(findingKey(finding));
    return current === undefined || current.finding !== finding.finding || current.evidence !== finding.evidence;
  });
  const wantedKeys = new Set(wanted.findings.map(findingKey));
  const { retractable } = wanted;
  const clear: Finding[] = [];
  for (const [key, current] of mine) {
    if (wantedKeys.has(key)) continue;
    const may =
      current.finding === 'default branch red'
        ? retractable.defaultBranch
        : retractable.allPrs || retractable.prBranches.has(current.branch);
    if (!may) continue;
    clear.push({
      monitor: MONITOR,
      branch: current.branch,
      worktree: '',
      finding: 'clear',
      since: now,
      evidence: `${current.finding} no longer holds`,
      measuredAt: now,
    });
  }
  return { publish, clear };
};
