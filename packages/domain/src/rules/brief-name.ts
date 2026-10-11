import type { StagedPath } from '../ports/refs.js';

/** Where hand-off briefs live, relative to the repository root. */
const BRIEFS_DIR = '.plot/briefs';

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
 * A brief lives at `.plot/briefs/<slug>.md`, the slug being the branch name
 * after its last `/` (`packages/fleet/src/shared/brief-path.ts`). A path is
 * misnamed when it is a direct child of the briefs directory, ends in `.md`,
 * and its stem is `<prefix>-<rest>` with at least one character in `<rest>`.
 * The dash is required: `bugfix-x.md` and `feature.md` pass for prefix `bug`
 * and `feature`.
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
 * Deliberately crude: the command splits on `&&`, `;` and `|`, and each
 * segment is matched by substring for `git add` or `git mv`. It is not a
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
  for (const segment of command.split(/&&|;|\|/)) {
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
 * The refusal text for a commit that lands misnamed briefs, or `null` when it
 * lands none.
 *
 * @param misnamed - every misnamed brief the commit adds or renames to.
 * @returns the stderr text, or `null`.
 */
export const briefNameRefusal = (misnamed: readonly MisnamedBrief[]): string | null => {
  if (misnamed.length === 0) return null;
  const lines = ['plot brief-name gate: a brief is named by the rule, and this name is not the one it computes.'];
  for (const { path, want, tracked, wantExists } of misnamed) {
    lines.push('', `  ${path}`);
    lines.push(`    The branch prefix is dropped, not flattened: this brief belongs at ${want}`);
    lines.push(`    Rename it:  ${tracked ? 'git mv' : 'mv'} ${path} ${want}`);
    if (wantExists) lines.push(`    ${want} already exists — compare the two before replacing it.`);
  }
  lines.push(
    '',
    "Every reader — brief-path.ts and plot-dispatch.sh's brief_path() — takes the branch",
    "name after its last '/'. A brief under any other name is present and unread, and the",
    'registry holds its slice on no-brief until somebody renames it.',
  );
  return lines.join('\n');
};
