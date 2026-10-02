// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { checkoutYield, type CheckoutReading, type CheckoutReadings } from '@plot-pm/domain/rules/checkout-yield';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Whether the worktree holding a branch may be removed so an agent handed that
 * branch can take it — the rule `checkoutYield` reached without HTTP, for
 * `plot-worker-loop.sh`'s `reset_desk`.
 *
 * ```
 * printf '%s\t%s\t%s\t%s\t%s\t%s' \
 *   "$live" "$blocked" "$dirty" "$unpushed" "$registered" "$main" |
 *   plot-checkout-yield.mjs
 * yields                 # exit 0 — one `git worktree remove` is licensed
 * keep	<condition>       # exit 0 — the first condition that holds
 * # exit 2 — the readings line could not be read
 * ```
 *
 * Six tab-separated readings on stdin, each `1`, `0` or `unknown`, in the order
 * the rule tests them. Any other word — an empty field included — is
 * `unknown` rather than `0`, because a reading the shell could not take must
 * never read as a measured absence: that is the direction in which a removal
 * destroys work.
 *
 * READ THE EXIT CODE, NOT THE OUTPUT'S EMPTINESS. Exit 2 means the rule could
 * not be asked, and a caller reading only stdout would take an empty answer for
 * `yields`. The loop keeps the checkout on anything but `yields`.
 *
 * Its own bundle for the reason the entries beside it give: `plot-ask.mjs`
 * answers by RUNNING `plot-fleet-scan.sh`, so a loop asking whether one
 * checkout yields would start an 18.3 s fleet scan to read six words. It reads
 * stdin, spawns nothing and opens nothing.
 *
 * The cost rule permits it ON FREQUENCY. `docs/shell-and-domain.md` §1 names
 * this loop as the script that duplicates a rule, because a hop on its idle
 * pass is paid by every agent on every pass. This call fires only when
 * `reset_desk`'s two checkouts both fail — once per take-up, never per pass —
 * on a path that already runs git four times.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The answer is `yields` or `keep`. */
  ok: 0,
  /** The readings line could not be read. */
  usage: 2,
} as const;

/** How many readings the line carries, in the order the rule tests them. */
const FIELDS = 6;

/**
 * One reading as the shell wrote it.
 *
 * `1` is true and `0` is false; EVERYTHING ELSE IS `unknown`, an empty field
 * included. A shell that could not take a reading writes `unknown`, and one
 * that writes nothing has equally failed to measure — reading either as `0`
 * would license the removal the rule exists to refuse.
 */
const reading = (word: string): CheckoutReading => {
  if (word === '1') return true;
  if (word === '0') return false;
  return 'unknown';
};

/**
 * Answers for the readings that arrived on stdin.
 *
 * @param stdin - six tab-separated readings: live worker, blocked marker,
 *   uncommitted changes, unpushed commits, registered, main checkout.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (stdin: string, write: (s: string) => void = (s) => process.stdout.write(s)): number => {
  const words = stdin.replace(/\r?\n$/, '').split('\t');
  if (words.length !== FIELDS) return EXIT.usage;
  const [live = '', blocked = '', dirty = '', unpushed = '', registered = '', main = ''] = words;
  const readings: CheckoutReadings = {
    liveWorker: reading(live),
    blockedMarker: reading(blocked),
    uncommittedChanges: reading(dirty),
    unpushedCommits: reading(unpushed),
    registered: reading(registered),
    mainCheckout: reading(main),
  };
  const answer = checkoutYield(readings);
  write(answer.yields ? 'yields\n' : `keep\t${answer.condition}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: on macOS `/tmp` is a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
