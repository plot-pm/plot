/**
 * What was measured about ONE agent's ability to continue its own conversation.
 *
 * Every field is a reading rather than a judgement, the shape `DeskReadings`
 * and `TreeReadings` already use: the caller decides what it read, and this
 * decides what it means.
 *
 * **The transcript reading is the load-bearing one.** Plot exports
 * `PLOT_SESSION_ID` and the adopting project's `.plot/worker-prompt.sh` decides
 * whether to pass it on as `--session-id`. Plot owns neither that file nor the
 * harness it invokes, so the only honest way to learn whether the assertion
 * took is to look for the transcript the runtime would have written under that
 * id.
 */
export interface ResumeReadings {
  /**
   * The resume handle the manifest carries, or `''` when it carries none.
   *
   * Distinct from the session id even where the two hold the same value. The
   * session is the transcript join key and stays fixed across a branch hop by
   * design; the resume handle is a different identity with a different
   * lifetime, and whether it should follow a hop cannot even be asked while one
   * field carries both meanings.
   */
  resumeId: string;
  /**
   * Whether a transcript exists for {@link resumeId}.
   *
   * The caller answers this with `transcriptFile(transcriptDir(worktree),
   * resumeId)`, which joins on `${sessionId}.jsonl` and returns null when the
   * file is absent. A second matcher would be a second way to be wrong.
   */
  transcriptFound: boolean;
}

/**
 * Why a session cannot be resumed.
 *
 * `no-id` is a manifest that never recorded a handle — an older dispatch, or a
 * launch that could not write one. `no-transcript` is a handle the runtime
 * never wrote a transcript for, which is what the adopter's prompt file omitting
 * `--session-id` looks like from Plot's side. They reach the same verdict from
 * different readings, and a caller that confused them would tell an operator to
 * fix a config key that is already correct.
 */
export type ResumeUnavailable = 'no-id' | 'no-transcript';

/**
 * Whether a correction can be delivered into the agent's own conversation.
 *
 * A discriminated union rather than a boolean plus a nullable id: `available`
 * is the only state in which a handle exists, and the type says so instead of
 * asking every caller to remember it.
 */
export type ResumeAvailability =
  | { available: true; resumeId: string }
  | { available: false; why: ResumeUnavailable; detail: string };

/**
 * Whether this agent's session can be resumed with a correction.
 *
 * **The check is the gate, not the documentation.** Plot asserts a session id
 * into the worker's environment and documents the `--session-id` an adopting
 * project's prompt file must pass; it can require neither, because that file
 * and the harness it runs both belong to the project. So availability is
 * decided by looking for the transcript rather than by trusting that the
 * contract was honoured.
 *
 * A resume path that silently did nothing would be worse than not having one,
 * because a supervisor would report a correction it never delivered. The caller
 * that gets `available: false` starts a fresh worker with the gate failures
 * written into its brief.
 *
 * @param readings - what was measured of the agent's manifest and transcript
 *   directory.
 * @returns the handle to resume with, or why there is none.
 */
export const resumeAvailability = (readings: ResumeReadings): ResumeAvailability => {
  if (readings.resumeId === '') {
    return {
      available: false,
      why: 'no-id',
      detail:
        'The manifest records no resume handle, so there is no conversation to continue. Start a fresh worker and put the gate failures in its brief.',
    };
  }
  if (!readings.transcriptFound) {
    return {
      available: false,
      why: 'no-transcript',
      detail: `No transcript exists for session \`${readings.resumeId}\`. Plot exported it as \`PLOT_SESSION_ID\`, but the project's \`.plot/worker-prompt.sh\` did not pass it on as \`--session-id "$PLOT_SESSION_ID"\`, or the harness it runs writes no transcript. Resume is unavailable here; start a fresh worker and put the gate failures in its brief.`,
    };
  }
  return { available: true, resumeId: readings.resumeId };
};

/**
 * The correction a resumed agent is handed — the gate failures, as a prompt.
 *
 * Written to be read by an agent rather than parsed: each failure is already a
 * sentence naming what is missing and what to do about it, so this frames them
 * and changes none of their words. A gate's own text is the specification of
 * the fix, and re-wording it here would give the next attempt a second, weaker
 * account of the same problem.
 *
 * The same text serves both paths. A resumed agent reads it as *what you left
 * undone*; a fresh worker reads it in its brief as *what the last attempt left
 * undone*, which is why the branch is named rather than assumed from context.
 *
 * @param branch - the branch the failures are about.
 * @param failures - one message per failed gate, in `ALL_GATES` order.
 * @returns the correction, or `''` when nothing failed.
 */
export const correctionPrompt = (branch: string, failures: readonly string[]): string => {
  if (failures.length === 0) return '';
  return [
    `Your work on \`${branch}\` did not complete. Each item below is a check that ran over what you left behind, and each names what to do about it:`,
    '',
    ...failures.map((failure) => `- ${failure}`),
    '',
    'Fix every item, then commit and push. Do not start other work.',
  ].join('\n');
};
