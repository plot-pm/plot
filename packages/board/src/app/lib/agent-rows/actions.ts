import {
  type PulseShrink,
  type Repair,
  type StuckState,
} from '../../../contract/schema.js';

/**
 * Seconds until the next refresh, given how many have passed and how many the
 * interval is — or null when the age is unknown.
 *
 * Clamped at zero: a poll can be late (a hidden tab, a slow response), and
 * "next in -2s" is not something a reader can act on.
 */
/**
 * What to tell an operator whose board just got smaller on a successful scan.
 *
 * NAMES WHAT VANISHED, and that is the whole reason the server sends identities
 * rather than counts. "3 plans became 2" makes the reader open a terminal to
 * find out which; the name lets them recognise the plan they delivered ninety
 * seconds ago — expected, ignorable — or fail to recognise it, which is the
 * defect and is worth their attention.
 *
 * BRANCHES ARE NAMED BEFORE PLANS when both are lost, because a lost branch is
 * the sharper signal: losing a plan file has an innocent explanation an operator
 * performs by hand, while a WORKING branch that disappears while its agent runs
 * has none.
 *
 * The list is capped and the remainder counted rather than truncated silently —
 * a banner that grows without bound stops being a banner, and "+4 more" is still
 * a number the reader can act on.
 */
export function shrinkNote(shrink: PulseShrink, ageSeconds: number): string {
  const parts: string[] = [];
  if (shrink.branches.length > 0) parts.push(nameList(shrink.branches, 'branch', 'branches'));
  if (shrink.plans.length > 0) parts.push(nameList(shrink.plans, 'plan', 'plans'));
  // Both empty cannot happen — the server returns null rather than an empty
  // shrink — but a banner rendering the word "undefined" over a healthy board
  // would be worse than the bug, so the honest fallback is spelled out.
  const lost = parts.length > 0 ? parts.join(' and ') : 'something it had a moment ago';
  return `This scan succeeded but describes less than the last one: ${lost} `
    + `disappeared in the last ${ageSeconds}s. The rows below are the NEW answer, `
    + `not a frozen one — they may be right, or the scan may have read a moving `
    + `working tree.`;
}

/**
 * `a, b and 2 more branches` — at most three names, then a count.
 *
 * Exported for use by exception summary in fold heads: `claimed twice, conflict
 * and 2 more` is the same grammar, naming exceptions rather than branches.
 */
export function nameList(names: string[], one: string, many: string): string {
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  const noun = names.length === 1 ? one : many;
  const tail = rest > 0 ? ` and ${rest} more` : '';
  return `${noun} ${shown.join(', ')}${tail}`;
}

export function countdown(ageSeconds: number | null, intervalSeconds: number): number | null {
  if (ageSeconds === null) return null;
  return Math.max(0, intervalSeconds - ageSeconds);
}

/**
 * What the changed-files menu item SAYS — a count, never the list.
 *
 * The item is one line in a menu, so it says how MANY and the panel it opens
 * says which. A label that listed the paths would put the dump back one click
 * away rather than removing it, which is the whole of what this branch does.
 *
 * The count is also the fact a reader uses to decide whether to click at all:
 * *1 file* and *34 files* are different situations, and the second is worth
 * knowing before opening it.
 *
 * Exported for test — the singular is where a template string goes wrong, and
 * "1 files" is invisible in a screenshot of a row that has six.
 */
export function changedFilesLabel(count: number): string {
  return `Changed ${count} file${count === 1 ? '' : 's'}`;
}

/**
 * Does this stuck state OFFER an action on the row?
 *
 * Two of the four do, and the two that do not are the load-bearing half — a cue
 * on every row makes the stuck ones invisible.
 *
 * **`unpushed` offers nothing, ever.** The fix is a push, and pushing someone
 * else's uncommitted judgement is not a mechanical act. It is reported in words
 * and that is the entire treatment.
 *
 * **`artifact-conflict` offers nothing IN THIS SLICE.** Slice 3 resolves it — the
 * only automatic write this plan ever grants — and until that exists the state
 * is reported like any other, with no action. Offering one here would be this
 * slice building the thing it is fenced away from.
 *
 * Exported for test: the two negatives are what a blanket "stuck rows get a
 * button" implementation gets wrong, and both pass every positive assertion.
 */
export function offersAction(state: StuckState): boolean {
  return state === 'conflict' || state === 'ci-failing';
}

/**
 * What the row says about the one repair this system performs by itself.
 *
 * **EVERY REPAIR IS REPORTED — running, pushed, or abandoned.** A silent
 * automatic write is indistinguishable from a defect, which is the failure mode
 * the whole stuck-branch plan exists to remove, and it is the one that would
 * arrive here: the branch stays `artifact-conflict` for the entire repair
 * (nothing about the refs changes until the push lands), so a row that only
 * showed `stuck` would sit unchanged for five minutes while a machine wrote to
 * the branch. Indistinguishable, from the outside, from the pulse ignoring it.
 *
 * **The failures are reported as loudly as the success.** `abandoned` is the
 * repair's own gate stopping it — a failed rebuild, a red `test:board`, a
 * rejected push — and it means nothing was pushed and this conflict is now a
 * human's. A word that only appeared on success would be quietest exactly when a
 * reader most needs it.
 *
 * "" for a branch nothing was attempted on, which renders as nothing at all.
 *
 * Exported for test: an implementation that reports only `pushed` passes every
 * assertion that a successful repair is visible.
 */
export function repairWord(repair: Repair | null | undefined): string {
  if (!repair) return '';
  if (repair.state === 'running') return 'repairing — merge, rebuild, test:board';
  switch (repair.outcome) {
    case 'pushed':
      return 'repaired automatically — rebuilt and pushed after test:board passed';
    case 'abandoned':
      // The reason is the script's own word, and it is carried rather than
      // translated: `tests-failed` and `build-failed` end in the same place for
      // the reader (nothing was pushed) and in different places for whoever
      // opens the log.
      return `repair abandoned${repair.reason ? ` — ${repair.reason}` : ''}; nothing was pushed`;
    case 'refused':
      return `repair refused${repair.reason ? ` — ${repair.reason}` : ''}`;
    default:
      return 'repair finished';
  }
}
