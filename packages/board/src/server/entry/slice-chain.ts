import { isChainedHeading, type ChainedBranchLine } from '@plot-pm/domain/rules/slice-chain';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The `node` entry point section 7 of `plot-reconcile-scan.sh` runs, once per
 * reconcile pass.
 *
 * ```
 * printf '%s\n' '{"branches":[{"branch":"bug/a"},{"branch":"bug/b","waits_on":["bug/a"]}]}' \
 *   | node plot-slice-chain.mjs
 * chained
 * ```
 *
 * Reads one JSON object per line on stdin — a heading's branches, in plan
 * order, each an object with `branch` and an optional `waits_on` array — and
 * prints `chained` or `uncut` for each, in order.
 *
 * **ONCE PER RECONCILE PASS, NOT PER AGENT PER PASS.** `docs/shell-and-domain.md`
 * draws the line there: a bundle bought once per operator or CI run is free,
 * so this calls the domain rather than carrying a shell copy of it.
 *
 * Exit 0 after answering every line, 2 when a line is not parseable JSON or
 * does not carry a `branches` array.
 */

/** One heading's branches, as section 7's `jq` pass emits them. */
interface HeadingInput {
  /** The branches under the heading, in plan order. */
  branches: readonly ChainedBranchLine[];
}

/**
 * Parses one stdin line.
 *
 * @param line - the JSON document for one heading.
 * @returns the heading's branches.
 * @throws when the line is not a JSON object carrying a `branches` array.
 */
export const headingFrom = (line: string): readonly ChainedBranchLine[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`not valid JSON: '${line}'`);
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !Array.isArray((parsed as HeadingInput).branches)
  ) {
    throw new Error(`expected an object with a 'branches' array, got '${line}'`);
  }
  return (parsed as HeadingInput).branches;
};

/**
 * Answers one heading.
 *
 * @param line - the JSON document for one heading.
 * @returns `chained` or `uncut`.
 */
export const answer = (line: string): string => (isChainedHeading(headingFrom(line)) ? 'chained' : 'uncut');

/**
 * Reads stdin line by line, prints one answer per line.
 *
 * @param text - the whole of stdin.
 * @param write - where each answer goes.
 * @returns the exit code — 0 answered every line, 2 a line could not be read.
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  let code = 0;
  for (const line of lines) {
    try {
      write(`${answer(line)}\n`);
    } catch (err) {
      process.stderr.write(`plot-slice-chain: ${(err as Error).message}\n`);
      code = 2;
    }
  }
  return code;
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  void endEntry(run(Buffer.concat(chunks).toString('utf8')));
}
