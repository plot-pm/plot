import type { IssueAnswer } from '../entities/issue.js';

/**
 * The binding question Create plan and Create story each ask — whether THIS
 * BOARD can act. Structurally typed to the board's `DispatchInfo`, so a
 * caller holding the richer wire type passes it unchanged.
 */
export interface CreateFromIssueBinding {
  readonly available: boolean;
  readonly reason: string;
}

/** Which control is asking: the issue row's two acts share one rule. */
export type CreateFromIssueKind = 'plan' | 'story';

/** What `createFromIssueVerdict` decided, and why. */
export type CreateFromIssueVerdict =
  | { readonly kind: 'available' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Decides whether Create plan or Create story may act, for one issue row.
 *
 * **Two independent questions, and both must pass.** `binding` says whether
 * this board can spawn anything; `issueAnswer` says whether the tracker can
 * be asked at all — a Bitbucket repo (`unsupported`) and a tracker whose
 * lookup broke (`failed`) each make the action impossible for reasons the
 * binding knows nothing about.
 *
 * `null` means the tracker has not been read yet, which is a THIRD state
 * `IssueAnswer` has no member for: it is not a standing fact like
 * `unsupported`, so the verdict is quiet (`pending`) rather than printing a
 * refusal sentence that would be wrong once the first read lands.
 *
 * The order matters: `unsupported` (a standing host fact that will still be
 * true tomorrow) outranks a binding that merely happens to be unavailable
 * right now, so the reader is told the fix that will actually help.
 *
 * @param binding - whether this board will act, and why not.
 * @param issueAnswer - whether the tracker could be asked; `null` before the first read.
 * @param kind - which control is asking, for the wording of the two sentences below.
 * @returns `available`, `pending` (inactive, no sentence) or `refused` with a reason.
 */
export const createFromIssueVerdict = (
  binding: CreateFromIssueBinding,
  issueAnswer: IssueAnswer | null,
  kind: CreateFromIssueKind,
): CreateFromIssueVerdict => {
  if (issueAnswer === null) return { kind: 'pending' };
  if (issueAnswer === 'unsupported') {
    return {
      kind: 'refused',
      reason: kind === 'plan'
        ? 'this git host has no issue read, so an issue cannot become a plan from here'
        : 'this git host has no issue read, so a ticket cannot become a story from here',
    };
  }
  if (issueAnswer === 'failed') {
    return {
      kind: 'refused',
      reason: kind === 'plan'
        ? 'the issue lookup is failing, so this issue cannot be read — nothing was created'
        : 'the issue lookup is failing, so this ticket cannot be read — nothing was created',
    };
  }
  if (!binding.available) {
    return { kind: 'refused', reason: binding.reason || `this board cannot create ${kind === 'plan' ? 'plans' : 'stories'}` };
  }
  return { kind: 'available' };
};
