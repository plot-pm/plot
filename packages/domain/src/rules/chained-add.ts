/** The `git add` arguments that name the whole tree rather than a pathspec. */
export const TREE_FLAGS: readonly string[] = ['-A', '--all', '-a', '.', '-u', '--update'];

/**
 * The pathspecs every chained `git add` in a Bash call names, which a hook
 * reading the index cannot see because it runs before the add.
 *
 * Deliberately crude, and conservative in one direction: the command splits
 * on `&&`, `;`, `|` and newlines, and each segment is read from its first
 * `git add` to its end. A {@link TREE_FLAGS} token is the whole tree; any
 * other token starting with `-` is a flag and skipped. It is not a shell
 * parser: quotes and globs are left as typed, for the caller to read.
 *
 * @param command - the Bash command text.
 * @returns one entry per pathspec, in order; `null` stands for the whole tree.
 */
export const chainedAddsOf = (command: string): readonly (string | null)[] => {
  const adds: (string | null)[] = [];
  for (const segment of command.split(/&&|;|\||\n/)) {
    const at = segment.indexOf('git add');
    if (at === -1) continue;
    for (const token of segment.slice(at + 'git add'.length).split(/\s+/)) {
      if (token === '') continue;
      if (TREE_FLAGS.includes(token)) adds.push(null);
      else if (!token.startsWith('-')) adds.push(token);
    }
  }
  return adds;
};
