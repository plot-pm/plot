import { DRAFT_PLAN_NOTE, type Card, type DraftPlan } from '../../../contract/schema.js';
import { tupleFromPlan } from '../tuple-row.js';
import { TupleRowView } from '../../components/TupleRow.js';
import { draftRoundsText } from './working-agents.js';
import { openQuestionsChip, openQuestionsMore, openQuestionsTone, sliceCountChip, type OpenQuestionsTone, type PlanIndex } from '@plot-pm/domain';

/** The chip class of each open-questions tone. */
const QUESTIONS_TONE_CLASS: Record<OpenQuestionsTone, string> = {
  warn: 'delivery-tone-warn',
  neutral: 'delivery-tone-neutral',
};

/**
 * A Draft plan with no branch, as a WAITING ON YOU row: the plan's name, its
 * phase, the sentence `DRAFT_PLAN_NOTE` and its interrogation rounds.
 *
 * NO MENU. The row says a decision is owed; approving it is `/plot-approve`,
 * and nothing here writes a phase.
 *
 * The rounds badge copies the Planning tab's two styles: a recorded count, 0
 * included, takes the filled badge, and an absent one the dashed italic badge,
 * so `not interrogated` and `0 rounds` never read alike. `styles/delivery-you.css`
 * colours both shapes by `data-rounds`.
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
  const questionTone = openQuestionsTone(questions);
  const more = openQuestionsMore(questions);
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
          className="delivery-chip shrink-0"
          title={recorded
            ? `Interrogated: ${draftRoundsText(draft.rounds)} of /challenge-the-plan`
            : 'No Rounds: field — nobody has interrogated this plan'}
        >
          {draftRoundsText(draft.rounds)}
        </span>
        {sliceChip !== null && <span data-draft-plan-slices className="delivery-chip delivery-tone-neutral shrink-0">{sliceChip}</span>}
        {questionChip !== null && questionTone !== null && (
          <span data-draft-plan-questions className={`delivery-chip ${QUESTIONS_TONE_CLASS[questionTone]} shrink-0`}>{questionChip}</span>
        )}
        {questions?.first != null && (
          <span data-draft-plan-first-question className="delivery-text-muted delivery-truncate" title={questions.first}>
            {questions.first}
            {more !== null && <>{' '}<span data-draft-plan-more className="delivery-text-link">{more}</span></>}
          </span>
        )}
        <span data-draft-plan-note className="delivery-text-muted delivery-truncate">
          {DRAFT_PLAN_NOTE}
        </span>
      </>}
    />
  );
};
