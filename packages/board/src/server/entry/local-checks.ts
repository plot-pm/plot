// THROUGH THE NARROW PATHS, not the package roots, so the bundle carries the
// two adapters and the one rule it uses.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { boundedRunProcess } from '@plot-pm/domain/adapters/bounded-run/bounded-run-process';
import { processesShell } from '@plot-pm/domain/adapters/processes/processes-shell';
import { manifestBaseOf } from '@plot-pm/domain/adapters/agents/agents-fs';
import {
  baseCandidateBranches,
  baseLine,
  baseRefusal,
  localChecksBase,
  type BaseCandidate,
  type LocalChecksBase,
  type LocalChecksBaseRefusal,
} from '@plot-pm/domain/rules/local-checks-base';
import { failedCheck, printedCommands } from '@plot-pm/domain/rules/local-checks-run';
import {
  DEFAULT_LOCAL_CHECKS_LIMIT,
  candidateTests,
  ciSelection,
  corpusGlobs,
  globRoot,
  globToRegExp,
  localChecks,
  parseList,
  parseLocalChecks,
  testsNaming,
  type LocalChecksAnswer,
  type TestFile,
} from '@plot-pm/domain/rules/local-checks';
import { ciSuiteRefusal } from '@plot-pm/domain/rules/ci-suite';
import { pushSelectionBase } from '@plot-pm/domain/rules/push-selection-base';
import { DEFAULT_RELEASE_DIR } from '@plot-pm/domain/rules/state-sync';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The checks a branch's change needs — `localChecks` reached without HTTP, for
 * an agent before it pushes.
 *
 * ```
 * node <plot scripts>/board/plot-local-checks.mjs
 * node --test test/reconcile/reap.test.mjs
 * pnpm --filter @plot-pm/domain exec tsc --noEmit
 * # CI runs these: skills/plot/scripts/plot-dispatch.sh is named by 69 test files
 * # untested here, CI runs it: docs/plans/x.md
 * # CI suites: pnpm run test:contracts; pnpm run test:board
 * summary: commands=2 tests=1 over_limit=1 untested=1
 * ```
 *
 * It runs in the current directory's repository and reads the branch's changes
 * against the default branch plus the working tree, the `Local checks`,
 * `Local checks limit` and `CI suites` config keys, and the `-merge` attribute
 * for each changed path. One command goes out per line, then the report as
 * `#` lines, then a `summary:` line. Exit 0 always; 2 outside a git repository.
 *
 * The changes are read against the branch's base, which `localChecksBase`
 * chooses: the `--base` argument, as `<branch>` or `origin/<branch>` where
 * `origin` holds the branch, else as the commit it resolves to, and exit 2
 * naming the accepted forms where it resolves to none; else the `base` the desk manifest
 * records, where `origin` holds it; else whichever of `origin/<default>` and
 * every `origin/sprint/*` HEAD sits the fewest commits past, a tie going to
 * the default branch. The first output line names the base and the reason.
 * No host is asked.
 *
 * `--run` runs each printed command through `bash -c`, in order, and stops at
 * the first failure: it prints the command and the last 80 lines of its output
 * and exits 1. A pass exits 0.
 *
 * `--files <path>` reads the changed paths from that file, one per line, instead
 * of the branch and the working tree.
 *
 * `--ci` prints the `ciSelection` answer as one line of JSON instead, for a CI
 * job to write as its outputs: `suites`, `checks` (each `suite`, `command`,
 * `tests`, `always`), `tests`, `corpus`, `untested` and `estateTests`. It reads the
 * `Plan directory` and `Sprint directory` keys for the corpus globs, and
 * those two with `Active index` and `Delivered index` for `planDataOnly`. It
 * combines with `--files`.
 *
 * `--corpus <glob>`, with `--ci`, names the corpus tier's files, such as
 * `packages/domain/corpus/**`. A changed path one of them names selects the
 * tier. Without it, only plan data selects the tier. Any other argument exits 2.
 *
 * `--push-base <green.json> <first-parent.txt>` asks `pushSelectionBase` and
 * prints `base=<sha>` or `every=<reason>`. `green.json` holds the Actions API
 * answer for the newest successful `CI` push run on `main`
 * (`{"workflow_runs":[{"head_sha":…}]}`); a missing or unparseable file reads
 * as a failed call, and an empty `workflow_runs` as no green run.
 * `first-parent.txt` holds `git rev-list --first-parent -n 50 HEAD`, one SHA
 * per line; an unreadable file reads as an empty line. It reads no repository
 * and exits 0.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The answer was written. */
  ok: 0,
  /** The current directory is not inside a git repository. */
  notRepository: 2,
  /** `--ci-suite-refusal`: the command runs a suite only CI runs. */
  refused: 3,
  /** `--run`: a printed command failed. */
  failed: 1,
  /** An argument this command does not know, or `--files` without a readable path. */
  usage: 2,
} as const;

/**
 * Renders the answer.
 *
 * @param answer - what `localChecks` answered.
 * @param ciSuites - the `CI suites` entries.
 * @returns the lines to print.
 */
export const render = (answer: LocalChecksAnswer, ciSuites: readonly string[]): string => {
  const lines = [...answer.commands];
  for (const entry of answer.overLimit) {
    lines.push(`# CI runs these: ${entry.path} is named by ${entry.count} test files`);
  }
  for (const entry of answer.untested) lines.push(`# untested here, CI runs it: ${entry}`);
  if (ciSuites.length > 0) lines.push(`# CI suites: ${ciSuites.join('; ')}`);
  lines.push(
    `summary: commands=${answer.commands.length} tests=${answer.tests.length} over_limit=${answer.overLimit.length} untested=${answer.untested.length}`,
  );
  return `${lines.join('\n')}\n`;
};

/**
 * Reads the text of each file the rule may map a changed path to: the tracked
 * files at `HEAD` under each placeholder check's glob root, plus the changed
 * paths, as {@link candidateTests} keeps them. A file that cannot be read,
 * such as a deleted one, is left out.
 *
 * @param refs - the git adapter.
 * @param repoRoot - the repository root.
 * @param checks - the declared checks.
 * @param changed - the changed paths.
 * @returns the test files with their text.
 */
const readTests = async (
  refs: ReturnType<typeof refsGit>,
  repoRoot: string,
  checks: ReturnType<typeof parseLocalChecks>,
  changed: readonly string[],
): Promise<TestFile[]> => {
  const roots = [
    ...new Set(
      checks
        .filter((check) => check.command.includes('{tests}') || check.command.includes('{changed}'))
        .map((check) => globRoot(check.glob)),
    ),
  ];
  const listed = await Promise.all((roots.includes('.') ? ['.'] : roots).map((root) => refs.listBlobs('HEAD', root)));
  const paths = [...listed.flatMap((blobs) => (blobs.ok ? blobs.value.map((blob) => blob.path) : [])), ...changed];
  return candidateTests(paths, checks).flatMap((file) => {
    try {
      return [{ path: file, text: readFileSync(path.join(repoRoot, file), 'utf8') }];
    } catch {
      return [];
    }
  });
};

/**
 * Reads the text of the corpus tier's files: the tracked files at `HEAD` under
 * the glob, plus the changed paths under it. A file that cannot be read is
 * left out.
 *
 * @param refs - the git adapter.
 * @param repoRoot - the repository root.
 * @param glob - the corpus glob.
 * @param changed - the changed paths.
 * @returns the corpus files with their text.
 */
const readCorpus = async (
  refs: ReturnType<typeof refsGit>,
  repoRoot: string,
  glob: string,
  changed: readonly string[],
): Promise<TestFile[]> => {
  const pattern = globToRegExp(glob);
  const blobs = await refs.listBlobs('HEAD', globRoot(glob));
  const paths = [...(blobs.ok ? blobs.value.map((blob) => blob.path) : []), ...changed];
  return [...new Set(paths)]
    .filter((file) => pattern.test(file))
    .sort()
    .flatMap((file) => {
      try {
        return [{ path: file, text: readFileSync(path.join(repoRoot, file), 'utf8') }];
      } catch {
        return [];
      }
    });
};

/**
 * Reads the branch and the config, asks the rule, and prints the answer.
 *
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where the answer goes.
 * @param warn - where an error goes.
 * @param filesFrom - a file listing the changed paths, one per line; when given,
 *   it replaces the branch and working-tree reading.
 * @param ci - true prints the CI selection as JSON instead of the commands.
 * @param corpusGlob - with `ci`, the glob naming the corpus tier's files.
 * @param base - the `--base` branch, or `null` to resolve it from the branch's plan.
 * @param runChecks - true runs the printed commands and stops at the first failure.
 * @returns the process exit code.
 */
export const run = async (
  cwd: string,
  scriptDir: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
  filesFrom: string | null = null,
  ci = false,
  corpusGlob: string | null = null,
  base: string | null = null,
  runChecks = false,
): Promise<number> => {
  let listed: string[] | null = null;
  if (filesFrom !== null) {
    try {
      listed = readFileSync(filesFrom, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    } catch {
      warn(`plot-local-checks: cannot read the file list ${filesFrom}\n`);
      return EXIT.usage;
    }
  }
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn('plot-local-checks: not inside a git repository\n');
    return EXIT.notRepository;
  }
  let repoRoot = probe.value;
  try {
    repoRoot = realpathSync(probe.value);
  } catch {
    /* the root may be gone mid-run; fill still has a value to join against */
  }
  const context = { repoRoot, scriptDir };
  const refs = refsGit(context);
  const scripts = scriptsShell(context);

  const resolved = listed === null ? await resolveBase(refs, context, base) : null;
  if (resolved !== null && 'refused' in resolved.base) {
    warn(baseRefusal(resolved.base.refused));
    return EXIT.usage;
  }
  const chosen = resolved === null || 'refused' in resolved.base ? null : { base: resolved.base, candidates: resolved.candidates };
  const against = chosen?.base.base;

  const [committed, working, rawChecks, rawLimit, rawSuites, rawPlans, rawSprints] = await Promise.all([
    listed === null ? refs.changedFiles('HEAD', against) : Promise.resolve({ ok: true as const, value: [] as string[] }),
    listed === null ? refs.workingChanges() : Promise.resolve({ ok: true as const, value: [] as string[] }),
    scripts.config('Local checks', ''),
    scripts.config('Local checks limit', String(DEFAULT_LOCAL_CHECKS_LIMIT)),
    scripts.config('CI suites', ''),
    scripts.config('Plan directory', 'docs/plans/'),
    scripts.config('Sprint directory', 'docs/sprints/'),
  ]);
  const [rawActive, rawDelivered] = ci
    ? await Promise.all([scripts.config('Active index', 'docs/plans/active/'), scripts.config('Delivered index', 'docs/plans/delivered/')])
    : [null, null];
  if (listed === null && !committed.ok) warn(`plot-local-checks: could not read the branch against ${against ?? 'its base'}; reading the working tree only\n`);

  const changed = listed ?? [...new Set([...(committed.ok ? committed.value : []), ...(working.ok ? working.value : [])])];
  const checks = parseLocalChecks(rawChecks.ok ? rawChecks.value.trim() : '');
  const limit = Number.parseInt(rawLimit.ok ? rawLimit.value.trim() : '', 10);

  const unset = await refs.mergeUnset(changed);
  const generated = unset.ok ? unset.value : [];
  const generatedSet = new Set(generated);
  const tests = await readTests(refs, repoRoot, checks, changed);

  const corpus = corpusGlobs(rawPlans.ok ? rawPlans.value : '', rawSprints.ok ? rawSprints.value : '');

  if (ci) {
    const selection = ciSelection({
      changed,
      generated,
      checks,
      tests,
      corpus,
      corpusFiles: corpusGlob === null ? [] : await readCorpus(refs, repoRoot, corpusGlob, changed),
      sync: {
        planDir: rawPlans.ok ? rawPlans.value : 'docs/plans/',
        activeIndex: rawActive?.ok ? rawActive.value : 'docs/plans/active/',
        deliveredIndex: rawDelivered?.ok ? rawDelivered.value : 'docs/plans/delivered/',
        sprintDir: rawSprints.ok ? rawSprints.value : 'docs/sprints/',
        releaseDir: DEFAULT_RELEASE_DIR,
      },
      root: repoRoot,
    });
    write(`${JSON.stringify(selection)}\n`);
    return EXIT.ok;
  }

  const data = corpus.map(globToRegExp);
  const references = testsNaming(
    changed.filter((file) => !generatedSet.has(file) && !data.some((pattern) => pattern.test(file))),
    tests,
  );

  const output = render(
      localChecks({
        changed,
        generated,
        references,
        corpus,
        tests,
        checks,
        limit: Number.isFinite(limit) && limit >= 0 ? limit : DEFAULT_LOCAL_CHECKS_LIMIT,
        root: repoRoot,
      }),
      parseList(rawSuites.ok ? rawSuites.value.trim() : ''),
    );
  write(chosen === null ? output : `${baseLine(chosen.base, chosen.candidates)}\n${output}`);
  return runChecks ? runPrinted(context, printedCommands(output), write) : EXIT.ok;
};

/**
 * Reads what {@link localChecksBase} decides from, and asks it.
 *
 * @param refs - the git adapter.
 * @param context - the repository root and the script directory, for the registry.
 * @param flag - the `--base` argument, or `null`.
 * @returns the chosen base, or the refusal of the `--base` argument, and the counts it compared.
 */
const resolveBase = async (
  refs: ReturnType<typeof refsGit>,
  context: { repoRoot: string; scriptDir: string },
  flag: string | null,
): Promise<{ base: LocalChecksBase | LocalChecksBaseRefusal; candidates: readonly BaseCandidate[] }> => {
  const [main, remote] = await Promise.all([refs.defaultBranch(), refs.listBranches(true)]);
  const defaultBranch = main.ok ? main.value : 'main';
  const remoteBranches = remote.ok ? remote.value : [];
  if (flag !== null) {
    // `^{commit}` peels a tag and refuses a tree, so the answer is always a commit's full id.
    const object = await refs.resolve(`${flag.trim()}^{commit}`);
    return {
      base: localChecksBase({ flag, flagObject: object.ok ? object.value : null, manifestBase: null, defaultBranch, remoteBranches, candidates: [] }),
      candidates: [],
    };
  }
  const recorded = await manifestBaseOf(context, context.repoRoot);
  const manifestBase = recorded.ok ? recorded.value : null;
  const held = manifestBase !== null && manifestBase !== '' && remoteBranches.includes(manifestBase);
  const candidates: BaseCandidate[] = held
    ? []
    : await Promise.all(
        baseCandidateBranches(defaultBranch, remoteBranches).map(async (branch) => {
          const ahead = await refs.countAhead(`origin/${branch}`);
          return { branch, ahead: ahead.ok ? ahead.value : null };
        }),
      );
  return { base: localChecksBase({ flag: null, flagObject: null, manifestBase, defaultBranch, remoteBranches, candidates }), candidates };
};

/**
 * Runs the printed commands in order and stops at the first failure.
 *
 * @param context - the repository root, where each command runs, and the script directory.
 * @param commands - the printed commands.
 * @param write - where progress and the failure go.
 * @returns 0 when every command passed, 1 at the first that did not.
 */
const runPrinted = async (context: { repoRoot: string; scriptDir: string }, commands: readonly string[], write: (s: string) => void): Promise<number> => {
  const boundedRun = boundedRunProcess(processesShell(context));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'plot-local-checks-run-'));
  const outFile = path.join(dir, 'out');
  try {
    for (const command of commands) {
      writeFileSync(outFile, '');
      write(`run: ${command}\n`);
      const ran = await boundedRun.run('bash', ['-c', command], { cwd: context.repoRoot, boundSeconds: 0, outFile });
      if (!ran.ok || ran.value.status !== 0) {
        const failure = failedCheck(command, readFileSync(outFile, 'utf8'));
        write(`FAILED: ${command}\n${failure.passed ? '' : failure.tail}\n`);
        return EXIT.failed;
      }
    }
    write(`passed: ${commands.length} commands\n`);
    return EXIT.ok;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Answers `--ci-suite-refusal`: whether the command on stdin runs a suite the
 * project's `CI suites` key leaves to CI. `plot-controller-gate.sh` asks it for
 * an unattended agent at a fleet desk.
 *
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param command - the command line.
 * @param write - where the refusal goes.
 * @returns `refused` when the command runs a listed suite, `ok` otherwise.
 */
export const refuse = async (
  cwd: string,
  scriptDir: string,
  command: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> => {
  const raw = await scriptsShell({ repoRoot: cwd, scriptDir }).config('CI suites', '');
  const refusal = ciSuiteRefusal(command, parseList(raw.ok ? raw.value.trim() : ''));
  if (refusal === null) return EXIT.ok;
  const checks = path.join(scriptDir, 'board', 'plot-local-checks.mjs');
  write(
    [
      `plot-controller-gate: \`${refusal.suite}\` is a CI suite, and CI runs it on every pull request.`,
      '',
      '  Run the checks your change touches instead:',
      `      node ${checks}`,
      '  and run what it prints. A failure CI finds comes back to you as a correction.',
      '',
      '  The suites only CI runs are listed in the `CI suites` key of this repository\'s Plot Config.',
      '',
    ].join('\n'),
  );
  return EXIT.refused;
};

/**
 * Reads the green head from the Actions API answer.
 *
 * @param text - the file's text, or `null` where it could not be read.
 * @returns the head SHA, `''` for an empty run list, `null` for a failed call.
 */
export const greenHeadOf = (text: string | null): string | null => {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    const runs = (parsed as { workflow_runs?: unknown }).workflow_runs;
    if (!Array.isArray(runs)) return null;
    if (runs.length === 0) return '';
    const head = (runs[0] as { head_sha?: unknown }).head_sha;
    return typeof head === 'string' ? head : null;
  } catch {
    return null;
  }
};

const readOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Answers `--push-base`: the base a `main` push run's selection diffs from.
 *
 * @param greenFile - the Actions API answer for the newest successful `CI` push run.
 * @param firstParentFile - the head's first-parent line, one SHA per line.
 * @param write - where the answer goes.
 * @returns {@link EXIT.ok}.
 */
export const pushBase = (greenFile: string, firstParentFile: string, write: (s: string) => void = (s) => process.stdout.write(s)): number => {
  const firstParent = (readOrNull(firstParentFile) ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const answer = pushSelectionBase({ greenHead: greenHeadOf(readOrNull(greenFile)), firstParent });
  write('base' in answer ? `base=${answer.base}\n` : `every=${answer.every}\n`);
  return EXIT.ok;
};

/** The arguments {@link run} takes from the command line. */
export interface Args {
  readonly ci: boolean;
  readonly files: string | null;
  readonly corpus: string | null;
  readonly base: string | null;
  readonly run: boolean;
}

/**
 * Reads the command line: `--ci`, `--files <path>`, `--base <branch>`, `--run`
 * and, with `--ci`, `--corpus <glob>`, each at most once. `--run` does not
 * combine with `--ci`.
 *
 * @param argv - the arguments after the script.
 * @returns the arguments, or the first one this command does not take.
 */
export const parseArgs = (argv: readonly string[]): Args | { readonly unknown: string } => {
  let ci = false;
  let files: string | null = null;
  let corpus: string | null = null;
  let base: string | null = null;
  let run = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--ci' && !ci) ci = true;
    else if (arg === '--files' && files === null && value !== undefined) {
      files = value;
      i += 1;
    } else if (arg === '--base' && base === null && value !== undefined && value.trim() !== '') {
      base = value;
      i += 1;
    } else if (arg === '--run' && !run) run = true;
    else if (arg === '--corpus' && corpus === null && value !== undefined) {
      corpus = value;
      i += 1;
    } else return { unknown: arg };
  }
  if (corpus !== null && !ci) return { unknown: '--corpus' };
  if (run && ci) return { unknown: '--run' };
  return { ci, files, corpus, base, run };
};

// Only when RUN as plot-local-checks.mjs, never when imported — the gate bundle
// bundles this module and shares its `import.meta.url`. `pathToFileURL` on the realpath, because
// `import.meta.url` is realpath-resolved and `process.argv[1]` is not. The
// scripts sit one directory above the bundle, in a repository and under a
// plugin install alike.
if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'plot-local-checks.mjs' &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv[2] === '--ci-suite-refusal') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    void endEntry(await refuse(process.cwd(), scriptDir, Buffer.concat(chunks).toString('utf8')));
  } else if (process.argv[2] === '--push-base') {
    const [green, firstParent, ...rest] = process.argv.slice(3);
    if (green === undefined || firstParent === undefined || rest.length > 0) {
      process.stderr.write('usage: plot-local-checks.mjs --push-base <green.json> <first-parent.txt>\n');
      void endEntry(EXIT.usage);
    } else {
      void endEntry(pushBase(green, firstParent));
    }
  } else {
    const parsed = parseArgs(process.argv.slice(2));
    if ('unknown' in parsed) {
      process.stderr.write(
        `plot-local-checks: unknown argument ${parsed.unknown}\nusage: plot-local-checks.mjs [--ci [--corpus <glob>]] [--files <path>] [--base <branch>] [--run]\n       plot-local-checks.mjs --push-base <green.json> <first-parent.txt>\n`,
      );
      void endEntry(EXIT.usage);
    } else {
      void endEntry(await run(process.cwd(), scriptDir, undefined, undefined, parsed.files, parsed.ci, parsed.corpus, parsed.base, parsed.run));
    }
  }
}
