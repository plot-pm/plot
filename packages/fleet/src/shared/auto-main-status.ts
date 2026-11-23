import { checkNamesOf, checksWaitMsOf, defaultBranchRed, type DefaultBranchReading } from '@plot-pm/domain';
import { MAIN_HOLD_STATUS_CONTEXT, mainHoldStatus, type MainHoldStatus } from '@plot-pm/domain/rules/main-hold-status';
import { repairRoleOf, type RepairMergeReading } from '@plot-pm/domain/rules/repair-pr';
import { readRepair } from '@plot-pm/domain/workflows/merge';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Host } from '@plot-pm/domain/ports/host';
import { buildShell, defaultBranchFile, hostShell, prIndexFile, repairRecordFile } from '@plot-pm/domain/adapters';
import { apiForReads } from '@plot-pm/domain/adapters/host/process-host-reads';
import { refsOf, stateHomeOfOpts, type ActOptions } from './action-log.js';
import { readConfig } from './config-reader.js';

/** The last `plot/main` status this daemon wrote for one PR. */
export interface MainStatusWritten {
  readonly head: string;
  readonly state: 'success' | 'failure';
  readonly description: string;
}

/** The last `plot/main` status written per PR number, for the daemon's life. */
export type MainStatusMemory = Map<number, MainStatusWritten>;

/** What one `plot/main` pass acts on. */
export interface MainStatusPassReading {
  /** The open rows of the PR index. */
  readonly rows: readonly PrIndexRow[];
  /** The default-branch reading, or null where there is none. */
  readonly defaultBranch: DefaultBranchReading | null;
  /** The repair exception's reading, or undefined where the record names no open row. */
  readonly repair: RepairMergeReading | undefined;
  /** The default branch name, `'unaskable'`, or absent. */
  readonly defaultName: string | 'unaskable' | undefined;
  /** The `Checks wait` bound, in milliseconds. */
  readonly checksWaitMs: number;
}

/** What the pass writes through; a test replaces each. */
export interface MainStatusWorld {
  readonly host: (opts: ActOptions) => Pick<Host, 'commitStatus'>;
  /** Tells a person what the pass could not do; `console.error` by default. */
  readonly notify: (message: string) => void;
}

/** What the pass did for one open row. */
export interface MainStatusResult {
  readonly pr: number;
  readonly head: string;
  readonly wanted: MainHoldStatus;
  /** `written` and `failed` made a host call; `unchanged` and `none` made none. */
  readonly outcome: 'written' | 'unchanged' | 'failed' | 'none';
}

/**
 * Reads what one `plot/main` pass acts on.
 *
 * Reads the open rows of the PR index, the default-branch reading, the default
 * branch's name and `Checks wait`. Reads the repair exception only where the
 * reading is red within `Checks wait` and the repair record names an open row;
 * that read asks the red commit's runs again, once per pass.
 *
 * @param opts - where the fleet acts.
 * @param now - epoch milliseconds.
 * @returns the reading, or `null` where the backend, the PR index or the state home cannot be read, or no row is open.
 */
export const readMainStatusPass = async (opts: ActOptions, now: number): Promise<MainStatusPassReading | null> => {
  const context = { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir };
  const backend = await (opts.hostAdapter ?? hostShell(context)).backend();
  if (!backend.ok) return null;
  const store = await prIndexFile({ cwd: opts.repoRoot }).read(backend.value);
  if (!store.ok || store.value === null) return null;
  const rows = store.value.rows.filter((row) => row.state === 'OPEN');
  if (rows.length === 0) return null;
  const home = stateHomeOfOpts(opts);
  if (home === null) return null;
  const read = await defaultBranchFile(home).read();
  const defaultBranch = read.ok ? read.value : null;
  const refs = refsOf(opts);
  const name = await refs.defaultBranch();
  const checksWaitMs = checksWaitMsOf(readConfig(opts, 'Checks wait', '3600'));
  let repair: RepairMergeReading | undefined;
  const settled = defaultBranch?.settled;
  if (defaultBranch !== null && settled !== undefined && defaultBranchRed(defaultBranch, now, checksWaitMs)) {
    const ports = {
      repair: repairRecordFile(home),
      build: await buildShell(context, apiForReads(context)),
      checks: checkNamesOf(readConfig(opts, 'Default branch checks', '')),
      refs,
    };
    const record = await ports.repair.read();
    const named = record.ok && record.value !== null
      ? rows.find((row) => repairRoleOf(record.value as NonNullable<typeof record.value>, row.number) !== null)
      : undefined;
    if (named !== undefined) repair = await readRepair(ports, defaultBranch.branch, settled, named.number);
  }
  return {
    rows,
    defaultBranch,
    repair,
    defaultName: name.ok ? name.value : 'unaskable',
    checksWaitMs,
  };
};

/**
 * One `plot/main` pass over the open rows.
 *
 * For each row with a head, asks {@link mainHoldStatus} for the wanted status
 * and writes it through `Host.commitStatus` only where it differs from the
 * memory's entry for that PR: another head, state or description. A row the
 * rule answers `none` for writes nothing. The memory is updated only after a
 * write answers `ok`; a failed write leaves it, so the next pass writes again,
 * and is told through `notify` once per PR, head and state. Entries for PRs no
 * longer open are dropped.
 *
 * @param reading - the pass's reading.
 * @param now - epoch milliseconds.
 * @param opts - the repository and scripts directory.
 * @param world - the ports the pass writes through.
 * @param memory - the statuses already written; the caller keeps it across passes.
 * @param logged - the failures already told; the caller keeps it across passes.
 * @returns one result per open row with a head.
 */
export const mainStatusTick = async (
  reading: MainStatusPassReading,
  now: number,
  opts: ActOptions,
  world: MainStatusWorld = defaultMainStatusWorld,
  memory: MainStatusMemory = new Map(),
  logged: Set<string> = new Set(),
): Promise<MainStatusResult[]> => {
  const open = new Set(reading.rows.map((row) => row.number));
  for (const pr of [...memory.keys()]) if (!open.has(pr)) memory.delete(pr);
  const results: MainStatusResult[] = [];
  for (const row of reading.rows) {
    const head = row.headSha ?? '';
    if (head === '') continue;
    const wanted = mainHoldStatus(
      reading.defaultBranch,
      reading.repair,
      { number: row.number, head: row.head, base: row.base ?? '' },
      now,
      reading.checksWaitMs,
      reading.defaultName,
    );
    if (wanted === 'none') {
      results.push({ pr: row.number, head, wanted, outcome: 'none' });
      continue;
    }
    const last = memory.get(row.number);
    if (last !== undefined && last.head === head && last.state === wanted.state && last.description === wanted.description) {
      results.push({ pr: row.number, head, wanted, outcome: 'unchanged' });
      continue;
    }
    const written = await world.host(opts).commitStatus({
      sha: head,
      state: wanted.state,
      context: MAIN_HOLD_STATUS_CONTEXT,
      description: wanted.description,
      targetUrl: row.url,
    });
    if (written.ok) {
      memory.set(row.number, { head, state: wanted.state, description: wanted.description });
      results.push({ pr: row.number, head, wanted, outcome: 'written' });
      continue;
    }
    const key = `${row.number}:${head}:${wanted.state}`;
    if (!logged.has(key)) {
      logged.add(key);
      world.notify(`plot-fleetd: PR #${row.number}: ${MAIN_HOLD_STATUS_CONTEXT} ${wanted.state} was not written (${written.why}); the next pass writes it again`);
    }
    results.push({ pr: row.number, head, wanted, outcome: 'failed' });
  }
  return results;
};

/**
 * Runs the `plot/main` pass on the daemon's loop.
 *
 * @param opts - where the fleet acts.
 * @param memory - the statuses already written, kept by the caller for the daemon's life.
 * @param logged - the failures already told, kept by the caller for the daemon's life.
 * @param now - epoch milliseconds.
 * @param world - the ports the pass writes through.
 * @param read - reads the pass's reading; {@link readMainStatusPass} by default.
 * @returns the pass's results, or `null` where nothing was read to act on.
 */
export const runAutoMainStatusPass = async (
  opts: ActOptions,
  memory: MainStatusMemory,
  logged: Set<string>,
  now: number = Date.now(),
  world: MainStatusWorld = defaultMainStatusWorld,
  read: (opts: ActOptions, now: number) => Promise<MainStatusPassReading | null> = readMainStatusPass,
): Promise<MainStatusResult[] | null> => {
  const reading = await read(opts, now);
  if (reading === null) return null;
  return mainStatusTick(reading, now, opts, world, memory, logged);
};

/** The ports built from the real adapters: the shell host writes as the `Review app`. */
const defaultMainStatusWorld: MainStatusWorld = {
  host: (opts) => hostShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  notify: (message) => console.error(message),
};
