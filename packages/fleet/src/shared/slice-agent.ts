import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';

/**
 * Which charter a slice's own plan line names, read by the worker loop on a
 * fresh take-up and by fleetd's write probe before a start.
 *
 * A module of its own so that fleetd imports it without the worker loop's
 * entry, whose top-level block runs the loop.
 */

/** The file's text, or `null` where it cannot be read. */
const readOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Which plan files might name `branch` at all — a cheap textual prefilter,
 * never the answer. Mirrors `plan_declared_agent`'s own `grep -lF` in
 * `plot-dispatch.sh`, which the parser call below exists to narrow: the
 * ANNOTATION'S OWNER is decided by `plot-plan-meta.sh` alone, since a
 * substring match cannot tell a branch's own line from prose that mentions it
 * or from a different branch's annotation in the same file.
 *
 * @param planDir - the configured plan directory, absolute.
 * @param branch - the branch to search for.
 * @returns the `.md` paths under `planDir` whose text contains `branch`.
 */
export const plansMentioning = (planDir: string, branch: string): readonly string[] => {
  let names: readonly string[];
  try {
    names = readdirSync(planDir).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
  return names.map((n) => join(planDir, n)).filter((path) => (readOrNull(path) ?? '').includes(branch));
};

/**
 * One branch's row inside `plot-plan-meta.sh`'s `waves[].branches[]`, read
 * verbatim off the parser's JSON — the shape `agent_set`/`agent_of` emit.
 */
interface RawPlanBranch {
  readonly branch?: string;
  readonly agent?: string;
}

/** One plan document, as `plot-plan-meta.sh` emits it — only the field this reads. */
interface RawPlanMeta {
  readonly waves?: readonly { readonly branches?: readonly RawPlanBranch[] }[];
}

/**
 * Resolves a slice's own `agent:` charter name from the plan that declares it.
 *
 * READS THE PRESENCE OF THE KEY, NOT ITS TRUTHINESS, the same contract
 * `plan_declared_agent` reads: `plot-plan-meta.sh` emits no `agent` key at all
 * for a branch that names none, so `'agent' in row` is what tells *no
 * annotation* apart from an annotation whose value happens to be `''`.
 *
 * THE PARSER ANSWERS, NEVER A GREP OF THE PLAN FILE. {@link plansMentioning}
 * only narrows which files are worth asking; the branch-to-annotation binding
 * is `plot-plan-meta.sh`'s alone to make, since it alone knows which `###`
 * wave and which line the branch belongs to.
 *
 * @param repoRoot - the repo root the plan directory is relative to.
 * @param scriptDir - where the helper scripts live.
 * @param planDir - the configured plan directory, absolute.
 * @param branch - the branch a fresh take-up just assigned.
 * @returns the declared agent name, or `null` where the branch names none or
 *   cannot be found.
 */
export const sliceAgentOf = (repoRoot: string, scriptDir: string, planDir: string, branch: string): string | null => {
  const candidates = plansMentioning(planDir, branch);
  if (candidates.length === 0) return null;
  const read = scriptsShell({ repoRoot, scriptDir }).planMetaSync(candidates);
  if (!read.ok) return null;
  for (const line of read.value.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let meta: RawPlanMeta;
    try {
      meta = JSON.parse(trimmed) as RawPlanMeta;
    } catch {
      continue;
    }
    for (const wave of meta.waves ?? []) {
      for (const row of wave.branches ?? []) {
        if (row.branch === branch && 'agent' in row) return row.agent ?? '';
      }
    }
  }
  return null;
};
