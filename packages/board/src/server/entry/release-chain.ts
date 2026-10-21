// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { releaseChain, type ReleaseChainHop, type ReleaseChainReading } from '@plot-pm/domain/rules/release-chain';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Classifies a release chain's walk trace — {@link releaseChain} reached
 * without HTTP, for `plot-reconcile-scan.sh` section 6.
 *
 * ```
 * plot-release-chain.mjs classify < readings
 * ```
 *
 * **ONCE PER DELIVERED PLAN THE WALK ENGAGES FOR, not once per agent per
 * pass.** Section 6 runs once per operator `/plot-reconcile` invocation, so
 * this calls the domain rather than duplicating the walk's cycle and depth
 * checks in shell, per `docs/shell-and-domain.md`.
 *
 * **THE SHELL COLLECTS THE TRACE; THIS CLASSIFIES IT.** Each hop needs one
 * `plot-host.sh pr-merge-dest <branch>` call, so the I/O loop stays in the
 * script and this bundle only answers, given the trace so far, whether it
 * resolved, dead-ended, cycled, or ran too deep.
 *
 * ## The stdin format
 *
 * ```
 * @default <branch>                              # the repository's default branch
 * @hops                                           # then one hop per line, in walk order
 * <branch>\tfound\t<number>\t<base>\t<mergeCommit>
 * <branch>\tnot-found
 * ```
 *
 * ## The output
 *
 * ```
 * resolved\t<mergeCommit>
 * refused\t<reason>\t<branch>
 * ```
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The rule answered. */
  ok: 0,
  /** The caller named no verb, or one this does not have. */
  usage: 2,
} as const;

/**
 * Parses the sectioned readings.
 *
 * @param stdin - the readings as the scan wrote them.
 * @returns the reading {@link releaseChain} takes, with unknown lines ignored.
 */
export const parseReadings = (stdin: string): ReleaseChainReading => {
  let defaultBranch = '';
  const hops: ReleaseChainHop[] = [];
  let section: 'none' | 'hops' = 'none';
  for (const line of stdin.split('\n')) {
    if (line === '') continue;
    if (line.startsWith('@')) {
      const space = line.indexOf(' ');
      const verb = space === -1 ? line.slice(1) : line.slice(1, space);
      const rest = space === -1 ? '' : line.slice(space + 1);
      if (verb === 'default') {
        defaultBranch = rest;
        section = 'none';
      } else if (verb === 'hops') {
        section = 'hops';
      } else {
        section = 'none';
      }
      continue;
    }
    if (section !== 'hops') continue;
    const [branch, status, number, base, mergeCommit] = line.split('\t');
    if (branch === undefined) continue;
    if (status === 'found' && number !== undefined && base !== undefined && mergeCommit !== undefined) {
      hops.push({ branch, found: true, number, base, mergeCommit });
    } else {
      hops.push({ branch, found: false });
    }
  }
  return { defaultBranch, hops };
};

/**
 * Answers the verb.
 *
 * @param argv - the arguments after the script name.
 * @param stdin - the readings.
 * @param write - where the answer goes.
 * @param warn - where a usage refusal goes.
 * @returns the process exit code.
 */
export const run = (
  argv: string[],
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  const verb = argv[0];
  if (verb !== 'classify') {
    warn('plot-release-chain: usage: plot-release-chain.mjs classify < readings\n');
    return EXIT.usage;
  }
  const result = releaseChain(parseReadings(stdin));
  if (result.outcome === 'resolved') {
    write(`resolved\t${result.mergeCommit}\n`);
  } else {
    write(`refused\t${result.reason}\t${result.branch}\n`);
  }
  return EXIT.ok;
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
