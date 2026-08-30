import { FleetPulseSchema } from '../../entities/fleet.js';
import { answered, type PortResult } from '../../port-result.js';
import type { MergeStatus, Refs } from '../../ports/refs.js';
import { asJson, asLines, asText, runProcess, runScript, resultOf } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** The scan is 18 s against a large estate; the default two minutes would clip it. */
const PULSE_TIMEOUT_MS = 600_000;

/**
 * Reads git refs directly, and the fleet's pulse through `plot-fleet-scan.sh`.
 *
 * Git is called without a wrapper script because there is none to wrap: the
 * ref questions are single `git` invocations, and a shell script around one
 * `git rev-parse` would add a process without adding an implementation.
 *
 * The pulse is the exception and goes through the scan, which already derives
 * every plan's slice verdicts in one pass.
 *
 * @param context - where the scripts and the repository are.
 * @returns a `Refs` backed by git and the fleet scan.
 */
export const refsGit = (context: ShellContext): Refs => {
  const scan = scriptPath(context, 'plot-fleet-scan.sh');
  const inRepo = { cwd: context.repoRoot };

  const defaultBranch = (): Promise<PortResult<string>> =>
    runScript(
      'bash',
      ['-c', 'git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed "s|^origin/||" || git rev-parse --abbrev-ref HEAD'],
      asText,
      inRepo,
    );

  return {
    defaultBranch,

    listBranches: (remote) =>
      runScript(
        'git',
        remote
          ? ['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin']
          : ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads'],
        (stdout) => asLines(stdout).filter((name) => name !== 'HEAD'),
        inRepo,
      ),

    isMergedByAncestry: async (branch): Promise<PortResult<MergeStatus>> => {
      const main = await defaultBranch();
      if (!main.ok) return answered<MergeStatus>('unknown');
      const run = await runProcess(
        'git',
        ['merge-base', '--is-ancestor', branch, `origin/${main.value}`],
        inRepo,
      );
      if (run.code === 0) return answered<MergeStatus>('merged');
      if (run.code === 1) return answered<MergeStatus>('not-merged');
      return answered<MergeStatus>('unknown');
    },

    resolve: (ref) =>
      runScript('git', ['rev-parse', ref], asText, inRepo),

    changedFiles: async (branch) => {
      const main = await defaultBranch();
      if (!main.ok) return main as PortResult<readonly string[]>;
      return runScript(
        'git',
        ['diff', '--name-only', `origin/${main.value}...${branch}`],
        asLines,
        inRepo,
      );
    },

    pulse: async () => {
      const run = await runProcess('bash', [scan, '--json'], {
        ...inRepo,
        timeoutMs: PULSE_TIMEOUT_MS,
      });
      return resultOf(run, (stdout) => FleetPulseSchema.parse(asJson(stdout)));
    },

    showFile: (ref, path) =>
      runScript('git', ['show', `${ref}:${path}`], (stdout) => stdout, inRepo),
  };
};
