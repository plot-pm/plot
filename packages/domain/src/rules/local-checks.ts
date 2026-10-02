/**
 * The checks a branch's change needs before it is pushed.
 *
 * A project declares checks per path glob in the `Local checks` config key.
 * This rule reads the branch's changed paths against them and answers the
 * commands to run, the paths too widely referenced to select by name, and the
 * paths no check reaches. CI runs every suite on every pull request, so a path
 * this rule leaves out is tested there.
 */

/** One `glob = command` pair from `Local checks`. */
export interface LocalCheck {
  /** The path glob: `*` within one segment, `**` across segments, `?` one character. */
  readonly glob: string;
  /** The command; `{tests}` and `{changed}` are replaced by the selected paths. */
  readonly command: string;
}

/** What the caller read about the branch. */
export interface LocalChecksReadings {
  /** Every path the branch changes, committed or not, relative to the repository root. */
  readonly changed: readonly string[];
  /** The changed paths the repository marks as generated (`-merge`); they select nothing. */
  readonly generated: readonly string[];
  /** For each changed path, the test files that name it (see {@link searchTerms}). */
  readonly references: ReadonlyMap<string, readonly string[]>;
  /** The declared checks, in declaration order. */
  readonly checks: readonly LocalCheck[];
  /** The most test files one path may select before it is reported instead. */
  readonly limit: number;
  /**
   * The repository root. When given, `{tests}` and `{changed}` are filled with
   * absolute paths, so a command that changes directory, such as
   * `pnpm --filter <package> exec`, still finds them; `vitest related` given a
   * path relative to another directory finds no test and exits 0.
   */
  readonly root?: string;
}

/** A path named by more test files than the limit. */
export interface OverLimit {
  readonly path: string;
  readonly count: number;
}

/** The answer. */
export interface LocalChecksAnswer {
  /** The commands to run, in declaration order, each once. */
  readonly commands: readonly string[];
  /** The test files the commands select, sorted. */
  readonly tests: readonly string[];
  /** Paths whose test files CI runs instead, because there are too many. */
  readonly overLimit: readonly OverLimit[];
  /** Paths no check reaches, so CI alone tests them. */
  readonly untested: readonly string[];
}

/** The default for `Local checks limit`. */
export const DEFAULT_LOCAL_CHECKS_LIMIT = 20;

const TESTS = '{tests}';
const CHANGED = '{changed}';

/**
 * Reads the `Local checks` value.
 *
 * Pairs are separated by `;` and each is `glob = command`. A pair without `=`,
 * or with an empty side, is skipped.
 *
 * @param value - the config value.
 * @returns the checks, in order.
 */
export const parseLocalChecks = (value: string): LocalCheck[] =>
  value
    .split(';')
    .map((pair) => {
      const at = pair.indexOf('=');
      if (at < 0) return null;
      const glob = pair.slice(0, at).trim();
      const command = pair.slice(at + 1).trim();
      return glob && command ? { glob, command } : null;
    })
    .filter((check): check is LocalCheck => check !== null);

/**
 * Reads a `;`-separated list, such as `CI suites`.
 *
 * @param value - the config value.
 * @returns the non-empty entries, trimmed.
 */
export const parseList = (value: string): string[] =>
  value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

/**
 * Turns a path glob into a regular expression over a whole path.
 *
 * @param glob - `*` matches within one segment, `**` across segments, `?` one character.
 * @returns the expression.
 */
export const globToRegExp = (glob: string): RegExp => {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
};

/**
 * The words a test file uses to name a path: its basename, and for a
 * TypeScript source its `.js` form, which is how an import names it.
 *
 * @param path - a changed path.
 * @returns the search terms, without duplicates.
 */
export const searchTerms = (path: string): string[] => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const terms = [base];
  const ts = /^(.*)\.(?:ts|tsx|mts)$/.exec(base);
  if (ts) terms.push(`${ts[1]}.js`);
  return terms;
};

const fill = (command: string, placeholder: string, paths: readonly string[], root: string): string =>
  command.split(placeholder).join(paths.map((p) => (root ? `${root.replace(/\/+$/, '')}/${p}` : p)).join(' '));

/**
 * Decides the checks for one branch.
 *
 * - A check whose command holds `{tests}` runs the test files under its glob
 *   that name a changed path, plus changed test files under its glob.
 * - A check whose command holds `{changed}` runs on the changed paths under its glob.
 * - A check with neither runs once when any changed path matches its glob.
 * - A generated path selects nothing and is not reported.
 * - A path named by more test files than `limit` selects none of them and is
 *   reported in `overLimit`.
 * - A path no check reaches is reported in `untested`.
 *
 * @param readings - what the caller read.
 * @returns the commands and the report.
 */
export const localChecks = (readings: LocalChecksReadings): LocalChecksAnswer => {
  const generated = new Set(readings.generated);
  const changed = [...new Set(readings.changed)].filter((path) => !generated.has(path)).sort();
  const checks = readings.checks.map((check) => ({ ...check, pattern: globToRegExp(check.glob) }));

  const overLimit: OverLimit[] = [];
  const named = new Map<string, readonly string[]>();
  for (const path of changed) {
    const refs = [...new Set(readings.references.get(path) ?? [])];
    if (refs.length > readings.limit) overLimit.push({ path, count: refs.length });
    else named.set(path, refs);
  }

  const commands: string[] = [];
  const tests = new Set<string>();
  const reached = new Set<string>();

  for (const check of checks) {
    if (check.command.includes(TESTS)) {
      const selected = new Set<string>();
      for (const path of changed) {
        if (check.pattern.test(path)) {
          selected.add(path);
          reached.add(path);
        }
        for (const test of named.get(path) ?? []) {
          if (check.pattern.test(test)) {
            selected.add(test);
            reached.add(path);
          }
        }
      }
      if (selected.size > 0) {
        const sorted = [...selected].sort();
        sorted.forEach((test) => tests.add(test));
        commands.push(fill(check.command, TESTS, sorted, readings.root ?? ''));
      }
    } else if (check.command.includes(CHANGED)) {
      const selected = changed.filter((path) => check.pattern.test(path));
      selected.forEach((path) => reached.add(path));
      if (selected.length > 0) commands.push(fill(check.command, CHANGED, selected, readings.root ?? ''));
    } else {
      const matched = changed.filter((path) => check.pattern.test(path));
      matched.forEach((path) => reached.add(path));
      if (matched.length > 0) commands.push(check.command);
    }
  }

  const over = new Set(overLimit.map((entry) => entry.path));
  return {
    commands: [...new Set(commands)],
    tests: [...tests].sort(),
    overLimit,
    untested: changed.filter((path) => !reached.has(path) && !over.has(path)),
  };
};
