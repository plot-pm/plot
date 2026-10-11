import type { StagedPath } from '../ports/refs.js';
import { BRIEFS_DIR, briefPath } from './brief-path.js';

/** The `Branch prefixes` fallback, the same list `plot-phase-gate.sh` and `plot-release-refs.sh` use. */
export const DEFAULT_BRANCH_PREFIXES = 'idea/, feature/, bug/, docs/, infra/';

/**
 * The branch prefixes a brief name must not start with, from a `Branch
 * prefixes` config value.
 *
 * Splits on commas, drops whitespace and trailing slashes, and drops empty
 * entries. A blank value reads as the default list: an absent or empty key
 * never means "no prefixes, refuse nothing".
 *
 * @param raw - the configured value, e.g. `idea/, feature/`.
 * @returns the prefixes without their `/`, e.g. `['idea', 'feature']`.
 */
export const briefPrefixesOf = (raw: string): readonly string[] => {
  const list = raw.replace(/\s/g, '') === '' ? DEFAULT_BRANCH_PREFIXES : raw;
  return list
    .split(',')
    .map((entry) => entry.replace(/\s/g, '').replace(/\/+$/, ''))
    .filter((entry) => entry !== '');
};

/**
 * The path a misnamed brief belongs at, or `null` when the path is not a
 * misnamed brief.
 *
 * A brief lives at {@link briefPath}: `.plot/briefs/<slug>.md`, the slug being
 * the branch name after its last `/`. A path looks misnamed when it is a direct child of the briefs directory, ends in `.md`,
 * and its stem is `<prefix>-<rest>` with at least one character in `<rest>`.
 * The dash is required: `bugfix-x.md` and `feature.md` pass for prefix `bug`
 * and `feature`.
 *
 * A path that looks misnamed can still be {@link briefPath} of a branch whose
 * last segment starts with a prefix — `idea/feature-y` gives
 * `.plot/briefs/feature-y.md`. {@link briefNameRefusal} settles that from the
 * known branches and the brief's text.
 *
 * @param path - a repository-relative path.
 * @param prefixes - the prefixes from {@link briefPrefixesOf}.
 * @returns the corrected path, or `null`.
 */
export const briefComputedPath = (path: string, prefixes: readonly string[]): string | null => {
  if (!path.startsWith(`${BRIEFS_DIR}/`)) return null;
  const base = path.slice(BRIEFS_DIR.length + 1);
  if (base.includes('/') || !base.endsWith('.md')) return null;
  const stem = base.slice(0, -'.md'.length);
  for (const prefix of prefixes) {
    if (stem.length > prefix.length + 1 && stem.startsWith(`${prefix}-`)) {
      return `${BRIEFS_DIR}/${stem.slice(prefix.length + 1)}.md`;
    }
  }
  return null;
};

/** What a commit command stages before it commits. */
export interface ChainedStages {
  /**
   * One entry per `git add` pathspec; `null` stands for the whole tree
   * (`-A`, `--all`, `.`).
   */
  adds: readonly (string | null)[];
  /** The repository-relative destination of each `git mv`. */
  moves: readonly string[];
}

/**
 * The paths a chained `git add` or `git mv` in the same Bash call stages,
 * which a hook reading the index cannot see because it runs first.
 *
 * Deliberately crude: the command splits on `&&`, `;`, `|` and newlines, and
 * each segment is matched by substring for `git add` or `git mv`. It is not a
 * shell parser.
 *
 * @param command - the Bash command text.
 * @param showPrefix - the working directory relative to the repository root,
 *   with a trailing `/`, or `''` at the root.
 * @returns the pathspecs `git add` names and the destinations `git mv` names.
 */
export const chainedStagesOf = (command: string, showPrefix: string): ChainedStages => {
  const adds: (string | null)[] = [];
  const moves: string[] = [];
  for (const segment of command.split(/&&|;|\||\n/)) {
    const add = segment.indexOf('git add');
    const mv = segment.indexOf('git mv');
    if (add !== -1) {
      for (const token of segment.slice(add + 'git add'.length).split(/\s+/)) {
        if (token === '') continue;
        if (token === '-A' || token === '--all' || token === '.') adds.push(null);
        else if (!token.startsWith('-')) adds.push(token);
      }
    } else if (mv !== -1) {
      const words = segment
        .slice(mv + 'git mv'.length)
        .split(/\s+/)
        .filter((token) => token !== '' && !token.startsWith('-'));
      const last = words[words.length - 1];
      if (last !== undefined) moves.push(`${showPrefix}${last.replace(/^\.\//, '')}`);
    }
  }
  return { adds, moves };
};

/**
 * The paths a commit adds or renames to, from the index.
 *
 * A modify is never judged, so a repository holding a legacy misnamed brief
 * can still edit it on the way to a rename. A rename is judged by its
 * destination, which {@link StagedPath} already carries.
 *
 * @param staged - the index against `HEAD`.
 * @returns the added and renamed paths.
 */
export const addedOrRenamed = (staged: readonly StagedPath[]): readonly string[] =>
  staged.filter((entry) => entry.status !== 'modified').map((entry) => entry.path);

/** What a commit command lands, read before the commit runs. */
export interface BriefNameCommand {
  /** The index against `HEAD`. */
  staged: readonly StagedPath[];
  /** The untracked paths each chained `git add` would stage, relative to the repository root. */
  untracked: readonly string[];
  /** The destination of each chained `git mv`, relative to the repository root. */
  moves: readonly string[];
  /** The prefixes from {@link briefPrefixesOf}. */
  prefixes: readonly string[];
}

/** A path the commit lands whose name looks misnamed, and the path its prefix-drop computes. */
export interface BriefNameCandidate {
  path: string;
  want: string;
}

/**
 * The paths a commit lands that look misnamed, sorted. These are the only
 * paths {@link briefNameRefusal} reads the rest of its readings for.
 *
 * @param command - what the commit lands.
 * @returns each looking-misnamed path with the path {@link briefComputedPath} gives it.
 */
export const briefNameCandidates = ({ staged, untracked, moves, prefixes }: BriefNameCommand): readonly BriefNameCandidate[] =>
  [...new Set([...addedOrRenamed(staged), ...untracked, ...moves])].sort().flatMap((path) => {
    const want = briefComputedPath(path, prefixes);
    return want === null ? [] : [{ path, want }];
  });

/** Everything {@link briefNameRefusal} decides from. */
export interface BriefNameReadings extends BriefNameCommand {
  /** The candidate paths `HEAD` already holds. A path not here is read as absent from `HEAD`. */
  inHead: ReadonlySet<string>;
  /** The branch names the repository knows, local and on `origin`, without the remote name. */
  branches: ReadonlySet<string>;
  /** Each candidate brief's text, by path. A path not here has no text to read. */
  texts: ReadonlyMap<string, string>;
  /** The computed paths that already exist in the working tree. */
  present: ReadonlySet<string>;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The branch a looking-misnamed brief is the {@link briefPath} of, or `null`
 * when no evidence names one.
 *
 * Two readings count: a known branch `b` with `briefPath(b) === path`, and a
 * `<prefix>/<stem>` name in the brief's own text, for a configured prefix and
 * the file's stem — `idea/feature-y` in `.plot/briefs/feature-y.md`. The text
 * reading takes one `/` only, so a path such as `docs/plans/x` is not read as a
 * branch.
 * The gate cannot tell `feature/y`'s flattened brief from `idea/feature-y`'s
 * brief by the name alone, so without either reading the name is refused.
 *
 * @param path - a candidate from {@link briefNameCandidates}.
 * @param readings - the known branches, the brief texts and the prefixes.
 * @returns the branch, or `null`.
 */
export const briefBranchOf = (
  path: string,
  { branches, texts, prefixes }: Pick<BriefNameReadings, 'branches' | 'texts' | 'prefixes'>,
): string | null => {
  const known = [...branches].sort().find((branch) => briefPath(branch) === path);
  if (known !== undefined) return known;
  const stem = path.slice(BRIEFS_DIR.length + 1, -'.md'.length);
  const named = new RegExp(
    `(?<![\\w./-])(?:${prefixes.map(escape).join('|')})/${escape(stem)}(?![\\w/-]|\\.\\w)`,
  ).exec(texts.get(path) ?? '');
  return named === null ? null : named[0];
};

/** One misnamed brief the commit would land. */
export interface MisnamedBrief {
  /** The path as staged or about to be staged. */
  path: string;
  /** The path the readers compute. */
  want: string;
  /** Whether the index already tracks `path`, so `git mv` rather than `mv` reaches `want`. */
  tracked: boolean;
  /** Whether `want` already exists in the working tree. */
  wantExists: boolean;
}

/**
 * The misnamed briefs a commit lands.
 *
 * A candidate from {@link briefNameCandidates} is judged when it is a staged
 * add or rename, or when a chained `git add` or `git mv` reaches it and `HEAD`
 * does not hold it — a path already in `HEAD` is a modify, however the command
 * reaches it. A judged path is misnamed unless {@link briefBranchOf} names a
 * branch whose {@link briefPath} it is.
 *
 * @param readings - what the commit lands and what the repository holds.
 * @returns the misnamed briefs, sorted by path.
 */
export const misnamedBriefs = (readings: BriefNameReadings): readonly MisnamedBrief[] => {
  const stagedAdds = new Set(addedOrRenamed(readings.staged));
  return briefNameCandidates(readings).flatMap(({ path, want }) =>
    (stagedAdds.has(path) || !readings.inHead.has(path)) && briefBranchOf(path, readings) === null
      ? [{ path, want, tracked: stagedAdds.has(path), wantExists: readings.present.has(want) }]
      : [],
  );
};

/**
 * The refusal text for a commit that lands misnamed briefs, or `null` when it
 * lands none.
 *
 * @param readings - what the commit lands and what the repository holds.
 * @returns the stderr text, or `null`.
 */
export const briefNameRefusal = (readings: BriefNameReadings): string | null => {
  const misnamed = misnamedBriefs(readings);
  if (misnamed.length === 0) return null;
  const lines = ['plot brief-name gate: a brief is named by the rule, and this name is not the one it computes.'];
  for (const { path, want, tracked, wantExists } of misnamed) {
    const stem = path.slice(BRIEFS_DIR.length + 1, -'.md'.length);
    lines.push('', `  ${path}`);
    lines.push(`    The branch prefix is dropped, not flattened: this brief belongs at ${want}`);
    lines.push(`    Rename it:  ${tracked ? 'git mv' : 'mv'} ${path} ${want}`);
    if (wantExists) lines.push(`    ${want} already exists — compare the two before replacing it.`);
    lines.push(`    If it is the brief for a branch whose last segment is ${stem}, name that branch in the brief.`);
  }
  lines.push(
    '',
    "Every reader — briefPath and plot-dispatch.sh's brief_path() — takes the branch",
    "name after its last '/'. A brief under any other name is present and unread, and the",
    'registry holds its slice on no-brief until somebody renames it.',
  );
  return lines.join('\n');
};
