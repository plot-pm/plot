/**
 * The checks a branch's change needs before it is pushed.
 *
 * A project declares checks per path glob in the `Local checks` config key.
 * This rule reads the branch's changed paths against them and answers the
 * commands to run, the paths too widely referenced to select by name, and the
 * paths no check reaches. {@link ciSelection} answers the same question for a
 * CI job: every selected test without a limit, the checks that run on every
 * change, and whether the change runs the corpus tier.
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

/**
 * One path as a shell word: as written where it holds only characters the
 * shell takes literally, single-quoted otherwise. The loop runs each command
 * through `bash -c`, so a path with a space or a quote stays one argument.
 *
 * @param path - the path.
 * @returns the shell word.
 */
export const shellWord = (path: string): string =>
  /^[A-Za-z0-9_/.@%+=:,-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;

const fill = (command: string, placeholder: string, paths: readonly string[], root: string): string =>
  command
    .split(placeholder)
    .join(paths.map((p) => shellWord(root ? `${root.replace(/\/+$/, '')}/${p}` : p)).join(' '));


/** One test file and its text, as the caller read it. */
export interface TestFile {
  /** The path, relative to the repository root. */
  readonly path: string;
  /** The file's content. */
  readonly text: string;
}

/** A check the change selects, with the suite it belongs to. */
export interface SelectedCheck {
  /** The suite: the directory the check's glob is rooted at (see {@link globRoot}). */
  readonly suite: string;
  /** The command, with its placeholder filled. */
  readonly command: string;
  /** The test files the command runs, sorted; empty for a check with no `{tests}` or `{changed}`. */
  readonly tests: readonly string[];
  /** True when the check runs on every change, whatever the change touches. */
  readonly always: boolean;
}

/** What {@link ciSelection} reads. */
export interface SelectionReadings {
  /** Every path the change touches, relative to the repository root. */
  readonly changed: readonly string[];
  /** The changed paths the repository marks as generated (`-merge`); they select nothing. */
  readonly generated: readonly string[];
  /** The declared checks, in declaration order. */
  readonly checks: readonly LocalCheck[];
  /** The test files that may name a changed path (see {@link candidateTests}), with their text. */
  readonly tests: readonly TestFile[];
  /** Path globs whose change runs the corpus tier (see {@link corpusGlobs}). */
  readonly corpus: readonly string[];
  /** The repository root; when given, placeholders are filled with absolute paths. */
  readonly root?: string;
}

/** The answer a CI job reads. */
export interface Selection {
  /** The selected suite names, sorted, each once; {@link CORPUS_SUITE} when `corpus` is true. */
  readonly suites: readonly string[];
  /** The selected checks, in declaration order; the `always` checks are among them. */
  readonly checks: readonly SelectedCheck[];
  /** Every test file a selected check runs, sorted. */
  readonly tests: readonly string[];
  /** True when a changed path is plan data: a plan, a sprint, or a file under `.plot/`. */
  readonly corpus: boolean;
  /** Changed paths that no path-selected check and no corpus glob reaches. */
  readonly untested: readonly string[];
}

/** The suite name {@link ciSelection} gives the corpus tier. */
export const CORPUS_SUITE = 'corpus';

/** A source vitest's import graph follows; a test reaching any other file names it by path. */
const IMPORTED = /\.(?:ts|tsx|mts|cts)$/;

/**
 * Whether a path's name marks it as a test file.
 *
 * @param path - a path.
 * @returns true for `*.test.*` and `*.spec.*` JavaScript and TypeScript files.
 */
export const isTestFile = (path: string): boolean => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);

/**
 * The directory a glob's literal prefix names: the segments before the first
 * one holding `*` or `?`, without the last segment.
 *
 * @param glob - a path glob.
 * @returns the directory, or `.` when the glob starts at the repository root.
 */
export const globRoot = (glob: string): string => {
  const fixed: string[] = [];
  for (const segment of glob.split('/').slice(0, -1)) {
    if (/[*?]/.test(segment)) break;
    fixed.push(segment);
  }
  return fixed.length > 0 ? fixed.join('/') : '.';
};

/**
 * The paths whose text the derivation reads: a path under the glob of a
 * `{tests}` check, or a test file under the glob of a `{changed}` check.
 *
 * @param paths - candidate paths, such as the tracked files under each check's {@link globRoot}.
 * @param checks - the declared checks.
 * @returns the paths, sorted, each once.
 */
export const candidateTests = (paths: readonly string[], checks: readonly LocalCheck[]): string[] => {
  const byTests = checks.filter((c) => c.command.includes(TESTS)).map((c) => globToRegExp(c.glob));
  const byChanged = checks
    .filter((c) => !c.command.includes(TESTS) && c.command.includes(CHANGED))
    .map((c) => globToRegExp(c.glob));
  return [...new Set(paths)]
    .filter((p) => byTests.some((re) => re.test(p)) || (isTestFile(p) && byChanged.some((re) => re.test(p))))
    .sort();
};

/**
 * The test files that name each changed path, by any of its {@link searchTerms}.
 * A test reaches a script, a bundle or a document by naming it, so a new test
 * file is mapped as soon as it exists; nothing registers it.
 *
 * @param changed - the changed paths.
 * @param tests - the test files and their text.
 * @returns for each changed path, the paths of the test files naming it, sorted.
 */
export const testsNaming = (
  changed: readonly string[],
  tests: readonly TestFile[],
): Map<string, readonly string[]> =>
  new Map(
    changed.map((path) => {
      const terms = searchTerms(path);
      const naming = tests.filter((test) => terms.some((term) => test.text.includes(term))).map((test) => test.path);
      return [path, [...new Set(naming)].sort()] as const;
    }),
  );

/**
 * The globs whose change runs the corpus tier: the plan and sprint directories
 * and `.plot/`.
 *
 * @param planDir - the `Plan directory` value, such as `docs/plans/`.
 * @param sprintDir - the `Sprint directory` value, such as `docs/sprints/`.
 * @returns one `<dir>/**` glob per non-empty directory, then `.plot/**`.
 */
export const corpusGlobs = (planDir: string, sprintDir: string): string[] => [
  ...[planDir, sprintDir]
    .map((dir) => dir.trim().replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter((dir) => dir !== '')
    .map((dir) => `${dir}/**`),
  '.plot/**',
];

interface Policy {
  /** The most test files one path may select; more are reported in `overLimit`. */
  readonly limit: number;
  /** True: a check with no placeholder runs on every change and reaches no path. */
  readonly always: boolean;
}

interface Decided {
  readonly selected: readonly SelectedCheck[];
  readonly tests: readonly string[];
  readonly overLimit: readonly OverLimit[];
  readonly untested: readonly string[];
}

const decide = (readings: LocalChecksReadings, policy: Policy): Decided => {
  const generated = new Set(readings.generated);
  const changed = [...new Set(readings.changed)].filter((path) => !generated.has(path)).sort();
  const checks = readings.checks.map((check) => ({ ...check, pattern: globToRegExp(check.glob) }));
  const root = readings.root ?? '';

  const byTests = checks.filter((check) => check.command.includes(TESTS));
  const byChanged = checks.filter((check) => !check.command.includes(TESTS) && check.command.includes(CHANGED));
  const usable = (path: string, ref: string): boolean =>
    byTests.some((check) => check.pattern.test(ref)) ||
    (!IMPORTED.test(path) && isTestFile(ref) && byChanged.some((check) => check.pattern.test(ref)));

  const overLimit: OverLimit[] = [];
  const named = new Map<string, readonly string[]>();
  for (const path of changed) {
    const refs = [...new Set(readings.references.get(path) ?? [])].filter((ref) => usable(path, ref));
    if (refs.length > policy.limit) overLimit.push({ path, count: refs.length });
    else named.set(path, refs);
  }

  const selected: SelectedCheck[] = [];
  const tests = new Set<string>();
  const reached = new Set<string>();
  const add = (check: LocalCheck, command: string, run: readonly string[], always: boolean): void => {
    selected.push({ suite: globRoot(check.glob), command, tests: run, always });
  };

  for (const check of checks) {
    if (check.command.includes(TESTS)) {
      const chosen = new Set<string>();
      for (const path of changed) {
        if (check.pattern.test(path)) {
          chosen.add(path);
          reached.add(path);
        }
        for (const test of named.get(path) ?? []) {
          if (check.pattern.test(test)) {
            chosen.add(test);
            reached.add(path);
          }
        }
      }
      if (chosen.size > 0) {
        const sorted = [...chosen].sort();
        sorted.forEach((test) => tests.add(test));
        add(check, fill(check.command, TESTS, sorted, root), sorted, false);
      }
    } else if (check.command.includes(CHANGED)) {
      const chosen = new Set<string>();
      const naming = new Set<string>();
      for (const path of changed) {
        if (check.pattern.test(path)) {
          chosen.add(path);
          reached.add(path);
        }
        if (IMPORTED.test(path)) continue;
        for (const test of named.get(path) ?? []) {
          if (isTestFile(test) && check.pattern.test(test)) {
            chosen.add(test);
            naming.add(test);
            reached.add(path);
          }
        }
      }
      naming.forEach((test) => tests.add(test));
      if (chosen.size > 0) {
        add(check, fill(check.command, CHANGED, [...chosen].sort(), root), [...naming].sort(), false);
      }
    } else if (policy.always) {
      add(check, check.command, [], true);
    } else {
      const matched = changed.filter((path) => check.pattern.test(path));
      matched.forEach((path) => reached.add(path));
      if (matched.length > 0) add(check, check.command, [], false);
    }
  }

  const over = new Set(overLimit.map((entry) => entry.path));
  return {
    selected,
    tests: [...tests].sort(),
    overLimit,
    untested: changed.filter((path) => !reached.has(path) && !over.has(path)),
  };
};

/**
 * Decides the checks for one branch, before it is pushed.
 *
 * - A check whose command holds `{tests}` runs the test files under its glob
 *   that name a changed path, plus changed test files under its glob.
 * - A check whose command holds `{changed}` runs on the changed paths under its
 *   glob, plus the test files under its glob that name a changed path that is
 *   not a TypeScript source: the import graph `vitest related` follows does not
 *   reach a script, a bundle or a document a test names by path.
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
  const decided = decide(readings, { limit: readings.limit, always: false });
  return {
    commands: [...new Set(decided.selected.map((check) => check.command))],
    tests: decided.tests,
    overLimit: decided.overLimit,
    untested: decided.untested,
  };
};

/**
 * Decides the checks for one pull request in CI, by the rules of
 * {@link localChecks} with three differences:
 *
 * - No limit: every test file naming a changed path is selected.
 * - A check with no placeholder, such as a typecheck or the gate scripts, runs
 *   on every change and reaches no path.
 * - A changed path under a {@link corpusGlobs} glob sets `corpus` and adds
 *   {@link CORPUS_SUITE} to `suites`, because plan data alone can fail the
 *   corpus tier.
 *
 * The references are derived here from the test files' text by
 * {@link testsNaming}, so CI and the local run read one map.
 *
 * @param readings - what the caller read.
 * @returns the suites, the checks and the report.
 */
export const ciSelection = (readings: SelectionReadings): Selection => {
  const generated = new Set(readings.generated);
  const changed = [...new Set(readings.changed)].filter((path) => !generated.has(path)).sort();
  const decided = decide(
    {
      changed,
      generated: [],
      references: testsNaming(changed, readings.tests),
      checks: readings.checks,
      limit: Number.POSITIVE_INFINITY,
      root: readings.root,
    },
    { limit: Number.POSITIVE_INFINITY, always: true },
  );
  const patterns = readings.corpus.map(globToRegExp);
  const data = new Set(changed.filter((path) => patterns.some((pattern) => pattern.test(path))));
  const corpus = data.size > 0;
  return {
    suites: [...new Set([...decided.selected.map((check) => check.suite), ...(corpus ? [CORPUS_SUITE] : [])])].sort(),
    checks: decided.selected,
    tests: decided.tests,
    corpus,
    untested: decided.untested.filter((path) => !data.has(path)),
  };
};
