import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkNamesOf, checksWaitMsOf, defaultBranchRed, type DefaultBranchReading } from '@plot-pm/domain';
import type { SettledReading } from '@plot-pm/domain/entities/default-branch';
import { MAIN_HOLD_STATUS_CONTEXT, mainHoldStatus, type MainHoldStatus } from '@plot-pm/domain/rules/main-hold-status';
import { repairRoleOf, type RepairMergeReading } from '@plot-pm/domain/rules/repair-pr';
import { readRepair } from '@plot-pm/domain/workflows/merge';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Host } from '@plot-pm/domain/ports/host';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
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

/** The last `plot/main` status written per PR number, kept in {@link mainStatusPath}. */
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

/** How long a failed write of one status on one head waits before the pass writes it again, in milliseconds. */
export const MAIN_STATUS_RETRY_MS = 3_600_000;

/** The last failed `plot/main` write per PR number: what it wrote and when. */
export type MainStatusFailures = Map<number, { readonly key: string; readonly at: number }>;

/** What the pass did for one open row. */
export interface MainStatusResult {
  readonly pr: number;
  readonly head: string;
  readonly wanted: MainHoldStatus;
  /**
   * `written` and `failed` made a host call; `unchanged`, `held`, `shared` and `none` made none.
   * `shared` takes the answer of an earlier write in the same pass of the same status on the same head.
   */
  readonly outcome: 'written' | 'unchanged' | 'failed' | 'held' | 'shared' | 'none';
}

/**
 * What a `plot/main` pass keeps across ticks, so a tick with no status due starts no process.
 *
 * The PR index adapter caches the common git dir. The backend word, the
 * default branch's name and `Checks wait` are read once, on the first tick
 * that needs them, and kept for the daemon's life. The repair exception's
 * reading is kept with the inputs it was read from and read again only when
 * one of them changes; a reading with a failed ask is not kept.
 */
export interface MainStatusCache {
  readonly prIndex: PrIndexStore;
  backend?: string;
  defaultName?: string;
  checksWaitMs?: number;
  repair?: { readonly key: string; readonly value: RepairMergeReading };
}

/**
 * A new {@link MainStatusCache}.
 *
 * @param opts - where the fleet acts.
 * @returns a cache with nothing read yet.
 */
export const mainStatusCache = (opts: ActOptions): MainStatusCache => ({ prIndex: prIndexFile({ cwd: opts.repoRoot }) });

/**
 * Whether a repair reading holds no failed ask, so a later tick may reuse it.
 *
 * A reading whose record or episode is `unaskable`, or whose red-commit runs
 * are `unaskable` on an open episode, is asked again on the next tick: kept,
 * it would hold the named PR at `failure` until the default branch or the
 * record changes. The runs of a closed episode are never asked, so their
 * `unaskable` is no failed ask.
 *
 * @param reading - the repair exception's reading.
 * @returns false where an ask the reading made failed.
 */
export const repairReadingAnswered = (reading: RepairMergeReading): boolean =>
  reading.record !== 'unaskable' && reading.episode !== 'unaskable' && !(reading.episode === 'open' && reading.redRuns === 'unaskable');

/** Reads the repair exception for one PR on a red reading; {@link readMainStatusPass} builds the ports by default. */
export type MainStatusRepairAsk = (opts: ActOptions, branch: string, settled: SettledReading, pr: number) => Promise<RepairMergeReading>;

const askRepair: MainStatusRepairAsk = async (opts, branch, settled, pr) => {
  const home = stateHomeOfOpts(opts);
  const context = { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir };
  const ports = {
    ...(home === null ? {} : { repair: repairRecordFile(home) }),
    build: await buildShell(context, apiForReads(context)),
    checks: checkNamesOf(readConfig(opts, 'Default branch checks', '')),
    refs: refsOf(opts),
  };
  return readRepair(ports, branch, settled, pr);
};

/** `Checks wait`'s default, in milliseconds, for a tick that never reads it. */
const CHECKS_WAIT_DEFAULT_MS = 3_600_000;

/**
 * Reads what one `plot/main` pass acts on.
 *
 * Reads the open rows of the PR index, `.plot/state/default-branch.json` and,
 * where the reading is red within `Checks wait`, `.plot/state/repair-record.json`;
 * these are file reads. The default branch's name is the reading's `branch`,
 * and is asked of git only where no reading names one. `Checks wait` is read
 * only where the reading's settled commit is red. The repair exception asks the
 * red commit's runs again only where the record names an open row and the
 * reading, the record or that row's head changed since the last ask.
 *
 * @param opts - where the fleet acts.
 * @param now - epoch milliseconds.
 * @param cache - what earlier ticks read; {@link mainStatusCache}.
 * @param ask - reads the repair exception; the shell's build and git by default.
 * @returns the reading, or `null` where the backend, the PR index or the state home cannot be read, or no row is open.
 */
export const readMainStatusPass = async (
  opts: ActOptions,
  now: number,
  cache: MainStatusCache = mainStatusCache(opts),
  ask: MainStatusRepairAsk = askRepair,
): Promise<MainStatusPassReading | null> => {
  const context = { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir };
  if (cache.backend === undefined) {
    const backend = await (opts.hostAdapter ?? hostShell(context)).backend();
    if (!backend.ok) return null;
    cache.backend = backend.value;
  }
  const store = await cache.prIndex.read(cache.backend);
  if (!store.ok || store.value === null) return null;
  const rows = store.value.rows.filter((row) => row.state === 'OPEN');
  if (rows.length === 0) return null;
  const home = stateHomeOfOpts(opts);
  if (home === null) return null;
  const read = await defaultBranchFile(home).read();
  const defaultBranch = read.ok ? read.value : null;
  const refs = refsOf(opts);
  let defaultName: string | 'unaskable' = defaultBranch?.branch || cache.defaultName || '';
  if (defaultName === '') {
    const name = await refs.defaultBranch();
    if (name.ok) cache.defaultName = name.value;
    defaultName = name.ok ? name.value : 'unaskable';
  }
  const settled = defaultBranch?.settled;
  if (settled?.state === 'red' && cache.checksWaitMs === undefined) {
    cache.checksWaitMs = checksWaitMsOf(readConfig(opts, 'Checks wait', '3600'));
  }
  const checksWaitMs = cache.checksWaitMs ?? CHECKS_WAIT_DEFAULT_MS;
  let repair: RepairMergeReading | undefined;
  if (defaultBranch !== null && settled !== undefined && defaultBranchRed(defaultBranch, now, checksWaitMs)) {
    const records = repairRecordFile(home);
    const record = await records.read();
    const held = record.ok ? record.value : null;
    const named = held !== null ? rows.find((row) => repairRoleOf(held, row.number) !== null) : undefined;
    if (named !== undefined) {
      const key = JSON.stringify([settled, defaultBranch.head, defaultBranch.headSha, held, named.number, named.head]);
      if (cache.repair?.key !== key) {
        const value = await ask(opts, defaultBranch.branch, settled, named.number);
        if (repairReadingAnswered(value)) cache.repair = { key, value };
        else delete cache.repair;
        repair = value;
      } else {
        repair = cache.repair.value;
      }
    }
  }
  return { rows, defaultBranch, repair, defaultName, checksWaitMs };
};

/**
 * One `plot/main` pass over the open rows.
 *
 * For each row with a head, asks {@link mainHoldStatus} for the wanted status
 * and writes it through `Host.commitStatus` only where it differs from the
 * memory's entry for that PR: another head, state or description. A row the
 * rule answers `none` for writes nothing. The memory is updated only after a
 * write answers `ok`. A failed write leaves the memory, is told through
 * `notify` once per PR, head and state, and is held: the same status on the
 * same head is written again only {@link MAIN_STATUS_RETRY_MS} after the
 * failure, while another head or status is written on the next pass. A commit
 * status belongs to the commit, so rows that share a head and a wanted status
 * cost one write per pass: later rows take its answer as `shared`. Entries
 * for PRs no longer open are dropped, from the memory, the failures and `logged`.
 *
 * @param reading - the pass's reading.
 * @param now - epoch milliseconds.
 * @param opts - the repository and scripts directory.
 * @param world - the ports the pass writes through.
 * @param memory - the statuses already written; the caller keeps it across passes.
 * @param logged - the failures already told; the caller keeps it across passes.
 * @param failures - the last failed write per PR; the caller keeps it across passes.
 * @returns one result per open row with a head.
 */
export const mainStatusTick = async (
  reading: MainStatusPassReading,
  now: number,
  opts: ActOptions,
  world: MainStatusWorld = defaultMainStatusWorld,
  memory: MainStatusMemory = new Map(),
  logged: Set<string> = new Set(),
  failures: MainStatusFailures = new Map(),
): Promise<MainStatusResult[]> => {
  const open = new Set(reading.rows.map((row) => row.number));
  for (const pr of [...memory.keys()]) if (!open.has(pr)) memory.delete(pr);
  for (const pr of [...failures.keys()]) if (!open.has(pr)) failures.delete(pr);
  for (const told of [...logged]) if (!open.has(Number(told.split(':')[0]))) logged.delete(told);
  const results: MainStatusResult[] = [];
  const asked = new Map<string, boolean>();
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
    const key = `${head}\n${wanted.state}\n${wanted.description}`;
    const failed = failures.get(row.number);
    if (failed !== undefined && failed.key === key && now - failed.at < MAIN_STATUS_RETRY_MS) {
      results.push({ pr: row.number, head, wanted, outcome: 'held' });
      continue;
    }
    const answered = asked.get(key);
    if (answered !== undefined) {
      if (answered) {
        failures.delete(row.number);
        memory.set(row.number, { head, state: wanted.state, description: wanted.description });
      } else {
        failures.set(row.number, { key, at: now });
      }
      results.push({ pr: row.number, head, wanted, outcome: 'shared' });
      continue;
    }
    const written = await world.host(opts).commitStatus({
      sha: head,
      state: wanted.state,
      context: MAIN_HOLD_STATUS_CONTEXT,
      description: wanted.description,
      targetUrl: row.url,
    });
    asked.set(key, written.ok);
    if (written.ok) {
      failures.delete(row.number);
      memory.set(row.number, { head, state: wanted.state, description: wanted.description });
      results.push({ pr: row.number, head, wanted, outcome: 'written' });
      continue;
    }
    failures.set(row.number, { key, at: now });
    const told = `${row.number}:${head}:${wanted.state}`;
    if (!logged.has(told)) {
      logged.add(told);
      world.notify(`plot-fleetd: PR #${row.number}: ${MAIN_HOLD_STATUS_CONTEXT} ${wanted.state} was not written (${written.why}); a pass writes it again in an hour, or on a new head or status`);
    }
    results.push({ pr: row.number, head, wanted, outcome: 'failed' });
  }
  return results;
};

/** Where the last `plot/main` status written per PR is kept, under a state home. */
export const mainStatusPath = (home: string): string => join(home, '.plot', 'state', 'main-status.json');

/** The file's format version; a file of another version reads as empty. */
export const MAIN_STATUS_FILE_VERSION = 1;

/**
 * Reads the last `plot/main` status written per PR.
 *
 * @param path - the file, {@link mainStatusPath}.
 * @returns the entries; empty where the file is missing, unparseable or of another version, and without any entry that is malformed.
 */
export const readMainStatusMemory = (path: string): MainStatusMemory => {
  const memory: MainStatusMemory = new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return memory;
  }
  const file = parsed as { v?: unknown; prs?: unknown };
  if (file === null || typeof file !== 'object' || file.v !== MAIN_STATUS_FILE_VERSION) return memory;
  if (file.prs === null || typeof file.prs !== 'object') return memory;
  for (const [pr, entry] of Object.entries(file.prs as Record<string, unknown>)) {
    const e = entry as Partial<MainStatusWritten> | null;
    const number = Number(pr);
    if (!Number.isInteger(number) || e === null || typeof e !== 'object') continue;
    if (typeof e.head !== 'string' || typeof e.description !== 'string') continue;
    if (e.state !== 'success' && e.state !== 'failure') continue;
    memory.set(number, { head: e.head, state: e.state, description: e.description });
  }
  return memory;
};

/**
 * Writes the last `plot/main` status written per PR, whole or not at all.
 *
 * @param path - the file, {@link mainStatusPath}.
 * @param memory - the entries.
 * @throws where the directory cannot be created or the file cannot be written.
 */
export const writeMainStatusMemory = (path: string, memory: MainStatusMemory): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${encodeMemory(memory)}\n`);
  renameSync(temp, path);
};

const encodeMemory = (memory: MainStatusMemory): string =>
  JSON.stringify({ v: MAIN_STATUS_FILE_VERSION, prs: Object.fromEntries([...memory].sort(([a], [b]) => a - b)) });

/** What the `plot/main` pass keeps across the daemon's passes. */
export interface MainStatusState {
  /** The statuses already written; read from {@link mainStatusPath} on the first pass. */
  memory?: MainStatusMemory;
  /** The failures already told. */
  readonly logged: Set<string>;
  /** The last failed write per PR, for the daemon's life. */
  readonly failures: MainStatusFailures;
  /** What earlier ticks read. */
  readonly cache: MainStatusCache;
}

/**
 * A new {@link MainStatusState}.
 *
 * @param opts - where the fleet acts.
 * @returns a state with nothing read yet.
 */
export const mainStatusState = (opts: ActOptions): MainStatusState => ({ logged: new Set(), failures: new Map(), cache: mainStatusCache(opts) });

/**
 * Runs the `plot/main` pass on the daemon's loop.
 *
 * Reads the memory from {@link mainStatusPath} on the first pass, and writes
 * the file again only after a pass changed it.
 *
 * @param opts - where the fleet acts.
 * @param state - what the pass keeps across passes; {@link mainStatusState}.
 * @param now - epoch milliseconds.
 * @param world - the ports the pass writes through.
 * @param read - reads the pass's reading; {@link readMainStatusPass} by default.
 * @returns the pass's results, or `null` where nothing was read to act on.
 */
export const runAutoMainStatusPass = async (
  opts: ActOptions,
  state: MainStatusState,
  now: number = Date.now(),
  world: MainStatusWorld = defaultMainStatusWorld,
  read: (opts: ActOptions, now: number, cache: MainStatusCache) => Promise<MainStatusPassReading | null> = readMainStatusPass,
): Promise<MainStatusResult[] | null> => {
  const reading = await read(opts, now, state.cache);
  if (reading === null) return null;
  const home = stateHomeOfOpts(opts);
  const path = home === null ? null : mainStatusPath(home);
  const memory = (state.memory ??= path === null ? new Map() : readMainStatusMemory(path));
  const before = encodeMemory(memory);
  const results = await mainStatusTick(reading, now, opts, world, memory, state.logged, state.failures);
  if (path !== null && encodeMemory(memory) !== before) writeMainStatusMemory(path, memory);
  return results;
};

/** The ports built from the real adapters: the shell host writes as the `Review app`. */
const defaultMainStatusWorld: MainStatusWorld = {
  host: (opts) => hostShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  notify: (message) => console.error(message),
};
