import { planForBranch, type PlanMetaForBranch } from '@plot-pm/domain/rules/plan-for-branch';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-open-pr.sh` and `plot-record-pr.sh` both run,
 * once per invocation, to answer "which plan names this branch".
 *
 * ```
 * echo '{"branch":"…","candidates":[{"file":"…","waves":[…]}]}' | node plot-plan-for-branch.mjs
 * <file>\t<waveName>
 * ```
 *
 * Prints `<file>\t<waveName>` — the exact shape both shell callers already
 * pass around as `found` — and exits 1 with nothing printed when no candidate
 * names the branch.
 *
 * **THE GREP STAYS IN SHELL.** Finding which plan FILES might name the branch
 * is a filesystem search — `grep -lF` over the plan directory — and moving it
 * here would mean this bundle reading the filesystem, which none of its
 * siblings do. Both callers already run `plot-plan-meta.sh` once per
 * candidate; this bundle is handed the parsed results and makes the one
 * decision — which candidate, and under which wave — that both callers used
 * to each parse out of its own inline `node -e`.
 */

/** What a caller asks. */
interface Request {
  readonly branch: string;
  readonly candidates: readonly PlanMetaForBranch[];
}

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Reads a {@link Request} from stdin, prints `<file>\t<waveName>`, and
 * returns the process exit code — 0 for a match, 1 when none of the
 * candidates name the branch.
 */
export const run = async (): Promise<number> => {
  const { branch, candidates } = JSON.parse(await readStdin()) as Request;
  const found = planForBranch(candidates, branch);
  if (!found) return 1;
  process.stdout.write(`${found.file}\t${found.waveName}`);
  return 0;
};

// Only when RUN, never when imported. See movable.ts for why pathToFileURL
// rather than a template comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(await run());
}
