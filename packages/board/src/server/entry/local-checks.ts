// THROUGH THE NARROW PATHS, not the package roots, so the bundle carries the
// two adapters and the one rule it uses.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import {
  DEFAULT_LOCAL_CHECKS_LIMIT,
  localChecks,
  parseList,
  parseLocalChecks,
  searchTerms,
  type LocalChecksAnswer,
} from '@plot-pm/domain/rules/local-checks';
import { ciSuiteRefusal } from '@plot-pm/domain/rules/ci-suite';
import { realpathSync } from 'node:fs';
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
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The answer was written. */
  ok: 0,
  /** The current directory is not inside a git repository. */
  notRepository: 2,
  /** `--ci-suite-refusal`: the command runs a suite only CI runs. */
  refused: 3,
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
 * Reads the branch and the config, asks the rule, and prints the answer.
 *
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where the answer goes.
 * @param warn - where an error goes.
 * @returns the process exit code.
 */
export const run = async (
  cwd: string,
  scriptDir: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
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

  const [committed, working, rawChecks, rawLimit, rawSuites] = await Promise.all([
    refs.changedFiles('HEAD'),
    refs.workingChanges(),
    scripts.config('Local checks', ''),
    scripts.config('Local checks limit', String(DEFAULT_LOCAL_CHECKS_LIMIT)),
    scripts.config('CI suites', ''),
  ]);
  if (!committed.ok) warn('plot-local-checks: could not read the branch against the default branch; reading the working tree only\n');

  const changed = [...new Set([...(committed.ok ? committed.value : []), ...(working.ok ? working.value : [])])];
  const checks = parseLocalChecks(rawChecks.ok ? rawChecks.value.trim() : '');
  const limit = Number.parseInt(rawLimit.ok ? rawLimit.value.trim() : '', 10);

  const unset = await refs.mergeUnset(changed);
  const generated = unset.ok ? unset.value : [];
  const generatedSet = new Set(generated);
  const testGlobs = checks.filter((check) => check.command.includes('{tests}')).map((check) => check.glob);

  const references = new Map<string, readonly string[]>();
  for (const file of changed) {
    if (generatedSet.has(file) || testGlobs.length === 0) continue;
    const found = new Set<string>();
    for (const term of searchTerms(file)) {
      const named = await refs.filesNaming(term, testGlobs);
      if (named.ok) named.value.forEach((test) => found.add(test));
    }
    references.set(file, [...found]);
  }

  write(
    render(
      localChecks({
        changed,
        generated,
        references,
        checks,
        limit: Number.isFinite(limit) && limit >= 0 ? limit : DEFAULT_LOCAL_CHECKS_LIMIT,
        root: repoRoot,
      }),
      parseList(rawSuites.ok ? rawSuites.value.trim() : ''),
    ),
  );
  return EXIT.ok;
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

// Only when RUN, never when imported. `pathToFileURL` on the realpath, because
// `import.meta.url` is realpath-resolved and `process.argv[1]` is not. The
// scripts sit one directory above the bundle, in a repository and under a
// plugin install alike.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv[2] === '--ci-suite-refusal') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    process.exit(await refuse(process.cwd(), scriptDir, Buffer.concat(chunks).toString('utf8')));
  }
  process.exit(await run(process.cwd(), scriptDir));
}
