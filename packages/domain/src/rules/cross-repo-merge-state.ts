import type { PortResult } from '../port-result.js';
import type { CrossRepoReference } from './cross-repo-reference.js';

/** Whether the PRs a branch's cross-repo references name have merged. */
// plot-state: reading — the hosts' answers for one branch at one read; the next read asks again.
export type CrossRepoMergeState = 'merged' | 'not-merged' | 'unknown';

/** One cross-repo reference and the host's `prState` answer for it. */
export interface CrossRepoAnswer {
  /** The reference the slice line names, `owner/repo#N`. */
  readonly reference: CrossRepoReference;
  /** The host's answer to `prState(reference.number, { repo: reference.repo })`; `null` value where the host holds no such PR. */
  readonly answer: PortResult<{ readonly state: string } | null>;
}

/** How a branch's cross-repo references resolved. */
export interface CrossRepoMerge {
  /** The folded state of every reference. */
  readonly state: CrossRepoMergeState;
  /** The references whose own answer is `state`, in input order; empty where `state` is `merged`. */
  readonly held: readonly CrossRepoReference[];
}

const stateOf = (answer: CrossRepoAnswer['answer']): CrossRepoMergeState => {
  if (!answer.ok) return 'unknown';
  return answer.value !== null && answer.value.state === 'MERGED' ? 'merged' : 'not-merged';
};

/**
 * Folds the `prState` answers for a branch's cross-repo references into one merge state.
 *
 * A failed or unaskable answer reads `unknown`. An answer naming no PR, or a PR
 * whose state is not `MERGED`, reads `not-merged`. The fold takes `unknown`
 * over `not-merged` over `merged`, so one unread or unmerged reference holds the
 * branch. The deliverability gate and the plan walk both call this rule.
 *
 * @param answers - one entry per reference the branch's slice lines name.
 * @returns the folded state, with the references that hold it; `unknown` with
 *   no held reference where `answers` is empty, because no answer is no evidence of a merge.
 */
export const crossRepoMergeState = (answers: readonly CrossRepoAnswer[]): CrossRepoMerge => {
  if (answers.length === 0) return { state: 'unknown', held: [] };
  const states = answers.map((a) => stateOf(a.answer));
  const state: CrossRepoMergeState = states.includes('unknown')
    ? 'unknown'
    : states.includes('not-merged')
      ? 'not-merged'
      : 'merged';
  return {
    state,
    held: state === 'merged' ? [] : answers.filter((_, i) => states[i] === state).map((a) => a.reference),
  };
};
