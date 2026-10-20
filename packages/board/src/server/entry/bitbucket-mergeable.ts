import { foldBitbucketMergeable } from '@plot-pm/domain/rules/bitbucket-mergeable';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Folds the Bitbucket `mergeable` reading from a local `git merge-tree` check
 * into one `pr-state`/`pr-list --rich` row — the rule `foldBitbucketMergeable`
 * reached from `plot-host.sh`'s `bb_fold_mergeable`, once per row.
 *
 * ```
 * printf '%s\n' "$row" "$headSha" "$baseRef" "$gitVersion" "$fetch" "$inClone" "$mtCode" "$mtStderr" \
 *   | plot-bitbucket-mergeable.mjs
 * {...row,"mergeable":"mergeable"}
 * {...row,"mergeable":"conflicting"}
 * {...row,"mergeable":"unknown","mergeableReason":"..."}
 * ```
 *
 * The shell keeps the transport: it fetches the base, checks the head commit,
 * reads `git --version` and runs `git merge-tree --write-tree` itself. This
 * entry reads stdin only and spawns nothing. `$row` is the row JSON on one
 * line; a row that is not `OPEN` comes back unchanged. `$fetch` is `ok` or
 * `failed`, and `$inClone` is `yes` or `no`; either is empty where the shell
 * did not get that far. `$mtCode` is empty where the shell skipped merge-tree;
 * `$mtStderr` is its stderr, read only when `$mtCode` is present and not 0 or
 * 1, and may span several lines because it is the last field.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The rule answered. */
  ok: 0,
  /** The first line is not a JSON object; the caller keeps its row. */
  badRow: 2,
} as const;

/**
 * Answers the fold.
 *
 * @param stdin - the row JSON, head sha, base ref, `git --version` output, the
 *   fetch result, the head check and merge-tree's exit code (or empty), one
 *   line each, then merge-tree's stderr (or empty) to the end.
 * @param write - where the folded row goes.
 * @returns the process exit code.
 */
export const run = (
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const lines = stdin.split('\n');
  let row: unknown;
  try {
    row = JSON.parse(lines[0] ?? '');
  } catch {
    return EXIT.badRow;
  }
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return EXIT.badRow;
  const [headSha, baseRef, gitVersion, fetch, inClone, mtCodeRaw] = [1, 2, 3, 4, 5, 6].map((i) => lines[i] ?? '');
  const mergeTree = mtCodeRaw === '' ? undefined : { code: Number(mtCodeRaw), stderr: lines.slice(7).join('\n') };
  const baseFetched = fetch === '' ? undefined : fetch === 'ok';
  const headInClone = inClone === '' ? undefined : inClone === 'yes';
  const input = { headSha, baseRef, gitVersion, baseFetched, headInClone, mergeTree };
  write(`${JSON.stringify(foldBitbucketMergeable(row as { state?: unknown }, input))}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported; `pathToFileURL` for the macOS `/tmp`
// symlink reason `merge-subject.ts` records.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
