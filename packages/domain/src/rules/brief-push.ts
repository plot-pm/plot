/**
 * Whether a command pushes the slice branch a `--brief-only` implement run
 * briefs. `claimedBranches` reads every remote branch as a claim, so a ref the
 * brief run pushes holds the slice with no agent behind it (#2162).
 */
import { gitPushCalls } from './main-checkout-write.js';

/** The variable a brief-only implement run's spawn sets to `1`. */
export const BRIEF_ONLY_ENV = 'PLOT_BRIEF_ONLY';

/**
 * Whether the brief-push gate applies to a process with this environment.
 *
 * @param env - the environment of the gate's process.
 * @returns whether the process is a brief-only implement run.
 */
export const gatesBriefPush = (env: Readonly<Record<string, string | undefined>>): boolean =>
  env[BRIEF_ONLY_ENV] === '1';

/** The branch a refspec writes on the remote: the part after `:`, minus `refs/heads/` and a leading `+`. */
const destination = (refspec: string): string =>
  (refspec.includes(':') ? refspec.slice(refspec.indexOf(':') + 1) : refspec).replace(/^\+/, '').replace(/^refs\/heads\//, '');

/**
 * Whether `command` has a `git push` that writes `briefBranch` on a remote.
 * A push naming no refspec, or `HEAD`, writes `currentBranch`. A `--all` or
 * `--mirror` push writes every branch, and `--set-upstream` pushes the branch
 * to claim it, so each counts.
 *
 * @param command - the command line.
 * @param briefBranch - the branch the run briefs.
 * @param currentBranch - the branch the checkout is on, `''` where unknown.
 * @returns whether the command would push the brief branch.
 */
export const pushesBriefBranch = (command: string, briefBranch: string, currentBranch: string): boolean =>
  gitPushCalls(command).some((args) => {
    if (args.some((word) => word === '--all' || word === '--mirror')) return true;
    const operands = args.filter((word) => !word.startsWith('-'));
    const refspecs = operands.slice(1);
    if (refspecs.length === 0) return currentBranch === briefBranch;
    return refspecs.some((spec) => {
      const dest = destination(spec);
      return dest === briefBranch || (dest === 'HEAD' && currentBranch === briefBranch);
    });
  });

/**
 * The refusal text for a push of the brief branch.
 *
 * @param briefBranch - the branch the run briefs.
 * @returns the text for stderr.
 */
export const briefPushRefusal = (briefBranch: string): string =>
  [
    `plot-brief-push-gate: this command pushes ${briefBranch}, the branch this --brief-only run briefs.`,
    '  A remote branch is a claim: the queue drops the slice and no agent works it.',
    '  Commit the brief and the Started record on the default branch and push that. The agent that takes the slice up pushes its own branch.',
    '',
  ].join('\n');
