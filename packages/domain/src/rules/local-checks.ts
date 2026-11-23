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

import { syncPathSet, syncPathVerdict, type SyncPathKeys } from './state-sync.js';

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
  /**
   * For each changed path, the test files that name it (see {@link searchTerms}).
   * A path under a `corpus` glob reads no entry here.
   */
  readonly references: ReadonlyMap<string, readonly string[]>;
  /** Path globs whose paths are plan data (see {@link corpusGlobs}); absent reads as none. */
  readonly corpus?: readonly string[];
  /** The test files the caller read, with their text, for {@link estateReaders}; absent reads as none. */
  readonly tests?: readonly TestFile[];
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
  /** The test files {@link estateReaders} selects, sorted; the limit does not apply to them. */
  readonly estateTests: readonly string[];
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
  /**
   * The corpus tier's files with their text: its test files and the modules
   * they share. A changed path one of them names selects the tier.
   */
  readonly corpusFiles: readonly TestFile[];
  /** The config values that name the paths Plot writes as plan data (see {@link syncPathSet}). */
  readonly sync: SyncPathKeys;
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
  /**
   * True when the whole corpus tier runs: a changed path is plan data (a plan,
   * a sprint, or a file under `.plot/`), is a corpus file that is not a test,
   * or is named by one.
   */
  readonly corpus: boolean;
  /**
   * The corpus test files that changed or name a changed path, sorted. When
   * `corpus` is false and this is not empty, these alone run.
   */
  readonly corpusTests: readonly string[];
  /** Changed paths that no path-selected check and no corpus glob reaches. */
  readonly untested: readonly string[];
  /**
   * The test files {@link estateReaders} selects for the changed plan data,
   * sorted. No check in `checks` runs them; the CI job reads this field.
   */
  readonly estateTests: readonly string[];
  /**
   * True when at least one changed path is not generated and every such path
   * lies in {@link syncPathSet}. A `.plot/panels/` path is plan data for
   * `corpus` and is not in the set, so it answers false here.
   */
  readonly planDataOnly: boolean;
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

/** The marker a test file holds for each directory of plan data it reads. */
const PLOT_READS = /^[ \t]*\/\/[ \t]*plot-reads:[ \t]*(\S+)[ \t]*$/gm;

const markedDir = (dir: string): string => dir.trim().replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * The directories a test file declares it reads, one `// plot-reads: <dir>`
 * line each.
 *
 * @param text - the test file's content.
 * @returns the directories, without `./` or a trailing `/`, each once.
 */
export const plotReads = (text: string): string[] => [
  ...new Set([...text.matchAll(PLOT_READS)].map((match) => markedDir(match[1] as string)).filter((dir) => dir !== '')),
];

/**
 * The test files that declare they read the plan data a changed path belongs
 * to. A changed path under a `<dir>/**` glob selects every test file holding
 * the line `// plot-reads: <dir>`; a marker for another directory selects
 * nothing for it.
 *
 * @param changed - the changed paths.
 * @param corpus - the plan-data globs, as {@link corpusGlobs} answers them.
 * @param tests - the test files and their text.
 * @returns for each changed path under a glob, the marked test files, sorted;
 *   a path under no glob has no entry.
 */
export const estateReaders = (
  changed: readonly string[],
  corpus: readonly string[],
  tests: readonly TestFile[],
): Map<string, readonly string[]> => {
  const dirs = corpus
    .filter((glob) => glob.endsWith('/**'))
    .map((glob) => ({ dir: markedDir(glob.slice(0, -3)), pattern: globToRegExp(glob) }));
  const marks = tests.map((test) => ({ path: test.path, dirs: new Set(plotReads(test.text)) }));
  const answer = new Map<string, readonly string[]>();
  for (const path of new Set(changed)) {
    const under = dirs.filter((entry) => entry.pattern.test(path)).map((entry) => entry.dir);
    if (under.length === 0) continue;
    const readers = marks.filter((mark) => under.some((dir) => mark.dirs.has(dir))).map((mark) => mark.path);
    answer.set(path, [...new Set(readers)].sort());
  }
  return answer;
};

const allOf = (map: ReadonlyMap<string, readonly string[]>): string[] => [...new Set([...map.values()].flat())].sort();

const decide = (readings: LocalChecksReadings, policy: Policy, declared: ReadonlyMap<string, readonly string[]> = new Map()): Decided => {
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
    const readers = (declared.get(path) ?? []).filter((ref) => usable(path, ref));
    if (refs.length > policy.limit) {
      overLimit.push({ path, count: refs.length });
      named.set(path, readers);
    } else named.set(path, [...new Set([...refs, ...readers])]);
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
      for (const [path, refs] of named) {
        if (check.pattern.test(path)) {
          chosen.add(path);
          reached.add(path);
        }
        for (const test of refs) {
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
      for (const [path, refs] of named) {
        if (check.pattern.test(path)) {
          chosen.add(path);
          reached.add(path);
        }
        if (IMPORTED.test(path)) continue;
        for (const test of refs) {
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
 * - A path under a `corpus` glob selects no test file by its basename. It
 *   selects the test files {@link estateReaders} answers for it, which the
 *   checks run like named test files, whatever their number; they are listed
 *   in `estateTests`.
 * - A path no check reaches is reported in `untested`.
 *
 * @param readings - what the caller read.
 * @returns the commands and the report.
 */
export const localChecks = (readings: LocalChecksReadings): LocalChecksAnswer => {
  const patterns = (readings.corpus ?? []).map(globToRegExp);
  const references = new Map([...readings.references].filter(([path]) => !patterns.some((pattern) => pattern.test(path))));
  const generated = new Set(readings.generated);
  const declared = estateReaders(
    readings.changed.filter((path) => !generated.has(path)),
    readings.corpus ?? [],
    readings.tests ?? [],
  );
  const decided = decide({ ...readings, references }, { limit: readings.limit, always: false }, declared);
  return {
    commands: [...new Set(decided.selected.map((check) => check.command))],
    tests: decided.tests,
    overLimit: decided.overLimit,
    untested: decided.untested,
    estateTests: allOf(declared),
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
 *   corpus tier. Plan data selects no other check: a test naming a plan
 *   file's basename, such as `panel.md`, names its own fixture. The test
 *   files {@link estateReaders} answers for it go into `estateTests`.
 * - A changed corpus file, or a changed path a corpus file names by one of
 *   its {@link searchTerms}, adds {@link CORPUS_SUITE}: a corpus test file
 *   goes into `corpusTests`, and a shared corpus module sets `corpus`.
 * - `planDataOnly` answers whether every changed path that is not generated
 *   lies in {@link syncPathSet} over `readings.sync`. An empty change, or one
 *   of generated paths only, answers false. A `main` push run maps as a pull
 *   request only where this is true.
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
  const patterns = readings.corpus.map(globToRegExp);
  const data = new Set(changed.filter((path) => patterns.some((pattern) => pattern.test(path))));
  const code = changed.filter((path) => !data.has(path));
  const decided = decide(
    {
      changed: code,
      generated: [],
      references: testsNaming(code, readings.tests),
      checks: readings.checks,
      limit: Number.POSITIVE_INFINITY,
      root: readings.root,
    },
    { limit: Number.POSITIVE_INFINITY, always: true },
  );
  const tier = corpusReach(code, readings.corpusFiles);
  const corpus = data.size > 0 || tier.whole;
  const reached = new Set(tier.reached);
  const runsCorpus = corpus || tier.tests.length > 0;
  return {
    suites: [
      ...new Set([...decided.selected.map((check) => check.suite), ...(runsCorpus ? [CORPUS_SUITE] : [])]),
    ].sort(),
    checks: decided.selected,
    tests: decided.tests,
    corpus,
    corpusTests: tier.tests,
    untested: decided.untested.filter((path) => !reached.has(path)),
    estateTests: allOf(estateReaders(changed, readings.corpus, readings.tests)),
    planDataOnly: changed.length > 0 && syncPathVerdict(changed, syncPathSet(readings.sync)).ok,
  };
};

interface CorpusReach {
  /** True when a corpus file that is not a test changed or names a changed path. */
  readonly whole: boolean;
  /** The corpus test files that changed or name a changed path, sorted. */
  readonly tests: readonly string[];
  /** The changed paths the corpus tier reaches. */
  readonly reached: readonly string[];
}

const corpusReach = (changed: readonly string[], files: readonly TestFile[]): CorpusReach => {
  const own = new Set(files.map((file) => file.path));
  const naming = testsNaming(changed, files);
  const hits = new Set<string>();
  const reached: string[] = [];
  for (const [path, named] of naming) {
    const by = [...(own.has(path) ? [path] : []), ...named];
    if (by.length === 0) continue;
    reached.push(path);
    by.forEach((file) => hits.add(file));
  }
  const all = [...hits];
  return {
    whole: all.some((file) => !isTestFile(file)),
    tests: all.filter(isTestFile).sort(),
    reached,
  };
};
