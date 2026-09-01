import { z } from 'zod';

/**
 * The file an agent leaves in its worktree when a branch is finished.
 *
 * One per BRANCH, not one per agent: an agent hops, so a single end-of-life
 * file would be absent for every branch but the last.
 */
export const DECLARATION_FILENAME = '.plot-worker.envelope.json';

/**
 * What an agent says about the branch it just finished.
 *
 * Two values. `ok` is a finished branch; `blocked` is an agent reporting that
 * it cannot proceed, which is information and is not silence. A third value for
 * *failed* would duplicate what the gates decide from what was left behind.
 */
export const DeclarationStatusSchema = z.enum(['ok', 'blocked']);
export type DeclarationStatus = z.infer<typeof DeclarationStatusSchema>;

/**
 * The declaration's wire form.
 *
 * `branch` and `status` are required — a declaration that names no branch
 * cannot be attributed, and one with no status has said nothing. The other
 * three are what the agent chose to report and default to empty.
 *
 * Unknown keys are dropped rather than refused: a newer agent writing a field
 * this parse does not know is not a malformed declaration.
 */
export const DeclarationSchema = z.object({
  branch: z.string().min(1),
  status: DeclarationStatusSchema,
  artifacts: z.array(z.string()).default([]),
  pr: z.number().int().nullable().default(null),
  summary: z.string().default(''),
});

/**
 * One agent's account of one finished branch.
 *
 * Identity: the branch it names, scoped to the worktree it was written in.
 * Declared rather than derived — which is the point. The signals Plot computed
 * before it (`commits && clean tree && no PR`) can be wrong in both directions;
 * a declaration cannot, because nobody infers it.
 */
export interface Declaration {
  /** The branch this account is about. */
  branch: string;
  /** Finished, or stopped and saying so. */
  status: DeclarationStatus;
  /** The paths the agent claims it wrote; empty when it named none. */
  artifacts: readonly string[];
  /** The PR it opened; null when it opened none or named none. */
  pr: number | null;
  /** One sentence; `''` when the agent wrote none. */
  summary: string;
}

/**
 * The outcome of asking a desk what its agent declared.
 *
 * FOUR OUTCOMES, AND THE LAST TWO ARE NOT ONE. `absent` is a desk with no
 * declaration — the load-bearing case, and it means the work did not complete
 * whatever the exit code says, because an agent killed by the `Worker bound`
 * never reaches the write. `unreadable` is a file that exists and does not
 * parse: something was written and cannot be believed. Reporting that as
 * `absent` would claim a measurement nobody made, and reporting it as declared
 * would believe bytes nobody validated.
 *
 * This is {@link PortResult}'s shape applied to a file rather than to a port:
 * *cannot answer* is not *no*. This repo has twice shipped a collapse of those
 * two.
 */
export type DeclarationReading =
  | { read: 'declared'; declaration: Declaration }
  | { read: 'absent' }
  | { read: 'unreadable'; why: string };

/**
 * Reads a declaration from the text of one desk's file.
 *
 * Takes the text rather than a path: the domain does not touch the disk, so the
 * caller decides what it read and this decides what it means. `null` is how a
 * caller says the file was not there — an empty string is a file that exists
 * and holds nothing, which is unreadable rather than absent.
 *
 * @param text - the file's contents, or null when there is no file.
 * @returns what the desk declared, or why it could not be read.
 */
export const readDeclaration = (text: string | null): DeclarationReading => {
  if (text === null) return { read: 'absent' };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { read: 'unreadable', why: 'not JSON' };
  }

  const parsed = DeclarationSchema.safeParse(json);
  if (!parsed.success) {
    return { read: 'unreadable', why: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  return { read: 'declared', declaration: { ...parsed.data } };
};

/**
 * Whether a desk's branch is finished.
 *
 * Only a declared `ok` is complete. Every other reading is incomplete, and each
 * for its own reason: `blocked` is an agent that stopped and said so, `absent`
 * is an agent that never got to speak, `unreadable` is bytes nobody can
 * believe. The reading is kept apart from this verdict so a caller that needs
 * to tell them apart still can — this answers the one question where they
 * agree.
 *
 * @param reading - what the desk was read as.
 * @returns true only for a declaration that says `ok`.
 */
export const isComplete = (reading: DeclarationReading): boolean =>
  reading.read === 'declared' && reading.declaration.status === 'ok';

/**
 * Whether a desk holds an agent's report that it cannot proceed.
 *
 * Distinguished from absence in the TYPE rather than by convention: a caller
 * asks `read === 'declared' && status === 'blocked'`, never *is the file
 * missing in a particular way*.
 *
 * @param reading - what the desk was read as.
 * @returns true only for a declaration that says `blocked`.
 */
export const isBlocked = (reading: DeclarationReading): boolean =>
  reading.read === 'declared' && reading.declaration.status === 'blocked';
