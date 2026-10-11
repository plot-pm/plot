/** Whether a lifecycle file is a plan or a sprint. */
export type LifecycleKind = 'plan' | 'sprint';

/**
 * The `State:` value in a plan or sprint file's `## Status` section.
 *
 * Scoped to that section: plans quote a status block in prose to document the
 * format, and the first `State:` anywhere in the file is that illustration.
 * `Phase:` is read as well, the name the field had before 2026-09-07. A line
 * matches when it is a bullet or bare, optionally bold, and its key is
 * followed by `:` or `*`. The first match wins.
 *
 * @param text - the file's content.
 * @returns the value with surrounding whitespace removed; `''` when the
 *   section holds no such line.
 */
export const statusStateOf = (text: string): string => {
  let inStatus = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      inStatus = line.startsWith('## Status');
      continue;
    }
    if (inStatus && /^[ \t]*[-*]?[ \t]*\**(state|phase)[:*]/i.test(line)) {
      return line.replace(/^[^:]*:\**[ \t]*/, '').replace(/[ \t]*$/, '');
    }
  }
  return '';
};

/**
 * Whether a path is a plan or a sprint file, by directory membership only.
 *
 * @param path - a repository-relative path.
 * @param planDir - the `Plan directory` config value.
 * @param sprintDir - the `Sprint directory` config value.
 * @returns the kind, or `null` for any other path.
 */
export const lifecycleKindOf = (path: string, planDir: string, sprintDir: string): LifecycleKind | null => {
  if (path.startsWith(`${planDir.replace(/\/+$/, '')}/`)) return 'plan';
  if (path.startsWith(`${sprintDir.replace(/\/+$/, '')}/`)) return 'sprint';
  return null;
};

/**
 * The slug of a plan or sprint file. The two kinds cut differently: a plan is
 * `YYYY-MM-DD-<slug>.md` (three dashes of prefix), a sprint `YYYY-Www-<slug>.md`
 * (two). Cutting a sprint at three returns its whole basename, and the refusal
 * then names a command nothing answers to.
 *
 * @param kind - the file's kind.
 * @param path - the file's path.
 * @returns the slug.
 */
export const slugOf = (kind: LifecycleKind, path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const cuts = kind === 'sprint' ? 2 : 3;
  let rest = base;
  for (let i = 0; i < cuts; i += 1) {
    const dash = rest.indexOf('-');
    if (dash === -1) return rest;
    rest = rest.slice(dash + 1);
  }
  return rest;
};

/**
 * The `/plot-sprint` verb for a sprint state. An unknown state reads as
 * `commit`.
 */
export const sprintVerb = (state: string): string => {
  switch (state.toLowerCase()) {
    case 'active':
      return 'start';
    case 'closed':
      return 'close';
    default:
      return 'commit';
  }
};

/**
 * The command that owns a transition into `to`, named for the file.
 *
 * @param kind - the file's kind.
 * @param slug - the file's slug from {@link slugOf}.
 * @param to - the state the commit stages.
 * @returns the line an operator runs; for a plan state no command writes, the
 *   lifecycle and a pointer to report the gap.
 */
export const owningCommand = (kind: LifecycleKind, slug: string, to: string): string => {
  if (kind === 'sprint') {
    return `/plot-sprint ${slug} ${sprintVerb(to)}  (or: bash skills/plot/scripts/plot-sprint-state.sh ${slug} ${to})`;
  }
  switch (to.toLowerCase()) {
    case 'approved':
      return `/plot-approve ${slug}  (or: bash skills/plot/scripts/plot-approve.sh ${slug})`;
    case 'delivered':
      return `/plot-deliver ${slug}  (or: bash skills/plot/scripts/plot-deliver.sh ${slug})`;
    default:
      return `/plot-approve or /plot-deliver — the plan lifecycle is Draft > Approved > Delivered > Released,\n                    and no command writes '${to}'. If the phase itself is wrong, that is a finding to report.`;
  }
};

/** A change of a plan's or sprint's `State:` value that a commit carries. */
export interface StateTransition {
  /** The repository-relative path. */
  path: string;
  kind: LifecycleKind;
  /** The value in `HEAD`. */
  before: string;
  /** The value being committed. */
  after: string;
}

/**
 * The transition a file's commit carries, or `null` when it carries none.
 *
 * Passes, in this order: a file with no `HEAD` version (a creation), a
 * working copy with no `State:` value (a deleted line), and an unchanged
 * value. A `HEAD` version with no `State:` value also passes: there is no
 * before to change from.
 *
 * @param path - the repository-relative path.
 * @param kind - the file's kind.
 * @param head - the file's text in `HEAD`, or `null` when `HEAD` holds no such file.
 * @param working - the file's text being committed, or `null` when unreadable.
 */
export const stateTransitionOf = (
  path: string,
  kind: LifecycleKind,
  head: string | null,
  working: string | null,
): StateTransition | null => {
  if (head === null || working === null) return null;
  const before = statusStateOf(head);
  if (before === '') return null;
  const after = statusStateOf(working);
  if (after === '' || before === after) return null;
  return { path, kind, before, after };
};

/** What a commit command stages for itself, before the commit runs. */
export interface CommitStaging {
  /** `-a`, `--all` or `-am`: the commit also takes the tracked files modified in the working tree. */
  takesModified: boolean;
  /** A chained `git add` names the whole tree (`-A`, `--all`, `-a`, `.`, `-u`, `--update`). */
  addsTree: boolean;
  /** The literal path tokens of every chained `git add`, as typed. */
  addedPaths: readonly string[];
}

/**
 * What a `git commit` command carries beyond the index. The hook runs before
 * a chained `git add -A && git commit -m x` stages anything, so the index
 * alone is not what the commit will contain.
 *
 * Deliberately crude, and conservative in the same direction: the command
 * splits on `&&`, `;`, `|` and newlines, each segment containing `git add` is
 * read after its last `git add`, and a flag that names the whole tree counts
 * everything. It is not a shell parser.
 *
 * @param command - the Bash command text.
 */
export const commitStagingOf = (command: string): CommitStaging => {
  const takesModified = / -(a|am) /.test(command) || / -(a|am)$/.test(command) || command.includes(' --all');
  let addsTree = false;
  const addedPaths: string[] = [];
  if (command.includes('git add')) {
    for (const segment of command.split(/&&|;|\||\n/)) {
      const at = segment.lastIndexOf('git add');
      if (at === -1) continue;
      for (const token of segment.slice(at + 'git add'.length).split(/\s+/)) {
        if (token === '') continue;
        if (['-A', '--all', '-a', '.', '-u', '--update'].includes(token)) addsTree = true;
        else if (!token.startsWith('-')) addedPaths.push(token);
      }
    }
  }
  return { takesModified, addsTree, addedPaths };
};

/**
 * The refusal for transitions no receipt cleared, or `null` when there are
 * none. The gate judges the writer, not the word: any changed value is
 * refused, including one no lifecycle admits.
 *
 * @param uncleared - the transitions with no matching receipt, in path order.
 * @returns the text for stderr.
 */
export const stateTransitionRefusal = (uncleared: readonly StateTransition[]): string | null => {
  if (uncleared.length === 0) return null;
  const lines = ['plot state gate: a lifecycle field has one writer, and this commit is not it.'];
  for (const { path, kind, before, after } of uncleared) {
    lines.push(
      '',
      `  ${path}`,
      `    ${before} -> ${after}, written by hand.`,
      `    The command that owns this write: ${owningCommand(kind, slugOf(kind, path), after)}`,
    );
  }
  lines.push(
    '',
    'Run it, then commit what it wrote. It asks the rule that refuses a transition the',
    'lifecycle does not allow — which an editor on a markdown line cannot do, and did not',
    'on 2026-09-08, when three states were written wrong in one afternoon.',
    '',
    'If the line is wrong for a reason no command covers, that is a finding to report —',
    'a missing transition is the gap this plan says to file rather than work around.',
  );
  return lines.join('\n');
};
