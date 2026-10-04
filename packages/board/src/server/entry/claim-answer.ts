// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { claimAnswer, type ClaimHolderAnswer } from '@plot-pm/domain/rules/claim';
import { commitSubjectsOf } from '@plot-pm/domain/adapters/refs/refs-git';
import type { RemoteHeadAnswer } from '@plot-pm/domain/ports/refs';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * What a branch's ref and its live holders say about a claim on it — the rule
 * `claimAnswer` reached without HTTP, for `plot-dispatch.sh --release` and
 * `plot-worker-loop.sh`'s rejected-push path.
 *
 * ```
 * echo '{"ref":"present","log":"","holders":["agent-a"]}' | plot-claim-answer.mjs
 * held-by-agent	agent-a
 * ```
 *
 * **THE CALLERS PASS COMMITS AND NEVER CLASSIFY THEM, AND NEITHER DOES THIS
 * ENTRY'S CALLER.** `log` is the RAW `git log --boundary
 * --format='%m|%H|%T|%P|%at|%s'` stream, parsed here by {@link commitSubjectsOf}
 * — the same parser `Refs.commitSubjects` uses — rather than by a second
 * implementation in shell or `jq`, which would be free to drift from it.
 *
 * **`holders` MUST ALREADY EXCLUDE THE ASKER.** `claimAnswer` takes this on
 * faith — see its own doc. `--release` has no asker and excludes nobody; the
 * loop excludes the manifest it owns.
 */

/** What arrives on stdin. */
interface Readings {
  /** Whether the branch's remote-tracking ref exists. */
  ref: RemoteHeadAnswer;
  /**
   * The raw `git log --boundary --format='%m|%H|%T|%P|%at|%s'` stream, or
   * `null` where the caller's own git call failed — never coerced to `''`,
   * which `commitSubjectsOf` would read as a ref with no commit ahead rather
   * than a reading that could not be taken.
   */
  log: string | null;
  /** The live agents holding the branch, the asker already excluded. */
  holders: readonly string[];
}

/** One line in, one line out: the answer, then every holder, tab-separated. */
export const run = (
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  let parsed: Readings;
  try {
    parsed = JSON.parse(stdin) as Readings;
  } catch (err) {
    warn(`plot-claim-answer: not JSON: ${(err as Error).message}\n`);
    return 2;
  }

  const answer: ClaimHolderAnswer = claimAnswer({
    ref: parsed.ref,
    commits: parsed.log === null ? { ok: false, why: 'failed' } : { ok: true, value: commitSubjectsOf(parsed.log) },
    holders: parsed.holders,
  });
  write([answer, ...parsed.holders].join('\t') + '\n');
  return 0;
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: on macOS `/tmp` is a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
