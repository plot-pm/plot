import { planForBranch, type PlanMetaForBranch } from '@plot-pm/domain/rules/plan-for-branch';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-open-pr.sh` and `plot-record-pr.sh` both run,
 * once per invocation, to answer "which plan names this branch".
 *
 * ```
 * bash plot-plan-meta.sh <candidate1> <candidate2> ... | node plot-plan-for-branch.mjs <branch>
 * <file>\t<waveName>
 * ```
 *
 * Stdin is one `plot-plan-meta.sh` JSON object per line — each caller already
 * produces exactly that by running it once per grep-matched candidate. Prints
 * `<file>\t<waveName>` and exits 1 with nothing printed when no candidate
 * names the branch, or when none of the lines parse.
 *
 * **THE GREP STAYS IN SHELL.** Finding which plan FILES might name the branch
 * is a filesystem search — `grep -lF` over the plan directory — and moving it
 * here would mean this bundle reading the filesystem, which none of its
 * siblings do. This bundle is handed the parsed results, one per line, and
 * makes the one decision — which candidate, and under which wave — that both
 * callers used to each parse out of its own inline `node -e`.
 */

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Reads one `plot-plan-meta.sh` object per line from stdin, prints
 * `<file>\t<waveName>` for the first whose waves name `branch`, and returns
 * the process exit code — 0 for a match, 1 when none does.
 */
export const run = async (branch: string): Promise<number> => {
  const lines = (await readStdin()).split('\n').filter((line) => line.trim() !== '');
  const candidates = lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as PlanMetaForBranch];
    } catch {
      return [];
    }
  });
  const found = planForBranch(candidates, branch);
  if (!found) return 1;
  process.stdout.write(`${found.file}\t${found.waveName}`);
  return 0;
};

// Only when RUN, never when imported. See movable.ts for why pathToFileURL
// rather than a template comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [branch] = process.argv.slice(2);
  if (!branch) {
    process.stderr.write('usage: plot-plan-for-branch.mjs <branch>\n');
    process.exit(2);
  }
  process.exit(await run(branch));
}
