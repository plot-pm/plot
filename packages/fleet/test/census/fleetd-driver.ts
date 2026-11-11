import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { startSession, type Session, type SessionEnd } from './census-session.js';
import type { FleetdEntry } from './fleetd-entry-build.js';
import { SYSTEMD_UNIT_VARS, type Sandbox } from './sandbox.js';

export type FleetdRun = {
  session: Session;
  /** Runs one completed pass and resolves once the entry reports it done. */
  pass: () => Promise<number>;
  /** Runs one completed pass that spans the safety-net interval, and resolves once the entry reports it done. */
  safetyNet: () => Promise<number>;
  /** Stops fleetd and returns the session's end, census included when traced. */
  stop: () => Promise<SessionEnd>;
};

/** What starts fleetd: the test process itself, or the user's systemd manager. */
export type FleetdSupervisor = 'none' | 'systemd';

/**
 * The `systemd-run` arguments that start `command` as a transient service of
 * the user's systemd manager. `--pipe` connects the service's stdin, stdout and
 * stderr to `systemd-run`'s own, so the census session drives it as it drives a
 * plain child, and `systemd-run` exits with the service's exit code. The
 * service is a unit, not a scope, so systemd sets its `INVOCATION_ID`.
 * `--collect` removes the unit when it ends, a failed one included.
 *
 * @param unit - the transient unit's name, without `.service`.
 * @param cwd - the service's working directory.
 * @param env - the service's whole environment; a user service inherits none
 *   of the caller's. Every systemd unit variable in it is left out.
 * @param command - the executable.
 * @param args - its arguments.
 */
export const systemdRunArgs = (
  unit: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  command: string,
  args: readonly string[],
): string[] => [
  '--user',
  '--pipe',
  '--quiet',
  '--collect',
  `--unit=${unit}`,
  `--working-directory=${cwd}`,
  ...Object.entries(env)
    .filter((e): e is [string, string] => e[1] !== undefined && !(SYSTEMD_UNIT_VARS as readonly string[]).includes(e[0]))
    .map(([key, value]) => `--setenv=${key}=${value}`),
  '--',
  command,
  ...args,
];

/** Stops a transient user unit where it still runs; a unit already gone is no error. */
const stopUnit = (unit: string, env: NodeJS.ProcessEnv): void => {
  spawnSync('systemctl', ['--user', 'stop', `${unit}.service`], { env, stdio: 'ignore' });
};

/**
 * Starts fleetd's `run` through the census entry in `box`, on the clock the
 * entry drives, optionally under `strace -f`.
 *
 * @param entry - the built entry.
 * @param box - the sandbox fleetd supervises.
 * @param options - `trace` runs it under `strace`; `spawnLog` names the file
 *   the entry appends its direct children to; `clock: 'system'` runs fleetd
 *   on the system clock, with no passes; `supervisor: 'systemd'` starts it as
 *   a transient service of the user's systemd manager (`systemdRunArgs`), as
 *   `plot-fleetctl.sh` installs it on Linux, and never under `strace`.
 */
export const startFleetd = (
  entry: FleetdEntry,
  box: Sandbox,
  options: { trace: boolean; spawnLog?: string; clock?: 'manual' | 'system'; supervisor?: FleetdSupervisor },
): FleetdRun => {
  const env: NodeJS.ProcessEnv = {
    ...box.env,
    CENSUS_CLOCK: options.clock ?? 'manual',
    ...(options.spawnLog ? { CENSUS_SPAWN_LOG: options.spawnLog } : {}),
  };
  const args = [entry.launcher, '--interval', '60'];
  const supervised = options.supervisor === 'systemd';
  if (supervised && options.trace) throw new Error('process census: a fleetd under systemd runs untraced');
  const unit = `plot-census-fleetd-${process.pid}-${Date.now()}`;
  const session = startSession(
    supervised
      ? { command: 'systemd-run', args: systemdRunArgs(unit, box.repo, env, process.execPath, args), cwd: box.repo, env: box.env, trace: false }
      : { command: process.execPath, args, cwd: box.repo, env, trace: options.trace },
  );
  let passes = 0;
  const run = async (command: 'pass' | 'safety-net'): Promise<number> => {
    passes += 1;
    const n = passes;
    session.send(command);
    await session.waitFor(new RegExp(`^census: pass ${n} done$`), 180_000);
    return n;
  };
  return {
    session,
    pass: () => run('pass'),
    safetyNet: () => run('safety-net'),
    stop: async () => {
      session.send('stop');
      const end = await session.end(60_000);
      if (supervised) stopUnit(unit, box.env);
      if (end.code !== 0) {
        throw new Error(`process census: fleetd exited ${end.code ?? end.signal}\nstderr: ${end.stderr.slice(-4000)}`);
      }
      return end;
    },
  };
};

/** The file a sandbox's fleetd entry logs its direct children to. */
export const spawnLogOf = (box: Sandbox): string => join(box.root, 'fleetd-spawns.jsonl');
