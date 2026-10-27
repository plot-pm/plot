import { realpathSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startPulse, type RunningPulse } from '@plot-pm/domain';
import { heartbeatIsFresh } from '@plot-pm/domain/rules/reader-election';
import { clockSystem, hostShell, prIndexFile, readerLockFile, scriptsShell } from '@plot-pm/domain/adapters';
import { fleetPrs, type PrLock } from '../../shared/fleet-clock.js';
import { freshPrState, type PrState, type PrWorld } from '../../shared/pr-refresh.js';
import { PR_REFRESH_MS } from '../../shared/fleet-scan.js';
import { logDir, processLog } from '../../shared/process-log.js';

/**
 * The machine's PR reader, with no scan, no supervision tick and no issue
 * read — the board starts this when `electReader` says `elect` and no live
 * `fleetd` heartbeat already reads PRs for this lock.
 *
 * ```
 * node plot-pr-reader.mjs --lock-dir <abs index dir> --connector <name>
 * ```
 *
 * The board computes the lock directory and hands it over verbatim; this
 * process resolves no key of its own — it seeds `state.backend` from
 * `--connector` so `resolveBackend` short-circuits on its own cached-value
 * check rather than asking the host.
 *
 * Exits once no live heartbeat remains under the lock, or once a live
 * `fleetd` heartbeat appears — the exact signal that fleetd itself has
 * resumed reading PRs for this repository.
 */

/** The usage line. */
const USAGE = 'usage: plot-pr-reader.mjs --lock-dir <dir> --connector <name>';

/** Parsed argv, or null where it does not match the usage. */
export interface PrReaderArgs {
  /** The resolved `.plot/state/index/` directory the board computed. */
  lockDir: string;
  /** The connector name the board resolved; passed through, never re-asked. */
  connector: string;
}

/**
 * Parses `--lock-dir <dir> --connector <name>`, in either order.
 *
 * @param argv - the process arguments after the script path.
 * @returns the parsed pair, or `null` where a flag is missing or repeated.
 */
export const parseArgs = (argv: readonly string[]): PrReaderArgs | null => {
  let lockDir: string | undefined;
  let connector: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--lock-dir' && lockDir === undefined) {
      lockDir = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--connector' && connector === undefined) {
      connector = argv[i + 1];
      i += 1;
    } else {
      return null;
    }
  }
  if (lockDir === undefined || connector === undefined) return null;
  return { lockDir, connector };
};

/** How often the reader checks whether it should still be running, in ms — one PR tick. */
const EXIT_CHECK_MS = PR_REFRESH_MS;

/**
 * Reads whether each pid in `pids` is alive, and its actual start time, with
 * one batched `ps` call rather than one spawn per pid.
 *
 * @param pids - the process ids to ask about; empty returns no entries.
 * @returns a map from pid to `{ alive, startedAt }`; a pid absent from `ps`'s
 *   output is alive: false, startedAt: null.
 */
export const psLiveness = (pids: readonly number[]): Promise<Map<number, { alive: boolean; startedAt: number | null }>> =>
  new Promise((resolve) => {
    const result = new Map<number, { alive: boolean; startedAt: number | null }>();
    for (const pid of pids) result.set(pid, { alive: false, startedAt: null });
    if (pids.length === 0) {
      resolve(result);
      return;
    }
    const args = ['-o', 'pid=,lstart=', ...pids.flatMap((pid) => ['-p', String(pid)])];
    execFile('ps', args, (error, stdout) => {
      if (!error) {
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim();
          if (trimmed === '') continue;
          const m = /^(\d+)\s+(.+)$/.exec(trimmed);
          if (!m) continue;
          const pid = Number(m[1]);
          const startedAt = Date.parse(m[2]);
          if (result.has(pid)) result.set(pid, { alive: true, startedAt: Number.isNaN(startedAt) ? null : startedAt });
        }
      }
      resolve(result);
    });
  });

/**
 * Whether anyone still follows this lock — a live `board.<pid>` heartbeat
 * that is both fresh and names a live process, or a live `fleetd` heartbeat.
 *
 * `fleetd` NEVER NEEDS THE PID CHECK: unlike a board's heartbeat, whose name
 * carries the pid this function must verify against `ps`, `fleetd`'s own name
 * carries none — its liveness is the same age-only reading `fleetPrs` itself
 * already treats as sufficient for a follower.
 *
 * @param heartbeats - every heartbeat currently published under the lock.
 * @param now - epoch milliseconds.
 * @param liveness - reads pid liveness in one batch; {@link psLiveness} in production.
 * @returns `'fleetd'` where a live fleetd heartbeat exists, `'followers'`
 *   where at least one other live heartbeat exists, or `'none'`.
 */
export const stillFollowed = async (
  heartbeats: readonly { name: string; at: number }[],
  now: number,
  liveness: (pids: readonly number[]) => Promise<Map<number, { alive: boolean; startedAt: number | null }>>,
): Promise<'fleetd' | 'followers' | 'none'> => {
  const fresh = heartbeats.filter((h) => heartbeatIsFresh(h.at, now));
  if (fresh.some((h) => h.name === 'fleetd')) return 'fleetd';
  const boardPids = fresh
    .map((h) => /^board\.(\d+)$/.exec(h.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  if (boardPids.length === 0) return 'none';
  const read = await liveness(boardPids);
  return [...read.values()].some((r) => r.alive) ? 'followers' : 'none';
};

/**
 * Runs the reader: one `fleetPrs` pass per `PR_REFRESH_MS` tick, exiting once
 * {@link stillFollowed} reads `none`.
 *
 * @param args - the parsed `--lock-dir`/`--connector` pair.
 * @param repoRoot - the repository root; the reader's own `cwd`.
 * @param warn - receives a one-line reason for a pass's own failures.
 * @param liveness - reads pid liveness in one batch; a test replaces it.
 * @returns the process exit code: always 0 — the reader leaves because no one
 *   follows it, never because it failed.
 */
export const run = async (
  args: PrReaderArgs,
  repoRoot: string,
  warn: (line: string) => void = () => undefined,
  liveness: (pids: readonly number[]) => Promise<Map<number, { alive: boolean; startedAt: number | null }>> = psLiveness,
): Promise<number> => {
  const context = { repoRoot, scriptDir: path.join(repoRoot, 'skills/plot/scripts') };
  const lock = readerLockFile({ home: args.lockDir });
  const prLock: PrLock = { lock };
  const state: PrState = freshPrState();
  state.backend = args.connector;
  const world: PrWorld = {
    scripts: scriptsShell(context),
    host: hostShell(context),
    store: prIndexFile({ cwd: repoRoot }),
  };
  const readPrs = fleetPrs(world, state, prLock, warn);

  let stop = false;
  let pulse: RunningPulse | null = null;
  const checkStillFollowed = async (): Promise<void> => {
    const now = Date.now();
    const held = await lock.heartbeats(args.connector);
    const read = held.ok ? held.value : [];
    if ((await stillFollowed(read, now, liveness)) === 'none') stop = true;
  };

  await readPrs();
  await checkStillFollowed();
  if (!stop) {
    pulse = startPulse(clockSystem(), PR_REFRESH_MS);
    pulse.add({
      name: 'pr-reader',
      everyNthBeat: 1,
      tick: async () => {
        await readPrs();
        await checkStillFollowed();
        if (stop) pulse?.stop();
      },
    });
  }

  while (!stop) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(EXIT_CHECK_MS, 5_000)));
  }
  pulse?.stop();
  return 0;
};

// Only when RUN, never when imported — see `continue-command.ts` for why.
declare const PLOT_EMBEDDED: boolean | undefined;
if (
  typeof PLOT_EMBEDDED === 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const repoRoot = process.cwd();
  const log = processLog(path.join(logDir(repoRoot), 'pr-reader.log'));
  const warn = (line: string): void => void log.write(line);
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === null) {
    process.stderr.write(`plot-pr-reader: ${USAGE}\n`);
    process.exit(2);
  } else {
    process.exitCode = await run(parsed, repoRoot, warn);
  }
}
