import { answered, failed, type PortResult } from '../../port-result.js';
import type { ClaimRelease, ClaimReleaseRun } from '../../ports/claim-release.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { runProcessSync } from '../run-script.js';

const DISPATCH = 'plot-dispatch.sh';

/**
 * Runs `plot-dispatch.sh --release` unchanged.
 *
 * The script writes its refusals to stderr and its success — including the
 * "nothing to release" no-op, which also exits 0 — to stdout. Exit code is
 * what tells them apart; the output's emptiness never is.
 *
 * @param context - the repository and where its helper scripts live.
 * @returns the port.
 */
export const claimReleaseShell = (context: ShellContext): ClaimRelease => ({
  release: (branch: string): PortResult<ClaimReleaseRun> => {
    const file = scriptPath(context, DISPATCH);
    const run = runProcessSync(file, ['--release', branch], { cwd: context.repoRoot });
    if (run.code === 0) return answered({ refused: false, sentence: run.stdout.trim() });
    if (run.stderr.trim() === '') return failed<ClaimReleaseRun>();
    return answered({ refused: true, sentence: run.stderr.trim() });
  },
});
