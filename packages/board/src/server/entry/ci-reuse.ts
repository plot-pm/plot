// THROUGH THE NARROW PATH, not the package root, for the reason
// `merge-subject.ts` gives: the root import bundles every entity and rule.
import { ciReuse, parseCiReuseReadings, reuseDiff, reuseOutput, type JobReuse } from '@plot-pm/domain/rules/ci-reuse';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Which CI jobs a pull request run reuses — `ciReuse` reached from `ci.yml`'s
 * `select` job.
 *
 * ```
 * plot-ci-reuse.mjs diff <head-diff.txt> <record.json> <changed.txt>
 * plot-ci-reuse.mjs decide <readings.json> <summary.md> <run-url-prefix>
 * ```
 *
 * `diff` prints the reuse diff, one path per line: the head diff joined with
 * the symmetric difference of the record's `changed` and this run's changed
 * paths.
 *
 * `decide` prints one `reuse_<key>=<value>` line per reusable job, where the
 * value is `reused:<40 hex>` or empty, and one `::notice title=reused::` line
 * per reused job. It appends a table to `<summary.md>` naming each job's
 * source run (linked under `<run-url-prefix>`), head SHA, base SHA and
 * conclusion, or the reason the job runs. It reaches no host.
 *
 * Exit 0 with an answer; 1 when a file cannot be read or parsed, with nothing
 * printed; 2 on a usage error.
 *
 * @param argv - the arguments after the script name.
 * @param write - where the answer goes.
 * @param warn - where errors go.
 * @returns the process exit code.
 */
export const run = (
  argv: string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  const [mode, ...rest] = argv;
  try {
    if (mode === 'diff' && rest.length === 3) {
      const lines = (file: string): string[] => readFileSync(file, 'utf8').split('\n');
      const record = JSON.parse(readFileSync(rest[1], 'utf8')) as { changed?: unknown };
      const earlier = Array.isArray(record.changed) ? record.changed.map(String) : null;
      if (earlier === null) throw new Error(`${rest[1]}: the record holds no changed list`);
      const paths = reuseDiff(lines(rest[0]), earlier, lines(rest[2]));
      write(paths.map((p) => `${p}\n`).join(''));
      return 0;
    }
    if (mode === 'decide' && rest.length === 3) {
      const answers = ciReuse(parseCiReuseReadings(readFileSync(rest[0], 'utf8')));
      appendFileSync(rest[1], summary(answers, rest[2]));
      write(answers.map((a) => outputLines(a)).join(''));
      return 0;
    }
  } catch (err) {
    warn(`plot-ci-reuse: ${(err as Error).message}\n`);
    return 1;
  }
  warn('usage: plot-ci-reuse.mjs diff <head-diff> <record.json> <changed> | decide <readings.json> <summary.md> <run-url-prefix>\n');
  return 2;
};

/** The output line, and the notice for a reused job. Only a well-formed value is printed. */
const outputLines = (a: JobReuse): string => {
  const value = a.reused ? reuseOutput(a.value) : '';
  const notice = a.reused && value !== '' ? `::notice title=reused::${a.job} reused from run ${a.runId} at ${a.headSha}\n` : '';
  return `${notice}reuse_${a.key}=${value}\n`;
};

/** The step summary table. */
const summary = (answers: readonly JobReuse[], runUrl: string): string => {
  const rows = answers.map((a) =>
    a.reused
      ? `| \`${a.job}\` | reused | [${a.runId}](${runUrl}/${a.runId}) | \`${a.headSha}\` | \`${a.base}\` | ${a.conclusion} |`
      : `| \`${a.job}\` | runs: ${a.reason} | | | | |`,
  );
  return [
    '### Reuse',
    '',
    '| Job | Answer | Source run | Source head | Base | Source conclusion |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n') + '\n';
};

// Only when RUN, never when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void endEntry(run(process.argv.slice(2)));
}
