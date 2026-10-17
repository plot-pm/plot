import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type { PlanStatePhase, PlanStateOutcome, PlanStateWrite } from '../../ports/tracker.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { unaskableReasonOf } from './tracker-shell.js';

/** The phases, in the order their labels are named. */
const PHASES: readonly PlanStatePhase[] = ['draft', 'approved', 'delivered', 'released'];

/**
 * The `plan:*` label a phase sets.
 *
 * @param phase - the plan's phase.
 * @returns `plan:<phase>`.
 */
export const planStateLabel = (phase: PlanStatePhase): string => `plan:${phase}`;

/**
 * The comma-separated `plan:*` labels a write removes, so an issue carries one.
 *
 * @param phase - the phase being set, which is kept.
 * @returns every other phase's label.
 */
export const planStateLabelsToRemove = (phase: PlanStatePhase): string =>
  PHASES.filter((other) => other !== phase)
    .map(planStateLabel)
    .join(',');

/**
 * The marker a plan's comment carries, so a re-run finds it and edits it.
 *
 * @param planLink - the plan file's address; its file name is the plan's slug.
 * @returns an HTML comment holding the slug.
 */
export const planStateMarker = (planLink: string): string => {
  const slug = (planLink.split('/').pop() ?? planLink).replace(/\.md$/, '');
  return `<!-- plot-plan-state: ${slug} -->`;
};

/**
 * The comment body for a phase.
 *
 * @param write - the plan-state write.
 * @returns the marker, then one line naming the phase, the plan link and, for
 *   `released`, the version.
 */
export const planStateComment = (write: PlanStateWrite): string => {
  const release = write.phase === 'released' && write.version ? ` in ${write.version}` : '';
  return `${planStateMarker(write.planLink)}\nPlan ${write.phase}${release}: ${write.planLink}`;
};

/** The issue number an identifier ends in, or null where it names none. */
const numberOf = (issue: string): string | null => /(\d+)\s*$/.exec(issue)?.[1] ?? null;

/**
 * Performs a plan-state write on a GitHub issue through `plot-host.sh`.
 *
 * Three steps in order, stopping at the first that fails: replace the `plan:*`
 * label, post or edit the plan's comment, and close the issue where the phase
 * is `released`.
 *
 * @param context - where the scripts and the repository are.
 * @param env - the environment the calling connector runs `plot-host.sh` under.
 * @param refuse - records the refusal the calling connector's `lastRefusal` reports.
 * @returns the connector's `planStateWrite`: `written`; `no-target` where the
 *   issue names no number; `unaskable` on exit 4; `failed` otherwise.
 */
export const githubPlanStateWrite =
  (context: ShellContext, env: Record<string, string>, refuse: (said: string | null) => void) =>
  async (write: PlanStateWrite): Promise<PortResult<PlanStateOutcome>> => {
    const number = numberOf(write.issue);
    if (number === null) {
      refuse(null);
      return answered<PlanStateOutcome>('no-target');
    }
    const host = scriptPath(context, 'plot-host.sh');
    const steps: string[][] = [
      ['issue-label', number, planStateLabel(write.phase), planStateLabelsToRemove(write.phase)],
      ['issue-comment', number, planStateMarker(write.planLink), planStateComment(write)],
    ];
    if (write.phase === 'released') steps.push(['issue-close', number]);
    for (const step of steps) {
      const said = await runProcess('bash', [host, ...step], { cwd: context.repoRoot, env });
      if (said.code === 4) {
        refuse(null);
        return unaskable(unaskableReasonOf(said.stderr));
      }
      if (said.code !== 0) {
        refuse(said.stderr.trim() || said.stdout.trim() || `plot-host.sh ${step[0]} exited ${said.code}`);
        return failed();
      }
    }
    refuse(null);
    return answered<PlanStateOutcome>('written');
  };
