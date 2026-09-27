import { DRAFT_PLAN_NOTE, type DraftPlan } from '../../../contract/schema.js';
import { tupleFromPlan } from '../tuple-row.js';
import { TupleRowView } from '../../components/TupleRow.js';
import { cn } from '../utils.js';
import { draftRoundsText } from './working-agents.js';

/**
 * A Draft plan with no branch, as a WAITING ON YOU row: the plan's name, its
 * phase, the sentence `DRAFT_PLAN_NOTE` and its interrogation rounds.
 *
 * NO MENU. The row says a decision is owed; approving it is `/plot-approve`,
 * and nothing here writes a phase.
 *
 * The rounds badge copies the Plans tab's two styles: a recorded count, 0
 * included, takes the filled badge, and an absent one the dashed italic badge,
 * so `not interrogated` and `0 rounds` never read alike.
 */
export const DraftPlanRowView = (
  { draft, onOpenPlan }: { draft: DraftPlan; onOpenPlan?: (planFile: string) => boolean },
) => {
  const recorded = draft.rounds !== undefined;
  return (
    <TupleRowView
      tuple={tupleFromPlan({ plan: draft.plan, planFile: draft.planFile, phase: 'Draft', waitingDays: null })}
      onOpenPlan={onOpenPlan}
      rowAttr={{ 'data-draft-plan-row': draft.plan }}
      statusExtra={<>
        <span
          data-draft-plan-rounds
          data-rounds={recorded ? 'recorded' : 'absent'}
          className={cn(
            'shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300',
            recorded
              ? ''
              : 'border border-dashed border-slate-400 bg-transparent italic text-slate-600 dark:border-slate-500 dark:bg-transparent dark:text-slate-300',
          )}
          title={recorded
            ? `Interrogated: ${draftRoundsText(draft.rounds)} of /challenge-the-plan`
            : 'No Rounds: field — nobody has interrogated this plan'}
        >
          {draftRoundsText(draft.rounds)}
        </span>
        <span data-draft-plan-note className="min-w-0 truncate text-slate-500 dark:text-slate-400">
          {DRAFT_PLAN_NOTE}
        </span>
      </>}
    />
  );
};
