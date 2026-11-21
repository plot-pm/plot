/**
 * The directory that holds a repository's `.plot/state` files: the main
 * checkout, never a linked worktree. Only `stateHomeOf` creates one, so a raw
 * repository root does not type-check where a home is required.
 */
export type StateHome = string & { readonly __brand: 'StateHome' };
