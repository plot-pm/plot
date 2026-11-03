import { z } from 'zod';

/**
 * The unblocker's typed answer, parsed from its run's raw text output.
 *
 * `answer` is a successful `ANSWER` line with its text; `escalate` is an
 * `ESCALATE: <reason>` line with its reason; `refused` covers every other
 * shape — a first line with neither prefix, an `ANSWER` with no text
 * following, an `ESCALATE:` with no reason, or empty output.
 */
// plot-state: reading — the unblocker's run output, read once per run and
//                       never stored; `unblockOutcome` is the only parser.
export const UnblockOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), text: z.string() }),
  z.object({ kind: z.literal('escalate'), reason: z.string() }),
  z.object({ kind: z.literal('refused'), why: z.literal('unparseable-run') }),
]);
export type UnblockOutcome = z.infer<typeof UnblockOutcomeSchema>;

/**
 * Parses an unblocker run's raw output into its typed outcome.
 *
 * The contract is the first line: `ANSWER` (the rest of the output is the
 * answer text) or `ESCALATE: <reason>`. Anything else — an unrecognised
 * first line, an `ANSWER` with no following text, an `ESCALATE:` with no
 * reason, or empty output — is `refused` with `unparseable-run`.
 *
 * @param output - the run's raw text output.
 * @returns the typed outcome.
 */
export const unblockOutcome = (output: string): UnblockOutcome => {
  const lines = output.split('\n');
  const first = lines[0];
  if (first === 'ANSWER') {
    const text = lines.slice(1).join('\n').trim();
    return text === '' ? { kind: 'refused', why: 'unparseable-run' } : { kind: 'answer', text };
  }
  const escalate = /^ESCALATE:\s*(.*)$/.exec(first);
  if (escalate !== null) {
    const reason = escalate[1]!.trim();
    return reason === '' ? { kind: 'refused', why: 'unparseable-run' } : { kind: 'escalate', reason };
  }
  return { kind: 'refused', why: 'unparseable-run' };
};
