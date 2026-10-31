import { gitCallsWhere } from './main-checkout-write.js';

/** The `git add` arguments that name the whole tree rather than a pathspec. */
export const TREE_FLAGS: readonly string[] = ['-A', '--all', '-a', '.', '-u', '--update'];

/** One pathspec a chained `git add` names, and where that call is placed. */
export interface ChainedAdd {
  /** The pathspec, or `null` for the whole tree. */
  spec: string | null;
  /** The directory the call is placed in: `null` for the working directory, `'unplaced'` when the text does not give it. */
  dir: string | null | 'unplaced';
}

/**
 * Every chained `git add` in a Bash call, through the same `-C`/`cd`-aware
 * walk {@link gitCallsWhere} gives committing calls, which a hook reading the
 * index cannot see because it runs before the add.
 *
 * Deliberately crude in its own pathspec parsing, conservative in one
 * direction: a {@link TREE_FLAGS} token is the whole tree; any other token
 * starting with `-` is a flag and skipped. It is not a shell parser: quotes
 * and globs are left as typed, for the caller to read.
 *
 * @param command - the Bash command text.
 * @returns one entry per pathspec, in order; `spec: null` stands for the whole tree.
 */
export const chainedAddsOf = (command: string): readonly ChainedAdd[] => {
  const adds: ChainedAdd[] = [];
  for (const call of gitCallsWhere(command, (sub) => sub === 'add')) {
    const dir = call.placed ? call.dir : 'unplaced';
    for (const token of call.args) {
      if (token === '') continue;
      if (TREE_FLAGS.includes(token)) adds.push({ spec: null, dir });
      else if (!token.startsWith('-')) adds.push({ spec: token, dir });
    }
  }
  return adds;
};
