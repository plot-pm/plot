import type { EndingReason } from '../entities/ending.js';

/**
 * What one tick read of a desk whose worker ended on a spent correction
 * budget — or on anything else, which this rule must also recognise.
 *
 * **THE DESK, NOT THE REGISTRY.** The manifest is gone by the time a slice
 * spends its budget — `plot-worker-loop.sh`'s exit trap removes it on every
 * exit — so a rule keyed on an agent entry never sees this ending at all.
 * `an-unanswered-question-escalates` reads desks for the same reason. Every
 * field here is a reading a caller took off the worktree or the plan store,
 * never a derived judgement.
 */
export interface FreshAgentReadings {
  /**
   * The desk's own ending reason, or `null` where no ending was written or it
   * could not be read.
   *
   * Only `'corrections-spent'` is this rule's to answer. Every other reason —
   * including `'unstarted'`, which this value was folded into before
   * `a-spent-correction-budget-gets-a-fresh-agent` — answers `none`, because
   * the old meaning still needs its own handling and a rule that answered both
   * would be the regression this value exists to end.
   */
  ending: EndingReason | null;
  /**
   * Whether a manifest already names this desk.
   *
   * **A DESK THE TICK IS ABOUT TO START IS NOT A DESK WITH NO MANIFEST.** The
   * ending and the manifest's removal are not one atomic write in the shell,
   * so a tick that read the ending before a start already in flight wrote its
   * new manifest would start a second session into the same worktree — the
   * exact failure `/api/continue`'s own `no-manifest` refusal exists to name
   * from the other direction. `true` here answers `none`, whatever the ending
   * says: the desk is not this rule's to act on again.
   */
  hasManifest: boolean;
  /**
   * How many fresh sessions this slice already had, from `.plot/state/fresh-agents.tsv`.
   *
   * **A MISSING OR UNREADABLE RECORD IS `0`, NEVER A REFUSAL AND NEVER A
   * SECOND SESSION'S PROOF.** The plan is explicit both ways: absence can
   * start one session too many — a tick that raced the record's own write —
   * but it must never be read as *this slice already had one*, which would
   * strand a slice at a person for a record this estate never wrote. The
   * caller is the one place that tells a missing file from a count of zero,
   * because only the caller touched the disk.
   */
  priorFreshSessions: number;
}

/**
 * What the supervisor should do about a desk whose worker ended, as this
 * rule alone can answer.
 *
 * - `start-fresh` — the slice reached `corrections-spent` for the first time.
 *   One new session, on the same desk, with every correction and the failing
 *   run in its answer.
 * - `needs-a-person` — a second spent budget on the same slice. The rule that
 *   restarted forever is the unbounded case the plan names, and this is the
 *   bound: one fresh session, then a person.
 * - `none` — every other ending, a desk already carrying a manifest, or a
 *   slice this rule has already started once. Not every `none` means *leave
 *   it alone* — `needs-a-person` is itself a stop — but it does mean *this
 *   rule has nothing to add*.
 */
export type FreshAgentVerdict = 'start-fresh' | 'needs-a-person' | 'none';

/**
 * Decides whether a spent correction budget earns a desk one fresh agent
 * session, or whether that has already been spent too.
 *
 * **ONE RULE, NOT TWO QUESTIONS.** *Does this ending qualify* and *has the
 * one-session allowance been used* are the same decision read off the same
 * readings — splitting them would let a caller ask the second without the
 * first and act on a count that was never about a `corrections-spent` ending
 * at all.
 *
 * **THE MARKER IS NEVER ASKED HERE, AND THAT OMISSION IS DELIBERATE.** A
 * `PLOT-BLOCKED` marker the agent wrote itself for some other reason is a
 * question already owed to a person — `an-unanswered-question-escalates`
 * keeps every one of those apart from this rule. Widening this to answer on
 * the marker's presence alone would make it answer a question nobody asked
 * it; only `ending === 'corrections-spent'` ever qualifies.
 *
 * Pure: it reads no disk and holds nothing between calls, so a daemon
 * restarted mid-tick reaches the same verdict from the same files on its next
 * pass, the same property `supervise` has.
 *
 * @param readings - what the tick measured of one desk.
 * @returns what to do about it.
 */
export const freshAgentAfterCorrections = (readings: FreshAgentReadings): FreshAgentVerdict => {
  if (readings.ending !== 'corrections-spent') return 'none';
  // A MANIFEST ALREADY NAMING THIS DESK MEANS SOMETHING ELSE IS ACTING ON IT —
  // either the tick's own start from an earlier pass has not yet recorded
  // itself in the TSV, or a person already restarted it by hand. Either way a
  // second start here would run two agents in one worktree.
  if (readings.hasManifest) return 'none';
  return readings.priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh';
};

/**
 * One correction this rule's composed answer carries, already in the order
 * `PLOT-CORRECTION.md` holds them — oldest first.
 *
 * A READING, NOT A RE-DERIVATION. The file is a desk's own account of every
 * attempt the loop already made, and this rule hands it on rather than
 * re-summarising it — the same choice `correctionPrompt` makes about gate
 * failures, for the same reason: a correction's own text is the specification
 * of what was tried, and paraphrasing it here would give the fresh session a
 * second, weaker account of the same attempts.
 */
export interface FreshAgentAnswerInput {
  /** The branch the budget was spent on. */
  branch: string;
  /** How many corrections the budget allowed, for the sentence that names it. */
  budget: number;
  /**
   * `PLOT-CORRECTION.md`'s text, verbatim, or `''` where it could not be
   * read. Already holds every correction in order; this function does not
   * parse it apart.
   */
  correctionsText: string;
  /** The failing run's URL, or `''` where none was read. */
  runUrl: string;
  /** What that run's failed step reported, or `''` where none was read. */
  failedStep: string;
}

/**
 * Composes the one fresh session's answer: every correction in order, the
 * failing run, and one instruction.
 *
 * **THIS RULE'S WHOLE OUTPUT, AND NOTHING MORE.** `composeContinuation`
 * (`board/src/server/continue.ts`) still builds the rest of the prompt — the
 * brief, what landed, the *you are continuing* framing — because that part
 * answers a question every continuation has, not one specific to a spent
 * budget. This answers only the part `AgentResumeWrite.correction` and a
 * continuation's `answer` field both need: what makes THIS fresh session
 * different from a plain continuation is the full correction history and the
 * run that proved the budget spent, and that is what this builds.
 *
 * **THE CORRECTIONS FILE IS INCLUDED WHOLE, NEVER SUMMARISED.** Each
 * correction is already a sentence naming what CI found and what to do about
 * it — the same register `correctionPrompt` uses — and re-wording the
 * cumulative file here would give the fresh session a second, drifting account
 * of what the previous sessions already tried.
 *
 * @param input - the branch, the budget, the corrections file, and the
 *   failing run.
 * @returns the answer, ready to hand to a continuation alongside its brief.
 */
export const freshAgentAnswer = (input: FreshAgentAnswerInput): string => {
  const parts: string[] = [
    `The previous session spent its correction budget: the build failed on \`${input.branch}\` after all ${input.budget} corrections were handed back, and the last one still failed. Read every failure below before you change anything, and run the checks that failed locally before you push.`,
    '',
  ];

  parts.push('## Every correction this slice already received, oldest first', '');
  parts.push(
    input.correctionsText.trim() === ''
      ? 'No `PLOT-CORRECTION.md` could be read from this worktree — read it yourself before starting.'
      : input.correctionsText.trim(),
  );
  parts.push('');

  parts.push('## The run that proved the budget spent', '');
  if (input.runUrl === '' && input.failedStep === '') {
    parts.push('No run could be read for this ending.');
  } else {
    if (input.runUrl !== '') parts.push(`- ${input.runUrl}`);
    if (input.failedStep !== '') parts.push(`- failed step: ${input.failedStep}`);
  }

  return parts.join('\n');
};
