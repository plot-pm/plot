// THROUGH THE NARROW PATHS, not the package root, for the reason
// `merge-subject.ts` gives: the root import bundles every entity and rule.
import { envelopeNextFor } from '@plot-pm/domain/adapters/host/listing-paging';
import { walkStep } from '@plot-pm/domain/rules/listing-page';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The exit code that tells `_bb_paged_walk` the walk stopped and its answer is printed. */
export const ANSWERED = 10;

/**
 * Whether `plot-host.sh`'s `_bb_paged_walk` reads another page in its
 * row-limit mode — `walkStep` reached without HTTP, once per page read.
 *
 * ```
 * plot-listing-walk.mjs <limit> <pagelen> [<next-file>] < pages
 * ```
 *
 * Reads the pages read so far on stdin, one JSON response per line, in order.
 * Where the walk continues, writes nothing and exits 0. Where it stops, writes
 * the pages' combined `values` trimmed to `<limit>` as one JSON array, writes
 * the stopping reading to `<next-file>` when one is named — `1` for a further
 * page or a trimmed row, `0` for none, empty for no envelope — and exits 10. A
 * last page whose `next` is not a non-empty string stops the walk, because the
 * shell has no page to follow. Input that is not one JSON object or null per
 * line exits 3.
 *
 * @param argv - the arguments after the script name.
 * @param input - the pages, one JSON response per line.
 * @param write - where the rows go.
 * @param writeNext - where the stopping reading goes.
 * @returns the process exit code.
 */
export const run = (
  argv: string[],
  input: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  writeNext: (path: string, s: string) => void = (path, s) => writeFileSync(path, s),
): number => {
  const [limit, pageLength] = [Number(argv[0]), Number(argv[1])];
  if (!(limit >= 1) || !(pageLength >= 1)) {
    process.stderr.write('plot-listing-walk: usage: plot-listing-walk.mjs <limit> <pagelen> [<next-file>]\n');
    return 3;
  }
  const responses: Record<string, unknown>[] = [];
  for (const line of input.split('\n').filter((l) => l.trim() !== '')) {
    let page: unknown;
    try {
      page = JSON.parse(line);
    } catch {
      process.stderr.write('plot-listing-walk: a page is not JSON\n');
      return 3;
    }
    if (page !== null && (typeof page !== 'object' || Array.isArray(page))) {
      process.stderr.write('plot-listing-walk: a page is not a JSON object\n');
      return 3;
    }
    responses.push((page ?? {}) as Record<string, unknown>);
  }
  const values = responses.map((page) => (Array.isArray(page.values) ? page.values : []));
  const step = walkStep(
    responses.map((page, index) => ({ rows: values[index].length, envelopeNext: envelopeNextFor(page) })),
    limit,
    pageLength,
  );
  const next = responses.at(-1)?.next;
  if (!step.stops && typeof next === 'string' && next !== '') return 0;
  const reading = { present: '1', absent: '0', unknown: '' }[step.envelopeNext];
  if (argv[2]) writeNext(argv[2], `${reading}\n`);
  write(`${JSON.stringify(values.flat().slice(0, limit))}\n`);
  return ANSWERED;
};

// Only when RUN, never when imported. `pathToFileURL` rather than a template,
// for the reason `merge-subject.ts` records.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // `exitCode`, never `process.exit`: stdout to a pipe is asynchronous, and an
  // exit cuts whatever is still queued — past 64 KB on macOS.
  process.exitCode = run(process.argv.slice(2), readFileSync(0, 'utf8'));
}
