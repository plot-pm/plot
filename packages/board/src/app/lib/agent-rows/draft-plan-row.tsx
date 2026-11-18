import { DRAFT_PLAN_NOTE, type Card, type DraftPlan } from '../../../contract/schema.js';
import { tupleFromPlan } from '../tuple-row.js';
import { TupleRowView } from '../../components/TupleRow.js';
import { cn } from '../utils.js';
import { draftRoundsText } from './working-agents.js';
import { openQuestionsChip, openQuestionsMore, sliceCountChip, type PlanIndex } from '@plot-pm/domain';

/**
 * A Draft plan with no branch, as a WAITING ON YOU row: the plan's name, its
 * phase, the sentence `DRAFT_PLAN_NOTE` and its interrogation rounds.
 *
 * NO MENU. The row says a decision is owed; approving it is `/plot-approve`,
 * and nothing here writes a phase.
 *
 * The rounds badge copies the Planning tab's two styles: a recorded count, 0
 * included, takes the filled badge, and an absent one the dashed italic badge,
 * so `not interrogated` and `0 rounds` never read alike.
 */
export const DraftPlanRowView = (
  { draft, card, onOpenPlan, planIndex }: {
    draft: DraftPlan;
    /** The plan's card, which holds the slice count and, for a Design plan, the open questions. */
    card?: Card | null;
    onOpenPlan?: (planFile: string) => boolean;
    /** The board's plan index — see `AgentListProps.planIndex`. */
    planIndex?: PlanIndex;
  },
) => {
  const recorded = draft.rounds !== undefined;
  const questions = draft.openQuestions ?? card?.openQuestions ?? null;
  const sliceChip = sliceCountChip(card?.sliceSummary?.slices);
  const questionChip = openQuestionsChip(questions);
  const more = openQuestionsMore(questions);
  const chipClass = 'shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return (
    <TupleRowView
      tuple={tupleFromPlan({
        plan: draft.plan,
        planFile: draft.planFile,
        // `?? []`: the client casts the payload, and an older server sends no
        // `issues` field.
        issues: draft.issues ?? [],
        phase: 'Draft',
        waitingDays: null,
      }, planIndex)}
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
        {sliceChip !== null && <span data-draft-plan-slices className={chipClass}>{sliceChip}</span>}
        {questionChip !== null && <span data-draft-plan-questions className={chipClass}>{questionChip}</span>}
        {questions?.first != null && (
          <span data-draft-plan-first-question className="min-w-0 truncate text-slate-700 dark:text-slate-200" title={questions.first}>
            {questions.first}
            {more !== null && <>{' '}<span data-draft-plan-more className="text-blue-600 dark:text-blue-400">{more}</span></>}
          </span>
        )}
        <span data-draft-plan-note className="min-w-0 truncate text-slate-500 dark:text-slate-400">
          {DRAFT_PLAN_NOTE}
        </span>
      </>}
    />
  );
};
