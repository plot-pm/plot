/**
 * The `.plot/hold` file kept, with every entry for a named branch removed.
 *
 * An entry's first field is matched by exact string equality against the
 * plan's branches, never as a pattern — `plot-phase-gate.sh` reads the same
 * field the same way, so a pattern here would release a hold the plan never
 * named.
 *
 * @param content - the hold file's current content, or `undefined` when the
 *   file does not exist.
 * @param branches - the branches the plan names.
 * @returns the file's content with matching entries removed, and the count
 *   removed. `kept` is `undefined` only when the input was `undefined` and
 *   none of `branches` were present to remove — there is nothing to write.
 */
export const clearHolds = (
  content: string | undefined,
  branches: readonly string[],
): { kept: string | undefined; removed: number } => {
  if (content === undefined) return { kept: undefined, removed: 0 };
  if (branches.length === 0) return { kept: content, removed: 0 };

  const named = new Set(branches);
  const lines = content.split('\n');
  const trailingNewline = content.endsWith('\n');
  const body = trailingNewline ? lines.slice(0, -1) : lines;

  let removed = 0;
  const kept = body.filter((line) => {
    const branch = line.split(/\s/, 1).join('');
    if (named.has(branch)) {
      removed += 1;
      return false;
    }
    return true;
  });

  const rebuilt = kept.length === 0 ? '' : kept.join('\n') + (trailingNewline ? '\n' : '');
  return { kept: rebuilt, removed };
};
