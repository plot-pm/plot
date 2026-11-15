// The detached start of one agent launch: `plot-worker-start.mjs`.
//
// `start_worker` calls it with the `Worker command` as its one argument, in the
// desk, with the environment the wrapper reads already exported. It compares
// the running Node major with the major Plot's `.nvmrc` pins, starts
// `plot-worker-wrapper.mjs` through the `Detached` port, and exits. The wrapper
// leads its own session and process group, and writes its output to
// `PLOT_WORKER_LOG`: truncated for a dispatch, appended to where
// `PLOT_WORKER_LOG_APPEND=1`, as a continue or a restart sets it.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { detachedNode } from '@plot-pm/domain/adapters/detached/detached-node';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import type { Detached } from '@plot-pm/domain/ports/detached';
import { nodePin } from '@plot-pm/domain/rules/node-pin';

/** What one start reads. */
export interface StartInput {
  /** The `Worker command` text, passed to the wrapper as its one argument. */
  command: string;
  /** `PLOT_WORKER_LOG`: where the wrapper's output goes. */
  log: string;
  /** `PLOT_WORKER_LOG_APPEND=1`: keep the log's existing text. */
  append: boolean;
  /** The desk the wrapper runs in. */
  cwd: string;
  /** The running Node version, `process.versions.node`. */
  running: string;
  /** The text of Plot's `.nvmrc`; `''` when it cannot be read. */
  pin: string;
  /** Where the pin was read, for the refusal. */
  pinFile: string;
  /** The absolute path of `plot-worker-wrapper.mjs`. */
  wrapper: string;
}

/** What one start answers: the exit code and the lines for stderr. */
export interface StartOutcome {
  /** 0 once the wrapper started; 1 for a refusal; 2 for a usage error. */
  code: number;
  /** The wrapper's pid; `0` when none started. */
  pid: number;
  /** What to print on stderr; empty on success. */
  message: string;
}

/**
 * Reads the start's command and log from its argv and environment.
 *
 * @param argv - the arguments after the script; the first is the command.
 * @param env - the process environment.
 * @returns the command and log, or the reason the start cannot run.
 */
export const startArgs = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; command: string; log: string; append: boolean } | { ok: false; why: string } => {
  const command = argv[0] ?? '';
  if (argv.length !== 1 || command === '') return { ok: false, why: 'usage: plot-worker-start.mjs <worker command>' };
  const log = env.PLOT_WORKER_LOG ?? '';
  if (log === '') return { ok: false, why: 'plot-worker-start: PLOT_WORKER_LOG unset' };
  return { ok: true, command, log, append: env.PLOT_WORKER_LOG_APPEND === '1' };
};

/**
 * Starts the wrapper when the running Node is the pinned major.
 *
 * @param input - the command, the log, the desk, both Node readings and the wrapper path.
 * @param detached - the port that starts the wrapper apart from this process.
 * @returns the code, the wrapper's pid, and the refusal text.
 */
export const startWorker = (input: StartInput, detached: Detached): StartOutcome => {
  const pin = nodePin(input.running, input.pin);
  if (!pin.ok) {
    return {
      code: 1,
      pid: 0,
      message:
        `plot-worker-start: node on PATH is ${pin.running ?? 'unreadable'}, Plot pins ${pin.pinned ?? 'unreadable'} (${input.pinFile})\n`
        + `  no wrapper started, so the desk holds no exit record.\n`
        + `  Put node ${pin.pinned ?? 'of the pinned major'} first on PATH, then dispatch again.\n`,
    };
  }
  const started = detached.node(input.wrapper, [input.command], input.cwd, input.log, input.append);
  if (started.pid === 0) {
    return { code: 1, pid: 0, message: `plot-worker-start: ${input.wrapper} did not start\n` };
  }
  return { code: 0, pid: started.pid, message: '' };
};

/**
 * Plot's `.nvmrc`: the nearest one in the bundle's directory or above it. A
 * checkout ships the bundles at `skills/plot/scripts/board/`, four levels
 * below that file; a copied scripts directory directly under the repository
 * root, as a mutation test makes, sits two levels below it.
 *
 * @param bundleDir - the directory the bundle runs from.
 * @param exists - whether a path names a file.
 * @returns the nearest `.nvmrc`; the checkout's location when none exists, so a refusal names where it looked.
 */
export const pinFileFor = (bundleDir: string, exists: (file: string) => boolean): string => {
  for (let dir = path.resolve(bundleDir); ; dir = path.dirname(dir)) {
    const file = path.join(dir, '.nvmrc');
    if (exists(file)) return file;
    if (path.dirname(dir) === dir) return path.resolve(bundleDir, '../../../../.nvmrc');
  }
};

/** The pin's text, or `''` when the file cannot be read. */
const readPin = (file: string): string => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

// Only when RUN, never when imported. `pathToFileURL` over `realpathSync`
// because `import.meta.url` is realpath-resolved and `process.argv[1]` is not.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = startArgs(process.argv.slice(2), process.env);
  if (!args.ok) {
    process.stderr.write(`${args.why}\n`);
    void endEntry(2);
  } else {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pinFile = pinFileFor(here, existsSync);
    const outcome = startWorker(
      {
        command: args.command,
        log: args.log,
        append: args.append,
        cwd: process.cwd(),
        running: process.versions.node,
        pin: readPin(pinFile),
        pinFile,
        wrapper: path.join(here, 'plot-worker-wrapper.mjs'),
      },
      detachedNode(),
    );
    process.stderr.write(outcome.message);
    void endEntry(outcome.code);
  }
}
