// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { controllerInvocation } from '@plot-pm/domain/rules/ci-suite';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Which controller-owned action a command runs — the rule `controllerInvocation`
 * reached without HTTP, for `plot-controller-gate.sh`'s token loop, which could
 * not be unit tested while the decision lived in shell (#1245).
 *
 * ```
 * printf '%s' "$CMD_SCAN" | plot-controller-invocation.mjs
 * dispatch|approve|deliver|release    # exit 0 — the action a receipt must cover
 * # exit 0, no output                 # the command runs none of the three
 * # exit 2 — stdin could not be read
 * ```
 *
 * READ THE EXIT CODE, NOT THE OUTPUT'S EMPTINESS. `null` prints nothing, and
 * so does a failed read; only the exit code tells them apart. The gate's own
 * refusal rule is: a command that passed its prefilter and cannot be checked
 * is refused, never allowed — so a caller reading only stdout would license
 * exactly the case this bundle exists to close.
 *
 * Its own bundle for the reason the entries beside it give: this runs on
 * every Bash call that passes the gate's per-word prefilter, and
 * `plot-local-checks.mjs` is a 528 KB bundle built for a different question.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The command was read; the action, or nothing, is on stdout. */
  ok: 0,
  /** stdin could not be read. */
  usage: 2,
} as const;

/**
 * Answers which controller-owned action, if any, the command on stdin runs.
 *
 * @param stdin - the command line, with any single-quoted heredoc body
 *   already stripped by the caller.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (stdin: string, write: (s: string) => void = (s) => process.stdout.write(s)): number => {
  if (stdin === '') return EXIT.usage;
  const action = controllerInvocation(stdin);
  if (action !== null) write(`${action}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: on macOS `/tmp` is a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
