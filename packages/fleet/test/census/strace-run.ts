import { spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { removeTree } from '../rm-tree.mjs';
import { parseStraceExecs, type StraceCensus } from './strace-execs.js';

/** The syscalls the census traces: every new image, and every fork that could precede one. */
export const STRACE_ARGS = ['-f', '-qq', '-s', '4096', '-e', 'trace=execve,execveat,clone,clone3,fork,vfork'];

/**
 * Returns the first executable `strace` on `pathEnv` (a `PATH` value), or
 * `null` when none is there. Starts no process.
 */
export const findStrace = (pathEnv: string): string | null => {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, 'strace');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here, or not executable
    }
  }
  return null;
};

export type CensusGate =
  | { kind: 'run'; strace: string }
  | { kind: 'skip'; line: string }
  | { kind: 'fail'; message: string };

const MISSING = 'strace not found on PATH';

/**
 * Decides whether the census runs. `run` where `strace` is present; `skip`
 * with one line on macOS, which has no `strace`; `fail` with a message that
 * names `strace` on every other platform.
 */
export const censusGate = ({ stracePath, platform }: { stracePath: string | null; platform: string }): CensusGate => {
  if (stracePath !== null) return { kind: 'run', strace: stracePath };
  if (platform === 'darwin') {
    return { kind: 'skip', line: `process census skipped: ${MISSING} (macOS has no strace; the census runs on Linux CI)` };
  }
  return {
    kind: 'fail',
    message: `process census: ${MISSING} (install it, for example \`sudo apt-get install -y strace\`)`,
  };
};

/** Returns the `strace` path on `pathEnv`, or throws the `fail` message of `censusGate`. */
export const requireStrace = (pathEnv: string = process.env['PATH'] ?? ''): string => {
  const gate = censusGate({ stracePath: findStrace(pathEnv), platform: 'linux' });
  if (gate.kind !== 'run') throw new Error(gate.kind === 'fail' ? gate.message : gate.line);
  return gate.strace;
};

export type TracedRun = StraceCensus & { code: number | null; signal: NodeJS.Signals | null };

export type TraceOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Kills `strace` and its tree with SIGKILL and rejects after this many ms. Default 60 000. */
  timeoutMs?: number;
};

/**
 * Runs `command args` under `strace -f` and returns the census of every image
 * its tree started, the command's own `execve` included, with the exit code
 * `strace` passed through. Throws by name when `strace` is absent from `PATH`.
 * The log lives in a `mkdtempSync` directory that is removed by that exact
 * name before the promise settles.
 */
export const traceExecs = async (
  command: string,
  args: readonly string[],
  { cwd, env = process.env, timeoutMs = 60_000 }: TraceOptions = {},
): Promise<TracedRun> => {
  const strace = requireStrace(env['PATH'] ?? '');
  const dir = mkdtempSync(join(tmpdir(), 'plot-census-'));
  try {
    const log = join(dir, 'strace.log');
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const child = spawn(strace, [...STRACE_ARGS, '-o', log, '--', command, ...args], {
        cwd,
        env,
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: true,
      });
      const timer = setTimeout(() => {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        reject(new Error(`process census: ${command} did not exit within ${timeoutMs} ms under strace`));
      }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    return { ...exit, ...parseStraceExecs(readFileSync(log, 'utf8')) };
  } finally {
    removeTree(dir);
  }
};
