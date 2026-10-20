import { bitbucketMergeable } from '@plot-pm/domain/rules/bitbucket-mergeable';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Folds the Bitbucket `mergeable` reading from a local `git merge-tree` check
 * — the rule `bitbucketMergeable` reached from `plot-host.sh`, once per
 * Bitbucket PR row in `pr-state` and `pr-list --rich`.
 *
 * ```
 * printf '%s\n%s\n%s\n%s\n%s\n' "$headSha" "$baseRef" "$gitVersion" "$mtCode" "$mtStderr" \
 *   | plot-bitbucket-mergeable.mjs
 * {"mergeable":"mergeable"}
 * {"mergeable":"conflicting"}
 * {"mergeable":"unknown","mergeableReason":"..."}
 * ```
 *
 * The shell keeps the transport: it resolves `baseRef`, reads `git --version`
 * and runs `git merge-tree --write-tree` itself. This entry reads stdin only
 * and spawns nothing. `$mtCode` is empty where the shell skipped the call
 * (head, base or git version already answered `unknown`); `$mtStderr` is the
 * merge-tree invocation's stderr, read only when `$mtCode` is present and not
 * 0 or 1.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The rule answered. */
  ok: 0,
} as const;

/**
 * Answers the fold.
 *
 * @param stdin - five lines: head sha, base ref, `git --version` output,
 *   merge-tree's exit code (or empty), merge-tree's stderr (or empty).
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const lines = stdin.split('\n');
  const [headSha, baseRef, gitVersion, mtCodeRaw, mtStderr] = [0, 1, 2, 3, 4].map((i) => lines[i] ?? '');
  const mergeTree = mtCodeRaw === '' ? undefined : { code: Number(mtCodeRaw), stderr: mtStderr };
  write(`${JSON.stringify(bitbucketMergeable({ headSha, baseRef, gitVersion, mergeTree }))}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported; `pathToFileURL` for the macOS `/tmp`
// symlink reason `merge-subject.ts` records.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
