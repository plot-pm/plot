// THROUGH THE NARROW PATH, not the package root, for the reason
// `merge-subject.ts` gives: the root import bundles every entity and rule.
import { remoteSlug } from '@plot-pm/domain/rules/remote-slug';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The Bitbucket `<workspace>/<repo>` slug of a remote URL — `bitbucketSlug`
 * reached without HTTP, for `plot-host.sh commit-status`.
 *
 * ```
 * plot-bitbucket-slug.mjs <remote-url>
 * ```
 *
 * Writes the slug and a newline, or nothing where the URL names no Bitbucket
 * repository. Empty is an answer: the caller reads it as `unsupported`. The
 * exit code is 0 either way.
 *
 * @param argv - the arguments after the script name.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (argv: string[], write: (s: string) => void = (s) => process.stdout.write(s)): number => {
  const slug = remoteSlug(argv[0] ?? '', 'bitbucket.org');
  if (slug !== null) write(`${slug}\n`);
  return 0;
};

// Only when RUN, never when imported. `pathToFileURL` rather than a template,
// for the reason `merge-subject.ts` records.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void endEntry(run(process.argv.slice(2)));
}
