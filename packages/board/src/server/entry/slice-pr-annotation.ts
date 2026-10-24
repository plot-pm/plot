import { annotateSlicePr } from '@plot-pm/domain/rules/slice-pr-annotation';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-record-pr.sh` runs once, against the plan file
 * read in its disposable booking worktree.
 *
 * ```
 * node plot-slice-pr-annotation.mjs <plan-file> <branch> <pr-number>
 * ```
 *
 * **A FIFTH artifact, for the reason the others give.** The transform is a
 * pure rule over a plan file's text; a bundle that reads and writes the file
 * itself keeps the rule testable in `packages/domain` without a shell harness,
 * the way `plan-record-edit.ts` does for the `## Status` section.
 *
 * **The file path is an argument, not stdin.** Unlike the other entry points
 * here, this one's input is a whole file rather than one line per loop
 * iteration — reading and writing it directly is simpler than round-tripping
 * its content through the shell.
 */

/**
 * Read the plan file, annotate it, write it back if it changed.
 *
 * @param file the plan file's path
 * @param branch the branch whose bulleted line should carry the PR number
 * @param pr the PR number to record
 * @returns the process exit code — 0 annotated, 1 refused
 */
export const run = async (file: string, branch: string, pr: string): Promise<number> => {
  const fs = await import('node:fs/promises');
  const content = await fs.readFile(file, 'utf8');
  const result = annotateSlicePr(content, branch, pr);
  if (result.outcome === 'refused') {
    process.stderr.write(
      result.reason === 'already-annotated'
        ? `plot-slice-pr-annotation: ${file} already carries a PR annotation on the ${branch} line — refusing to add a second\n`
        : `plot-slice-pr-annotation: ${file} does not carry a bulleted line for ${branch}\n`,
    );
    return 1;
  }
  await fs.writeFile(file, result.content);
  return 0;
};

// Only when RUN, never when imported. See movable.ts for why pathToFileURL
// rather than a template comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [file, branch, pr] = process.argv.slice(2);
  if (!file || !branch || !pr) {
    process.stderr.write('usage: plot-slice-pr-annotation.mjs <plan-file> <branch> <pr-number>\n');
    process.exit(2);
  }
  process.exit(await run(file, branch, pr));
}
