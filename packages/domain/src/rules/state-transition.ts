import { chainedAddsOf } from './chained-add.js';

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

/**
 * Whether a `git commit` command takes the tracked files modified in the
 * working tree: `-a` or `-am` standing as a word, with a quote or the end
 * after it (`-am"msg"`), or `--all`. A `-a` inside a message reads as taking
 * them too, which is the conservative direction.
 *
 * @param command - the Bash command text.
 */
export const takesModifiedOf = (command: string): boolean =>
  /(^|\s)-am?(\s|$|["'])/.test(command) || command.includes(' --all');

/**
 * A path in its normal form: `.` segments and empty segments dropped, and a
 * `..` segment removing the one before it, as `path.posix.normalize` does. A
 * `..` above the root is dropped. The root normalises to `''`.
 *
 * @param path - a relative path.
 */
export const normalizedPath = (path: string): string => {
  const kept: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') kept.pop();
    else kept.push(segment);
  }
  return kept.join('/');
};

/** What the state gate reads before it decides which paths a commit carries. */
export interface CommitReadings {
  /** The repository-relative paths the index changes against `HEAD`. */
  staged: readonly string[];
  /** The repository-relative paths the working tree changes, untracked included. */
  workingChanges: readonly string[];
  /** The working directory relative to the repository root, with a trailing `/`, or `''` at the root. */
  showPrefix: string;
}

/** A path a commit carries, and where its committed text is read. */
export interface EffectivePath {
  /** The repository-relative path. */
  path: string;
  /** `index` when the commit takes the staged text, `working` when it takes the working copy. */
  carries: 'index' | 'working';
}

/**
 * The paths a `git commit` command carries, and for each whether the commit
 * takes the staged text or the working copy. The hook runs before a chained
 * `git add -A && git commit -m x` stages anything, so the index alone is not
 * what the commit will contain.
 *
 * The working copy is carried for every working change when the command
 * takes the modified files ({@link takesModifiedOf}) or a chained `git add`
 * names the whole tree: a tree flag (`chainedAddsOf`), a pathspec holding `*`,
 * `?` or `[`, an absolute pathspec, or one that normalises to the root. Any
 * other pathspec, joined to `showPrefix` and normalised, carries itself and
 * every working change under it, so a directory counts what it holds. Every
 * other staged path carries its staged text. Conservative in one direction: a
 * path read too widely only adds a reading.
 *
 * @param readings - the index, the working changes and the show-prefix.
 * @param command - the Bash command text.
 * @returns each carried path once, sorted by path.
 */
export const effectivePaths = (readings: CommitReadings, command: string): readonly EffectivePath[] => {
  const working = new Set<string>();
  const adds = chainedAddsOf(command);
  const whole =
    takesModifiedOf(command) ||
    adds.some((spec) => spec === null || /[*?[]/.test(spec) || spec.replace(/^["']/, '').startsWith('/'));
  if (whole) {
    for (const path of readings.workingChanges) working.add(path);
  } else {
    for (const spec of adds) {
      const path = normalizedPath(`${readings.showPrefix}${(spec as string).replace(/^["']|["']$/g, '')}`);
      if (path === '') {
        for (const change of readings.workingChanges) working.add(change);
        continue;
      }
      working.add(path);
      for (const change of readings.workingChanges) if (change.startsWith(`${path}/`)) working.add(change);
    }
  }
  const carried: EffectivePath[] = [...working].map((path) => ({ path, carries: 'working' as const }));
  for (const path of new Set(readings.staged)) if (!working.has(path)) carried.push({ path, carries: 'index' });
  return carried.sort((a, b) => (a.path < b.path ? -1 : 1));
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
