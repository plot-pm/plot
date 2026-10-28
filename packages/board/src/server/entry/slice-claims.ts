import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { branchClaims } from '@plot-pm/domain/rules/cross-repo-reference';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-impl-status.sh` runs, once per plan.
 *
 * ```
 * git show origin/main:docs/plans/x.md | node plot-slice-claims.mjs
 * #12	feature/a
 * quatico/one#11	infra/shared
 * quatico/two#22	infra/shared
 * -	feature/bare
 * ```
 *
 * Reads the plan text on stdin and prints one `<reference><TAB><branch>` line
 * per row of the domain's `branchClaims`: the reference is `#N` for a PR in this
 * repository, `owner/repo#N` for one in another, and `-` for a branch whose
 * claim lines name no PR. Reads no file and calls no host.
 */

/**
 * Prints the claim rows of one plan.
 *
 * @param text - the whole plan file.
 * @param write - where the rows go.
 * @returns the process exit code, always 0.
 */
export const run = (text: string, write: (s: string) => void = (s) => process.stdout.write(s)): number => {
  write(
    branchClaims(text)
      .map(({ branch, reference }) =>
        `${reference === null ? '-' : `${reference.repo}#${reference.number}`}\t${branch}\n`,
      )
      .join(''),
  );
  return 0;
};

// Only when RUN, never when imported. `pathToFileURL` rather than a template:
// `import.meta.url` is realpath-resolved and `process.argv[1]` is not.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  void endEntry(run(Buffer.concat(chunks).toString('utf8')));
}
