/**
 * Composes the one fresh session's answer for a `turn-limit` ending.
 *
 * **NOT `freshAgentAnswer`, BECAUSE NOTHING WAS SPENT.** That composer's whole
 * text is about a correction budget — "the build failed... after all N
 * corrections were handed back" — and a `turn-limit` ending has no
 * corrections file and no failing run to report: `agent-loop.ts` writes its
 * detail as the fixed string `'the run reached Agent max turns'`, which
 * {@link runFromEndingDetail} parses as empty for both fields. Reusing the
 * corrections wording here would tell the fresh session a budget was spent
 * that never was.
 *
 * @param branch - the branch the slice was working.
 * @returns the answer, ready to hand to a continuation alongside its brief.
 */
export const freshAgentTurnLimitAnswer = (branch: string): string =>
  [
    `The previous session on \`${branch}\` reached Agent max turns before it finished. That is a session grown too long, not a wrong answer — pick up from what already landed, and keep this session shorter: commit progress as you go rather than holding everything until the end.`,
  ].join('\n');
