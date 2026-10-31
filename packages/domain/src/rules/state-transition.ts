import { chainedAddsOf, type ChainedAdd } from './chained-add.js';

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

/** The field name of the spike approval record, as the plan file spells it. */
export const SPIKE_APPROVED_FIELD = 'Spike approved';

/**
 * The `Spike approved:` record in a plan's `## Status` section.
 *
 * Scoped to that section for the reason {@link statusStateOf} is. A line
 * matches when it is a bullet or bare, optionally bold, and its key is followed
 * by `:` or `*`. The first match wins. An unfilled placeholder reads as no
 * record.
 *
 * @param text - the file's content.
 * @returns the value with surrounding whitespace removed; `''` when the
 *   section holds no such line or the line holds no value.
 */
export const spikeApprovalOf = (text: string): string => {
  let inStatus = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      inStatus = line.startsWith('## Status');
      continue;
    }
    if (inStatus && /^[ \t]*[-*]?[ \t]*\**spike approved[:*]/i.test(line)) {
      return line.replace(/^[^:]*:\**[ \t]*/, '').replace(/[ \t]*$/, '');
    }
  }
  return '';
};

/**
 * The key a receipt for the `Spike approved:` record is filed under: the plan
 * path and the field name. A `State:` receipt is keyed on the bare path, and a
 * receipt is found by the oid of its whole key, so neither spends as the
 * other.
 *
 * @param path - the plan's repository-relative path.
 */
export const spikeReceiptKey = (path: string): string => `${path}#${SPIKE_APPROVED_FIELD}`;

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
 * @param from - the state in `HEAD`; Delivered → Approved names `/plot-reject`.
 * @returns the line an operator runs; for a plan state no command writes, the
 *   lifecycle and a pointer to report the gap.
 */
export const owningCommand = (
  kind: LifecycleKind,
  slug: string,
  to: string,
  from = '',
): string => {
  if (kind === 'sprint') {
    return `/plot-sprint ${slug} ${sprintVerb(to)}  (or: bash skills/plot/scripts/plot-sprint-state.sh ${slug} ${to})`;
  }
  switch (to.toLowerCase()) {
    case 'design':
      return `needs-design ${slug}  (or: node skills/plot/scripts/board/plot-needs-design.mjs ${slug} --who <handle>)`;
    case 'approved':
      if (from.toLowerCase() === 'delivered') {
        return `/plot-reject ${slug}  (or: bash skills/plot/scripts/plot-undeliver.sh ${slug} --why <reason>)`;
      }
      return `/plot-approve ${slug}  (or: bash skills/plot/scripts/plot-approve.sh ${slug})`;
    case 'delivered':
      return `/plot-deliver ${slug}  (or: bash skills/plot/scripts/plot-deliver.sh ${slug})`;
    default:
      return `/plot-approve or /plot-deliver — the plan lifecycle is Draft > Design > Approved > Delivered > Released,\n                    and no command writes '${to}'. If the phase itself is wrong, that is a finding to report.`;
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
  /**
   * The field the transition changes. Absent for the `State:` line; the
   * `Spike approved:` record sets it, and its receipt is filed under
   * {@link spikeReceiptKey}.
   */
  field?: typeof SPIKE_APPROVED_FIELD;
}

/**
 * The key the receipt that clears a transition is filed under, and the value it
 * holds.
 *
 * @param transition - a transition from {@link stateTransitionsOf}.
 */
export const receiptOf = (transition: StateTransition): { key: string; value: string } => ({
  key: transition.field === SPIKE_APPROVED_FIELD ? spikeReceiptKey(transition.path) : transition.path,
  value: transition.after,
});

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
 * On a merge, `working` equal to one of `otherParentTexts` also passes: that
 * parent's own commit already passed the gate, so the text arrives with proof
 * of provenance rather than by hand. The comparison is on the whole file, not
 * on the extracted value — a merge that also hand-edits the line matches no
 * parent and keeps requiring a receipt. A removal is never cleared this way:
 * no command removes the line, so no parent's commit could have passed the
 * gate carrying one.
 *
 * @param path - the repository-relative path.
 * @param kind - the file's kind.
 * @param head - the file's text in `HEAD`, or `null` when `HEAD` holds no such file.
 * @param working - the file's text being committed, or `null` when unreadable.
 * @param renamed - the same-slug file the commit deletes, or `null`.
 * @param otherParentTexts - the file's text in each parent other than `HEAD`;
 *   empty for a non-merge commit.
 */
export const stateTransitionOf = (
  path: string,
  kind: LifecycleKind,
  head: string | null,
  working: string | null,
  renamed: DeletedFile | null = null,
  otherParentTexts: readonly string[] = [],
): StateTransition | null => {
  if (working === null) return null;
  const source = head ?? renamed?.head ?? null;
  if (source === null) return null;
  const before = statusStateOf(source);
  const after = statusStateOf(working);
  if (before === after) return null;
  if (after !== '' && otherParentTexts.includes(working)) return null;
  return {
    path,
    kind,
    before,
    after,
    ...(head === null && renamed !== null ? { renamedFrom: renamed.path } : {}),
  };
};

/**
 * The transition of a plan's `Spike approved:` record a commit carries, or
 * `null` when it carries none.
 *
 * Judged as {@link stateTransitionOf} judges the `State:` line, except that a
 * plan with no `HEAD` version and no same-slug deletion reads its `before` as
 * `''`: a new plan file that arrives holding the record is an addition, since
 * the record opens dispatch and `/plot-idea` never writes one. Only a plan can
 * carry the record. The merge-equality bypass is the same, and a removal is
 * never cleared by it for the same reason.
 *
 * @param path - the repository-relative path.
 * @param kind - the file's kind.
 * @param head - the file's text in `HEAD`, or `null` when `HEAD` holds no such file.
 * @param working - the file's text being committed, or `null` when unreadable.
 * @param renamed - the same-slug file the commit deletes, or `null`.
 * @param otherParentTexts - the file's text in each parent other than `HEAD`;
 *   empty for a non-merge commit.
 */
export const spikeTransitionOf = (
  path: string,
  kind: LifecycleKind,
  head: string | null,
  working: string | null,
  renamed: DeletedFile | null = null,
  otherParentTexts: readonly string[] = [],
): StateTransition | null => {
  if (kind !== 'plan' || working === null) return null;
  const source = head ?? renamed?.head ?? null;
  const before = source === null ? '' : spikeApprovalOf(source);
  const after = spikeApprovalOf(working);
  if (before === after) return null;
  if (after !== '' && otherParentTexts.includes(working)) return null;
  return {
    path,
    kind,
    before,
    after,
    field: SPIKE_APPROVED_FIELD,
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
  /**
   * The version in each parent other than `HEAD`, one per merge parent.
   * Empty for a non-merge commit, which is a `MERGE_HEAD` reading rather than
   * a property of the path.
   */
  otherParents?: readonly (FileVersion | null)[];
  /**
   * The path's version at the commit a rebase or cherry-pick is replaying
   * (`REBASE_HEAD`/`CHERRY_PICK_HEAD`), and at that commit's own first parent.
   * Absent for a plain commit, which carries no picked commit to compare
   * against.
   */
  picked?: { commit: FileVersion | null; parent: FileVersion | null };
}

/**
 * The transitions a commit carries, in the order of `readings`.
 *
 * A symbolic link reads as no file: it holds a target path and no `State:`
 * line, so a link in `HEAD` makes the path a creation, a link the commit takes
 * makes it a deletion, and a deleted link is never a rename source. A path with
 * a `HEAD` version and no committed one is a deletion, and is the rename source
 * {@link renamedFromOf} searches for a path with no `HEAD` version. Each path
 * is then judged by {@link stateTransitionOf} and, for a plan, by
 * {@link spikeTransitionOf} — both take `otherParents`' texts as an extra
 * reading, a symbolic link among them reading as no text the same way `head`
 * and `committed` do.
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
  const files = readings.map(({ path, kind, head, committed, otherParents }) => ({
    path,
    kind,
    head: textOf(head),
    committed: textOf(committed),
    otherParentTexts: (otherParents ?? []).flatMap((version) => {
      const text = textOf(version);
      return text === null ? [] : [text];
    }),
  }));
  const deleted = files.flatMap(({ path, head, committed }) =>
    committed === null && head !== null ? [{ path, head }] : [],
  );
  return files.flatMap(({ path, kind, head, committed, otherParentTexts }) => {
    const renamed = head === null ? renamedFromOf(path, kind, deleted, planDir, sprintDir) : null;
    const transitions = [
      stateTransitionOf(path, kind, head, committed, renamed, otherParentTexts),
      spikeTransitionOf(path, kind, head, committed, renamed, otherParentTexts),
    ];
    return transitions.filter((transition): transition is StateTransition => transition !== null);
  });
};

/**
 * Whether a `git commit` command takes the tracked files modified in the
 * working tree: `-a` or `-am` standing as a word, with a quote or the end
 * after it (`-am"msg"`), or `--all`. A `-a` inside a message reads as taking
 * them too, which is the conservative direction.
 *
 * `args` scopes the read to one placed commit call's own arguments
 * ({@link gitCallsWhere}, over {@link commitDirs}'s predicate) rather than the
 * whole line, so `git fetch --all && git commit -m x` carries no working
 * change; `null` keeps today's whole-line reading, for a floor-only line with
 * no placed call to scope to.
 *
 * @param command - the Bash command text.
 * @param args - one committing call's own arguments, or `null` for the whole line.
 */
export const takesModifiedOf = (command: string, args: readonly string[] | null = null): boolean => {
  const text = args === null ? command : args.join(' ');
  return /(^|\s)-am?(\s|$|["'])/.test(text) || text.includes(' --all') || text.startsWith('--all');
};

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
 * `commitArgs` scopes both reads to one placed commit call's own arguments —
 * `null` (a `git add` or `git mv` in another root than the commit being
 * judged, over {@link ChainedAdd.dir}) drops that chained add from the
 * count — so `git add -A && git -C y commit` does not count the add when `y`
 * is another worktree. `commitArgs: null` keeps today's whole-line reading,
 * for a floor-only line with no placed call to scope to.
 *
 * @param readings - the index, the working changes and the show-prefix.
 * @param command - the Bash command text.
 * @param commitArgs - one committing call's own arguments, or `null` for the whole line.
 * @param inRoot - whether a chained add's `dir` is in the root being judged; ignored when `commitArgs` is `null`.
 * @returns each carried path once, sorted by path.
 */
export const effectivePaths = (
  readings: CommitReadings,
  command: string,
  commitArgs: readonly string[] | null = null,
  inRoot: (dir: string | null | 'unplaced') => boolean = () => true,
): readonly EffectivePath[] => {
  const working = new Set<string>();
  const adds = chainedAddsOf(command).filter((add) => commitArgs === null || inRoot(add.dir));
  const whole =
    takesModifiedOf(command, commitArgs) ||
    adds.some((add) => add.spec === null || /[*?[]/.test(add.spec) || add.spec.replace(/^["']/, '').startsWith('/'));
  if (whole) {
    for (const path of readings.workingChanges) working.add(path);
  } else {
    for (const add of adds) {
      if (add.spec === null) continue;
      const path = normalizedPath(`${readings.showPrefix}${add.spec.replace(/^["']|["']$/g, '')}`);
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
 * The field value a picked commit (`REBASE_HEAD`/`CHERRY_PICK_HEAD`) itself
 * changed at a path, read the same way {@link stateTransitionOf} and
 * {@link spikeTransitionOf} read the working commit's own change — against
 * the picked commit's own first parent, not `HEAD`.
 *
 * @param field - which field to read; absent for the `State:` line.
 * @param parentText - the path's text at the picked commit's first parent, or
 *   `null` when the parent holds no such file.
 * @param pickedText - the path's text at the picked commit, or `null` when the
 *   picked commit holds no such file.
 */
export const pickedTransitionOf = (
  field: typeof SPIKE_APPROVED_FIELD | undefined,
  parentText: string | null,
  pickedText: string | null,
): { before: string; after: string } => {
  const valueOf = field === SPIKE_APPROVED_FIELD ? spikeApprovalOf : statusStateOf;
  return {
    before: parentText === null ? '' : valueOf(parentText),
    after: pickedText === null ? '' : valueOf(pickedText),
  };
};

/**
 * Whether a picked commit (`REBASE_HEAD`/`CHERRY_PICK_HEAD`) clears an
 * otherwise-uncleared transition: it made the identical `before -> after`
 * change to the identical path (and field) against its own first parent.
 *
 * A rebase or cherry-pick that stops on a conflict re-presents the same
 * commit to the gate; the receipt its first run spent is already gone, and
 * without this check the replay would be refused for a write the lifecycle
 * already allowed once. Comparing the picked commit's OWN before/after — not
 * the working tree's — is what keeps a revert refused: a revert's before and
 * after are the receipted change's own after and before, swapped, so they
 * never equal `transition`'s pair.
 *
 * @param transition - an uncleared transition, read from the working commit.
 * @param pickedBefore - the picked commit's own `before` for the same path and field.
 * @param pickedAfter - the picked commit's own `after` for the same path and field.
 */
export const pickedClears = (
  transition: StateTransition,
  pickedBefore: string,
  pickedAfter: string,
): boolean => transition.before === pickedBefore && transition.after === pickedAfter;

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
  for (const { path, kind, before, after, renamedFrom, field } of uncleared) {
    const spike = field === SPIKE_APPROVED_FIELD;
    const name = spike ? 'Spike approved' : 'State';
    const owner =
      after === ''
        ? `No command removes a '${name}:' line: a removal is a transition to none, and the line has one writer.`
        : spike
          ? `The command that owns this write: node skills/plot/scripts/board/plot-approve.mjs --spike ${slugOf(kind, path)} --who <handle>`
          : `The command that owns this write: ${owningCommand(kind, slugOf(kind, path), after, before)}`;
    lines.push(
      '',
      `  ${path}`,
      `    ${before === '' ? `(no ${name} line)` : before} -> ${after === '' ? '(line removed)' : after}, written by hand${renamedFrom === undefined ? '' : ` (renamed from ${renamedFrom})`}.`,
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
