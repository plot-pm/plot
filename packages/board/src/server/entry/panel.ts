// THROUGH THE NARROW PATH, not the package root. `@plot-pm/domain` re-exports
// every entity and rule, and esbuild bundles what it is given: measured
// 2026-09-03, the root import produced a 334 KB artifact against
// `plot-movable.mjs`'s 1.2 KB.
import {
  commitmentLine,
  readJuror,
  readPanel,
  type Commitment,
  type JurorReading,
} from '@plot-pm/domain/rules/panel';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The panel's commitment gate, reached without HTTP.
 *
 * ```
 * plot-panel.mjs check Position proceed,amend,reject contracts < verdict.md
 * committed	contracts	amend
 *
 * plot-panel.mjs reconcile < readings.tsv
 * divided	amend=contracts,scope	proceed=evidence
 * ```
 *
 * **AN EIGHTH ARTIFACT, for the reason the others give.** `plot-ask.mjs`
 * answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh` — 18.3 s — so a
 * script asking it whether one juror committed would start a whole fleet scan
 * to read one file. This entry reads stdin, spawns nothing and opens nothing.
 *
 * **THE FILE ARRIVES ON STDIN.** The rule reaches no filesystem, and a bundle
 * that opened the juror's file would put the one I/O call this needs inside the
 * artifact rather than in the shell that owns it — the choice
 * `plot-sprint-transition.mjs` records.
 *
 * **Tab-separated out.** The caller is bash, and JSON would mean a `jq`
 * dependency on a path that has none.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The juror committed, or the panel reconciled. */
  ok: 0,
  /** The arguments were unusable — a broken caller, not a hedging juror. */
  usage: 2,
  /** The gate refused. */
  refused: 3,
} as const;

/**
 * Reads one juror's file against the caller's required shape.
 *
 * @param lens - the persona whose file this is.
 * @param commitment - the label and positions the caller requires.
 * @param text - the file's contents.
 * @returns `<read>\t<lens>\t<position-or-why>`.
 */
export const check = (lens: string, commitment: Commitment, text: string): string => {
  const reading = readJuror(lens, text, commitment);
  return reading.read === 'committed'
    ? `committed\t${reading.lens}\t${reading.position}\n`
    : `${reading.read}\t${reading.lens}\t${reading.why}\n`;
};

/**
 * Parses the readings a caller collected, one per line.
 *
 * @param text - `<read>\t<lens>\t<detail>` per juror.
 * @returns the readings, in the order given.
 */
export const readingsFrom = (text: string): JurorReading[] =>
  text
    .split('\n')
    .filter((line) => line !== '')
    .map((line, n) => {
      const [read, lens, detail] = line.split('\t');
      if (lens === undefined || detail === undefined) {
        throw new Error(`line ${n + 1}: expected '<read>\\t<lens>\\t<detail>', got '${line}'`);
      }
      switch (read) {
        case 'committed':
          return { read, lens, position: detail };
        case 'uncommitted':
        case 'empty':
          return { read, lens, why: detail };
        default:
          throw new Error(`line ${n + 1}: '${read}' is not committed|uncommitted|empty`);
      }
    });

/**
 * Reconciles every juror's reading into the panel's answer.
 *
 * @param text - the readings, one per line.
 * @returns the panel line the moderator is handed.
 */
export const reconcile = (text: string): string => {
  const reading = readPanel(readingsFrom(text));
  switch (reading.panel) {
    case 'refused':
      return `refused\t${reading.refusals.map((r) => `${r.lens}=${r.read}`).join(',')}\n`;
    case 'unanimous':
      return `unanimous\t${reading.position}\t${reading.lenses.join(',')}\n`;
    case 'divided':
      return `divided\t${Object.entries(reading.positions)
        .map(([position, lenses]) => `${position}=${lenses.join(',')}`)
        .join('\t')}\n`;
  }
};

/**
 * Prints the answer.
 *
 * @param argv - the verb and its arguments.
 * @param stdin - what arrived on standard input.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (
  argv: readonly string[],
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const [verb] = argv;
  try {
    if (verb === 'reconcile') {
      const line = reconcile(stdin);
      write(line);
      return line.startsWith('refused\t') ? EXIT.refused : EXIT.ok;
    }
    if (verb === 'check') {
      const [, label, positions, lens] = argv;
      if (!label || !positions || !lens) {
        process.stderr.write(
          'plot-panel: usage: plot-panel.mjs check <label> <a,b,c> <lens> < juror.md\n',
        );
        return EXIT.usage;
      }
      const commitment: Commitment = { label, positions: positions.split(',') };
      const line = check(lens, commitment, stdin);
      // THE REFUSAL GETS ITS OWN CODE. A caller reading only `$?` must not be
      // able to treat a hedge as a verdict, and `1` is what a broken pipe or a
      // missing file already means to a shell.
      if (!line.startsWith('committed\t')) {
        process.stderr.write(`plot-panel: ${lens} must write '${commitmentLine(commitment)}'\n`);
        write(line);
        return EXIT.refused;
      }
      write(line);
      return EXIT.ok;
    }
    process.stderr.write('plot-panel: usage: plot-panel.mjs check|reconcile ...\n');
    return EXIT.usage;
  } catch (err) {
    process.stderr.write(`plot-panel: ${(err as Error).message}\n`);
    return EXIT.usage;
  }
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(process.argv.slice(2), Buffer.concat(chunks).toString('utf8')));
}
