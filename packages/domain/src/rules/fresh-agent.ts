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
  /** What that run concluded (for example `failure`), or `''` where none was read. */
  conclusion: string;
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
  if (input.runUrl === '' && input.conclusion === '') {
    parts.push('No run could be read for this ending.');
  } else {
    if (input.runUrl !== '') parts.push(`- ${input.runUrl}`);
    if (input.conclusion !== '') parts.push(`- conclusion: ${input.conclusion}`);
  }

  return parts.join('\n');
};
