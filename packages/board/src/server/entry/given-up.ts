import { readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { branchGivenUpBy, type PlanBranchLines } from '@plot-pm/domain/rules/branch-given-up';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The `node` entry point section 3 of `plot-reconcile-scan.sh` runs, once per
 * reconcile pass.
 *
 * ```
 * <plot-plan-meta.sh JSON lines> | node plot-given-up.mjs docs/plans/active
 * bug/a	docs/plans/2026-11-02-x.md	2026-11-02
 * ```
 *
 * Reads one `plot-plan-meta.sh` JSON object per line on stdin and the Active
 * index directory as its argument. Prints one tab-separated row per branch the
 * plans gave up: branch, plan file, date or `undated`. The decision is
 * `branchGivenUpBy`'s; this holds no copy of it.
 *
 * Exit 0 after answering, 2 when a line is not parseable JSON or the Active
 * index directory is not given. An unreadable Active index directory links no plan.
 * A plan is active when an entry in that directory resolves to its file.
 */

interface MetaLine {
  file?: string;
  waves?: ReadonlyArray<{
    branches?: ReadonlyArray<{ branch: string; deferred?: boolean; deferred_reason?: string }>;
  }>;
}

/**
 * Resolves a path, leaving it as given when it does not resolve.
 *
 * @param file - a plan path.
 * @returns the real path.
 */
const realPathOf = (file: string): string => {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};

/**
 * Reads the answer rows.
 *
 * @param text - the whole of stdin.
 * @param activeFiles - real paths of the plans the Active index links.
 * @returns the tab-separated rows, in first-seen branch order.
 * @throws when a line is not a JSON object.
 */
export const rowsFor = (text: string, activeFiles: ReadonlySet<string>): string[] => {
  const plans: PlanBranchLines[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`not valid JSON: '${line}'`);
    }
    if (typeof parsed !== 'object' || parsed === null) throw new Error(`expected an object, got '${line}'`);
    const meta = parsed as MetaLine;
    const file = meta.file ?? '';
    plans.push({
      active: activeFiles.has(realPathOf(file)),
      file,
      slices: (meta.waves ?? []).map((wave) => ({
        branches: (wave.branches ?? []).map((b) => ({
          branch: b.branch,
          deferred: b.deferred === true,
          reason: b.deferred_reason ?? '',
        })),
      })),
    });
  }
  const names = new Set<string>();
  for (const plan of plans) for (const slice of plan.slices) for (const b of slice.branches) if (b.deferred) names.add(b.branch);
  const rows: string[] = [];
  for (const name of names) {
    const by = branchGivenUpBy(name, plans);
    if (by !== null) rows.push(`${name}\t${by.file}\t${by.date ?? 'undated'}`);
  }
  return rows;
};

/**
 * Runs the entry.
 *
 * @param text - the whole of stdin.
 * @param activeDir - the Active index directory, or `undefined` when not given.
 * @param write - where each row goes.
 * @returns the exit code.
 */
export const run = (
  text: string,
  activeDir: string | undefined,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  if (activeDir === undefined || activeDir === '') {
    process.stderr.write('plot-given-up: the Active index directory is the one argument\n');
    return 2;
  }
  const linked = new Set<string>();
  try {
    for (const name of readdirSync(activeDir)) if (name.endsWith('.md')) linked.add(realPathOf(join(activeDir, name)));
  } catch {
    // An unreadable Active index links nothing.
  }
  try {
    for (const row of rowsFor(text, linked)) write(`${row}\n`);
  } catch (err) {
    process.stderr.write(`plot-given-up: ${(err as Error).message}\n`);
    return 2;
  }
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  void endEntry(run(Buffer.concat(chunks).toString('utf8'), process.argv[2]));
}
