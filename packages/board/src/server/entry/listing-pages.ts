import { githubExtraPages } from '@plot-pm/domain/rules/listing-page';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * How many requests past the first a `gh` listing of some rows made, for
 * `plot-host.sh`'s spend record.
 *
 * ```
 * plot-listing-pages.mjs <rows>
 * plot-listing-pages.mjs < rows.json
 * ```
 *
 * Prints {@link githubExtraPages} for the row count and exits 0. The count is
 * the argument, or the length of the JSON array on stdin where no argument is
 * given. Input that names no count prints nothing and exits 3, so the caller
 * records nothing for a question it could not ask.
 *
 * @param argv - the arguments after the script name.
 * @param input - stdin, read only where `argv` names no count.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (argv: string[], input: () => string, write: (s: string) => void = (s) => process.stdout.write(s)): number => {
  let rows: unknown = argv[0] === undefined ? undefined : Number(argv[0]);
  if (rows === undefined) {
    try {
      const parsed: unknown = JSON.parse(input());
      rows = Array.isArray(parsed) ? parsed.length : undefined;
    } catch {
      rows = undefined;
    }
  }
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 0) {
    process.stderr.write('plot-listing-pages: usage: plot-listing-pages.mjs <rows> | < json-array\n');
    return 3;
  }
  write(`${githubExtraPages(rows)}\n`);
  return 0;
};

// Only when RUN, never when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void endEntry(run(process.argv.slice(2), () => readFileSync(0, 'utf8')));
}
