import { answered, failed, type PortResult } from '../../port-result.js';
import type { Revert, RevertOutcome } from '../../ports/revert.js';
import { runProcess } from '../run-script.js';
import type { ShellContext } from '../scripts.js';

/**
 * The {@link Revert} port over `git`.
 *
 * @param context - the repository.
 * @returns the port.
 */
export const revertGit = (context: ShellContext): Revert => {
  const inRepo = { cwd: context.repoRoot };

  return {
    isReverted: async (sha, ref): Promise<PortResult<boolean>> => {
      const run = await runProcess(
        'git',
        ['-C', context.repoRoot, 'log', '--fixed-strings', `--grep=This reverts commit ${sha}`, '-n', '1', '--format=%H', ref],
        inRepo,
      );
      return run.code === 0 ? answered(run.stdout.trim() !== '') : failed<boolean>();
    },

    revertCommit: async (path, sha): Promise<PortResult<RevertOutcome>> => {
      const parents = await runProcess('git', ['-C', path, 'rev-list', '--parents', '-n', '1', sha], inRepo);
      if (parents.code !== 0) return failed<RevertOutcome>();
      const mainline = parents.stdout.trim().split(/\s+/).length > 2 ? ['-m', '1'] : [];
      const run = await runProcess('git', ['-C', path, 'revert', '--no-edit', ...mainline, sha], inRepo);
      if (run.code === 0) return answered<RevertOutcome>('reverted');
      const inProgress = await runProcess('git', ['-C', path, 'rev-parse', '-q', '--verify', 'REVERT_HEAD'], inRepo);
      if (inProgress.code !== 0) return failed<RevertOutcome>();
      await runProcess('git', ['-C', path, 'revert', '--abort'], inRepo);
      return answered<RevertOutcome>('conflict');
    },
  };
};
