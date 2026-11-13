/** The whitespace `[[:space:]]` matches in the shell, spelled out so no Unicode space joins it. */
const SPACE = '[ \\t\\n\\v\\f\\r]';

/** Escapes a variable name for a regular expression. */
const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Reads one variable from `.env`-shaped text.
 *
 * A declared duplicate of `read_env_var` in `plot-host.sh`, held to it by
 * `corpus/env-file.corpus.test.ts`. The first line of the form
 * `[whitespace][export whitespace]NAME=value` supplies the value, so a
 * duplicated name resolves as a shell reading top to bottom would. The value
 * loses trailing whitespace, then one pair of matching double or single quotes
 * around the whole value, then trailing whitespace again: on `T="tok"   ` the
 * quotes would stay if they went first. Nothing else is interpreted: no
 * escapes, no `#` comment, no variable expansion.
 *
 * @param text - the file's contents.
 * @param name - the variable name.
 * @returns the value, or the empty string where no line assigns it.
 */
export const readEnvVar = (text: string, name: string): string => {
  const prefix = new RegExp(`^${SPACE}*(?:export${SPACE}+)?${escaped(name)}=`);
  for (const line of text.split('\n')) {
    if (!prefix.test(line)) continue;
    return line
      .replace(prefix, '')
      .replace(new RegExp(`${SPACE}+$`), '')
      .replace(/^"([^]*)"$/, '$1')
      .replace(/^'([^]*)'$/, '$1')
      .replace(new RegExp(`${SPACE}+$`), '');
  }
  return '';
};

/** One `.env` location the credential read may use. */
export interface EnvFileCandidate {
  /** The file's path. */
  readonly path: string;
  /** Which of the two locations it is. */
  readonly source: 'worktree' | 'main-checkout';
}

/** A candidate with its contents, null where the file is unreadable. */
export interface EnvFileRead {
  /** The location read. */
  readonly candidate: EnvFileCandidate;
  /** The file's text, or null where it cannot be read. */
  readonly text: string | null;
}

/** The `.env` that holds both named variables. */
export interface EnvFilePick {
  /** The file's path. */
  readonly path: string;
  /** Which location it is. */
  readonly source: EnvFileCandidate['source'];
  /** The two values, in the order the names were given. */
  readonly values: readonly [string, string];
}

/** The directory part of a non-empty path, as `dirname` prints it. */
const dirnameOf = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '') return '/';
  const cut = trimmed.lastIndexOf('/');
  if (cut < 0) return '.';
  const head = trimmed.slice(0, cut).replace(/\/+$/, '');
  return head === '' ? '/' : head;
};

/**
 * The `.env` locations for a checkout, in the order the read tries them.
 *
 * Follows `plot_env_file` in `plot-host.sh`: the worktree's own `.env` first,
 * then the main checkout's, which is the parent of the common git directory.
 * `.env` is untracked, so a fleet desk or scratch worktree has none of its own.
 * There is no walk upward from either location. A top level the caller could
 * not name reads as `.`, and an absent common directory leaves the main
 * checkout out.
 *
 * @param top - the checkout's top level, or null where unknown.
 * @param commonDir - the common git directory, or null or empty where unknown.
 * @returns one or two candidates.
 */
export const envFileCandidates = (top: string | null, commonDir: string | null): readonly EnvFileCandidate[] => {
  const root = top === null || top === '' ? '.' : top;
  const worktree: EnvFileCandidate = { path: `${root}/.env`, source: 'worktree' };
  if (commonDir === null || commonDir === '') return [worktree];
  return [worktree, { path: `${dirnameOf(commonDir)}/.env`, source: 'main-checkout' }];
};

/**
 * Picks the first `.env` that holds both named variables.
 *
 * A declared duplicate of `plot_env_file` in `plot-host.sh`, held to it by
 * `corpus/env-file.corpus.test.ts`. A readable file that holds one name and
 * not the other is skipped in favour of the next location: a caller needs the
 * pair, never half of it. A variable that is present and empty counts as
 * absent.
 *
 * @param reads - the candidates in order, each with its text.
 * @param names - the two variable names.
 * @returns the first file holding both, or null.
 */
export const pickEnvFile = (
  reads: readonly EnvFileRead[],
  names: readonly [string, string],
): EnvFilePick | null => {
  for (const { candidate, text } of reads) {
    if (text === null) continue;
    const first = readEnvVar(text, names[0]);
    const second = readEnvVar(text, names[1]);
    if (first !== '' && second !== '') return { path: candidate.path, source: candidate.source, values: [first, second] };
  }
  return null;
};
