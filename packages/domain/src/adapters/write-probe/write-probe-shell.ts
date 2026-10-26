import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { answered, unaskable, type PortResult } from '../../port-result.js';
import type { WriteProbe } from '../../ports/write-probe.js';
import { FALLBACK_PROMPT } from '../../rules/prompt.js';
import type { WriteProbeReading } from '../../rules/write-probe.js';
import { runProcess, type RunOptions, type ScriptRun } from '../run-script.js';
import type { ShellContext } from '../scripts.js';

/** How long one of the probe's own runs may take before it counts as `unanswerable`. */
const DEFAULT_PROBE_TIMEOUT_MS = 120_000;

/** The marker the probe's prompt asks the agent to write. */
const MARKER_NAME = 'write-probe.touched';

/** The seams a probe needs, so a slow or absent harness can be stubbed. */
export interface WriteProbeShellOptions {
  /** How long each of the probe's own runs may take, in milliseconds. Defaults to {@link DEFAULT_PROBE_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Runs one process; defaults to {@link runProcess}. */
  run?: (command: string, args: readonly string[], options?: RunOptions) => Promise<ScriptRun>;
  /** Cuts a scratch directory under the given prefix, returning its path; defaults to {@link mkdtemp}. */
  mkdtemp?: (prefix: string) => Promise<string>;
  /** Removes the scratch directory at the given path; defaults to {@link rm}. */
  rm?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  /** Checks whether a path exists; defaults to {@link existsSync}. */
  exists?: (path: string) => boolean;
}

/** The argv `.plot/worker-prompt.sh` prints under `PLOT_PRINT_INVOCATION=1`, one token per line. */
const parseInvocation = (stdout: string): string[] =>
  stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

/**
 * Runs the project's prompt file once in a scratch desk, through a
 * `WriteProbe` port.
 *
 * **NEVER THE `Worker command` ITSELF.** That string launches the worker
 * LOOP, which waits on the registry for a branch and never returns outside
 * one. What the loop sources on every pass is the prompt file at
 * {@link FALLBACK_PROMPT} (or a charter's own, for a named agent), and that
 * file is the harness invocation — the flags this probe exists to prove, down
 * to their absence. So the probe asks that file for the argv it would run,
 * under `PLOT_PRINT_INVOCATION=1`, which prints and exits 0 without
 * launching — and then runs the harness with EXACTLY those flags, substituting
 * its own one-shot prompt for the file's hardcoded one. Adding a flag the
 * printed invocation omitted (`--permission-mode`, in particular) would prove
 * a command the fleet never runs.
 *
 * **ABSENT IS NOT FALSE.** No prompt file on disk, a harness that cannot be
 * resolved, a scratch desk that cannot be cut, or a run that times out all
 * answer `unanswerable`: none of them observed a refused write.
 */
export const writeProbeShell = (context: ShellContext, options: WriteProbeShellOptions = {}): WriteProbe => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const run = options.run ?? runProcess;
  const cutScratch = options.mkdtemp ?? mkdtemp;
  const removeScratch = options.rm ?? rm;
  const exists = options.exists ?? existsSync;

  return {
    // `command` names which configured role this probe stands in for, for a
    // caller that reports it; the loop sources ONE prompt file regardless of
    // what string is configured, so nothing here branches on it.
    check: async (_command: string): Promise<PortResult<WriteProbeReading>> => {
      const promptPath = join(context.repoRoot, FALLBACK_PROMPT);
      if (!exists(promptPath)) return unaskable<WriteProbeReading>('no prompt file to probe');

      let scratch: string;
      try {
        scratch = await cutScratch(join(tmpdir(), 'plot-write-probe-'));
      } catch {
        return unaskable<WriteProbeReading>('could not cut a scratch desk');
      }

      try {
        const printed = await run('bash', ['-c', `. "$1"`, 'bash', promptPath], {
          cwd: scratch,
          env: { PLOT_PRINT_INVOCATION: '1', PLOT_BRANCH: 'write-probe/scratch', PLOT_WORKTREE: scratch },
          timeoutMs,
        });
        if (printed.code !== 0) return unaskable<WriteProbeReading>('the prompt file could not report its invocation');

        const [harness, ...flags] = parseInvocation(printed.stdout);
        if (harness === undefined || harness === '') return unaskable<WriteProbeReading>('no harness resolved');

        const marker = join(scratch, MARKER_NAME);
        const prompt = `Write the single character x to the file at ${marker}, creating it if it does not exist, then stop. Do nothing else.`;
        const probed = await run(harness, [...flags, '-p', prompt], { cwd: scratch, timeoutMs });
        if (probed.interrupted === 'timeout') return unaskable<WriteProbeReading>('the probe run timed out');

        return answered<WriteProbeReading>(exists(marker) ? 'yes' : 'no');
      } finally {
        await removeScratch(scratch, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
};
