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
  /** The value in `HEAD`; `''` when `HEAD` holds no `State:` line. */
  before: string;
  /** The value being committed; `''` when the commit removes the line. */
  after: string;
  /** The deleted same-slug path whose `HEAD` value is `before`, for a rename. */
  renamedFrom?: string;
}

/** A file the commit deletes, with the text `HEAD` holds. */
export interface DeletedFile {
  /** The repository-relative path. */
  path: string;
  /** The file's text in `HEAD`. */
  head: string;
}

/**
 * The deleted file a new path replaces: the one of the same kind and the same
 * slug. A plan renamed to another date prefix keeps its slug, and the new path
 * has no `HEAD` version to compare against.
 *
 * @param path - the new path.
 * @param kind - the file's kind.
 * @param deleted - the files the commit deletes, in path order.
 * @param planDir - the `Plan directory` config value.
 * @param sprintDir - the `Sprint directory` config value.
 * @returns the first deleted file with the same slug, or `null`.
 */
export const renamedFromOf = (
  path: string,
  kind: LifecycleKind,
  deleted: readonly DeletedFile[],
  planDir: string,
  sprintDir: string,
): DeletedFile | null =>
  deleted.find(
    (file) =>
      file.path !== path &&
      lifecycleKindOf(file.path, planDir, sprintDir) === kind &&
      slugOf(kind, file.path) === slugOf(kind, path),
  ) ?? null;

/**
 * The transition a file's commit carries, or `null` when it carries none.
 *
 * A removal is a transition to none and an addition is a transition from none:
 * both change the value, and a line deleted in one commit and added back in the
 * next would otherwise write any value with no receipt. A file with no `HEAD`
 * version is a creation and passes, unless the commit deletes a same-slug file
 * ({@link renamedFromOf}); then the deleted file's text is `before`. A working
 * copy that cannot be read and an unchanged value pass. A `HEAD` version and a
 * working copy that both hold no value pass.
 *
 * @param path - the repository-relative path.
 * @param kind - the file's kind.
 * @param head - the file's text in `HEAD`, or `null` when `HEAD` holds no such file.
 * @param working - the file's text being committed, or `null` when unreadable.
 * @param renamed - the same-slug file the commit deletes, or `null`.
 */
export const stateTransitionOf = (
  path: string,
  kind: LifecycleKind,
  head: string | null,
  working: string | null,
  renamed: DeletedFile | null = null,
): StateTransition | null => {
  if (working === null) return null;
  const source = head ?? renamed?.head ?? null;
  if (source === null) return null;
  const before = statusStateOf(source);
  const after = statusStateOf(working);
  if (before === after) return null;
  return {
    path,
    kind,
    before,
    after,
    ...(head === null && renamed !== null ? { renamedFrom: renamed.path } : {}),
  };
};

/** The mode git gives a symbolic link. */
export const SYMLINK_MODE = '120000';

/** One side of a lifecycle path: its text, and whether it is a symbolic link. */
export interface FileVersion {
  /** The text git stores: a symbolic link's is its target path. */
  text: string;
  /** Whether the version is a symbolic link ({@link SYMLINK_MODE}). */
  link: boolean;
}

/** A path under the plan or sprint directory, as the state gate read it. */
export interface LifecycleReading {
  /** The repository-relative path. */
  path: string;
  kind: LifecycleKind;
  /** The version in `HEAD`, or `null` when `HEAD` holds no such path. */
  head: FileVersion | null;
  /** The version the commit takes, or `null` when the commit deletes the path or it is unreadable. */
  committed: FileVersion | null;
}

/**
 * The transitions a commit carries, in the order of `readings`.
 *
 * A symbolic link reads as no file: it holds a target path and no `State:`
 * line, so a link in `HEAD` makes the path a creation, a link the commit takes
 * makes it a deletion, and a deleted link is never a rename source. A path with
 * a `HEAD` version and no committed one is a deletion, and is the rename source
 * {@link renamedFromOf} searches for a path with no `HEAD` version. Each path
 * is then judged by {@link stateTransitionOf}.
 *
 * @param readings - every lifecycle path the commit carries, plus the old path
 *   of each rename git paired.
 * @param planDir - the `Plan directory` config value.
 * @param sprintDir - the `Sprint directory` config value.
 */
export const stateTransitionsOf = (
  readings: readonly LifecycleReading[],
  planDir: string,
  sprintDir: string,
): readonly StateTransition[] => {
  const textOf = (version: FileVersion | null): string | null =>
    version === null || version.link ? null : version.text;
  const files = readings.map(({ path, kind, head, committed }) => ({
    path,
    kind,
    head: textOf(head),
    committed: textOf(committed),
  }));
  const deleted = files.flatMap(({ path, head, committed }) =>
    committed === null && head !== null ? [{ path, head }] : [],
  );
  return files.flatMap(({ path, kind, head, committed }) => {
    const renamed = head === null ? renamedFromOf(path, kind, deleted, planDir, sprintDir) : null;
    const transition = stateTransitionOf(path, kind, head, committed, renamed);
    return transition === null ? [] : [transition];
  });
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
  for (const { path, kind, before, after, renamedFrom } of uncleared) {
    const owner =
      after === ''
        ? "No command removes a 'State:' line: a removal is a transition to none, and the line has one writer."
        : `The command that owns this write: ${owningCommand(kind, slugOf(kind, path), after)}`;
    lines.push(
      '',
      `  ${path}`,
      `    ${before === '' ? '(no State line)' : before} -> ${after === '' ? '(line removed)' : after}, written by hand${renamedFrom === undefined ? '' : ` (renamed from ${renamedFrom})`}.`,
      `    ${owner}`,
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
