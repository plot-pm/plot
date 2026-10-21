import { trackerShell, type ShellContext } from '@plot-pm/domain/adapters';
import { runProcess } from '@plot-pm/domain/adapters/run-script';
import { scriptPath } from '@plot-pm/domain/adapters/scripts';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import { sprintOwner } from '@plot-pm/domain/rules/issue-source';
import { sprintReleaseDrift, type SprintReleaseItem } from '@plot-pm/domain/rules/sprint-release';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Compares a Plot sprint's Must-haves against the Jira Release its
 * `Release:` field names, for `/plot-sprint` status and `/plot-release` step 0.
 *
 * ```
 * plot-sprint-release.sh | plot-sprint-release-gate.mjs
 * {"sprints":[{"sprint":"test-sprint","release":"2.0.0","verdict":{"checked":true,"missingFromRelease":[],"missingFromSprint":[]}}]}
 * ```
 *
 * **THE SPRINT-OWNER DECLINE IS A REFUSAL HERE, NOT A SENTENCE A SKILL PRINTS.**
 * `sprintOwner()` had zero callers before this: the decline existed as prose in
 * `plot-sprint/SKILL.md` and `plot-release/SKILL.md`, which a reader — or a
 * future edit — could skip. `owns: 'external'` exits 3 and nothing past it
 * runs, the same shape `plot-release-gate.sh` already uses for the Must-Have
 * gate.
 *
 * **NO TRACKER, OR A NON-JIRA ONE, IS NOT A REFUSAL.** The plan is explicit:
 * the Release is read only when the tracker is Jira. A repository with no
 * tracker, or a GitHub-issues one, is told nothing is being checked rather than
 * refused — `sprints: []` with no entries, because there is nothing to compare.
 *
 * **EVERY ACTIVE SPRINT, MIRRORING `release-gate.ts`'s `itemsFrom`.** Two teams
 * may share one train, so this reads `report.sprints[]` directly rather than a
 * pre-flattened single-sprint shape, and answers one verdict per sprint that
 * declares a `Release:` target.
 *
 * **A SPRINT WITH NO `Release:` FIELD CONTRIBUTES NO ENTRY, deliberately the
 * regression a careless early-return would most easily break.** It must behave
 * exactly as it did before this bundle existed: no network call, nothing to
 * report.
 *
 * **`unaskable` (version-not-found) AND `failed` (tracker unreachable) ARE
 * NAMED, NEVER ONE GENERIC MESSAGE.** A version Jira does not have and a Jira
 * instance Plot could not reach are different facts a person acts on
 * differently — one means the `Release:` field is wrong, the other means ask
 * again later.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The gate passed — `checked` says whether a comparison ran. */
  ok: 0,
  /** The input was unreadable — a broken installation, not a sprint's state. */
  usage: 2,
  /** `sprintOwner()` answered `external`: Plot does not own this sprint. */
  externalOwner: 3,
} as const;

/** One Must-have as `plot-sprint-release.sh` reports it, enriched with its plan's raw issues array. */
interface ReportedMust {
  text?: unknown;
  issues?: unknown;
}

/** Matches a Jira-shaped key (`PROJ-123`) and nothing else — never a bare GitHub issue number. */
const JIRA_KEY = /^[A-Z][A-Z0-9]*-[0-9]+$/;

/**
 * The first Jira-shaped key in a plan's `issues` array, read in the sorted
 * order `plot-plan-meta.sh` already produces (GitHub numbers first, Jira keys
 * after) — so this picks the first of the latter rather than guessing from a
 * Must-have's own text. `''` where the plan names no Jira key.
 */
const firstJiraKey = (issues: unknown): string => {
  if (!Array.isArray(issues)) return '';
  const hit = issues.find((v) => typeof v === 'string' && JIRA_KEY.test(v));
  return typeof hit === 'string' ? hit : '';
};

/** One sprint's block of the collector's report. */
interface ReportedSprint {
  sprint?: unknown;
  release?: unknown;
  must?: unknown;
}

/** The collector's whole report, as `plot-sprint-release.sh` writes it. */
interface Report {
  sprints?: unknown;
  limit?: unknown;
}

/** What the caller asked this bundle to check. */
export interface GateInput {
  /** Every sprint declaring a `Release:` target, each with its own Must-haves. */
  releases: readonly { readonly sprint: string; readonly release: string; readonly mustHaves: readonly SprintReleaseItem[] }[];
  /** How many issues a page of `versionRead` may answer. */
  limit: number;
}

/** One sprint's verdict. */
export type SprintVerdict =
  | { readonly checked: false }
  | {
      readonly checked: true;
      readonly missingFromRelease: readonly SprintReleaseItem[];
      readonly missingFromSprint: readonly string[];
    }
  | { readonly checked: false; readonly unreachable: true; readonly reason: string };

/** What the gate answered, per sprint that declared a `Release:` target. */
export interface Verdict {
  readonly sprints: readonly { readonly sprint: string; readonly release: string; readonly verdict: SprintVerdict }[];
}

/**
 * Reads one sprint block's Must-haves off the collector's JSON.
 *
 * @param block - one sprint's object from the report.
 * @param sprint - the sprint's slug, for the error it may throw.
 * @returns the sprint's Must-haves, each carrying the issue key its plan names.
 * @throws when the block's `must` is not a list or a Must-have is malformed.
 */
const mustHavesFrom = (block: ReportedSprint, sprint: string): SprintReleaseItem[] => {
  const mustHaves: SprintReleaseItem[] = [];
  const raw = block.must;
  if (raw === undefined) return mustHaves;
  if (!Array.isArray(raw)) throw new Error(`sprint '${sprint}' has a 'must' that is not a list`);
  for (const entry of raw as ReportedMust[]) {
    mustHaves.push({
      text: typeof entry.text === 'string' ? entry.text : '',
      issue: firstJiraKey(entry.issues),
    });
  }
  return mustHaves;
};

/**
 * Reads the gate's input off the collector's JSON.
 *
 * **EVERY SPRINT DECLARING A `Release:` TARGET**, mirroring `release-gate.ts`'s
 * `itemsFrom` — two teams may share one train, and the collector already
 * reports every active sprint rather than picking one.
 *
 * @param text - the collector's report.
 * @returns the gate's input.
 * @throws when the JSON is unreadable or a sprint block is malformed.
 */
export const inputFrom = (text: string): GateInput => {
  let report: Report;
  try {
    report = JSON.parse(text) as Report;
  } catch (err) {
    throw new Error(`could not read the sprint report: ${(err as Error).message}`);
  }
  const sprints = report.sprints;
  const releases: { sprint: string; release: string; mustHaves: SprintReleaseItem[] }[] = [];
  if (sprints !== undefined) {
    if (!Array.isArray(sprints)) throw new Error("the sprint report's 'sprints' is not a list");
    for (const block of sprints as ReportedSprint[]) {
      const sprint = typeof block.sprint === 'string' ? block.sprint : '';
      const release = typeof block.release === 'string' ? block.release : '';
      // A sprint naming no Release says nothing about one — it contributes no
      // entry rather than one this bundle would have to skip downstream.
      if (release.trim() === '') continue;
      releases.push({ sprint, release, mustHaves: mustHavesFrom(block, sprint) });
    }
  }
  return {
    releases,
    limit: typeof report.limit === 'number' && report.limit > 0 ? report.limit : 200,
  };
};

/**
 * Reads a `## Plot Config` key through `plot-config.sh`, the same call
 * `trackerShell` already makes for `Tracker` — mirrored here for `Sprint
 * owner` rather than threading it through the collector's JSON, which would
 * read the key from shell AND from here.
 *
 * @param context - where the scripts and the repository are.
 * @param key - the config key's exact name.
 * @returns the key's value, verbatim; `''` where none is declared or the read failed.
 */
const configShell = async (context: ShellContext, key: string): Promise<string> => {
  const said = await runProcess('bash', [scriptPath(context, 'plot-config.sh'), 'get', key, ''], {
    cwd: context.repoRoot,
  });
  return said.code === 0 ? said.stdout.trim() : '';
};

/**
 * Asks the domain for one sprint's Jira Release comparison.
 *
 * @param release - the sprint's `Release:` field, verbatim.
 * @param mustHaves - the sprint's Must-haves, each with the issue key its plan names.
 * @param limit - how many issues a page of `versionRead` may answer.
 * @param tracker - the connector the repository declared.
 * @returns the sprint's verdict.
 */
const sprintVerdict = async (
  release: string,
  mustHaves: readonly SprintReleaseItem[],
  limit: number,
  tracker: Tracker,
): Promise<SprintVerdict> => {
  const read = await tracker.versionRead(release.trim(), limit);
  if (!read.ok) {
    // `unaskable` AND `failed` ARE NAMED, NEVER FOLDED into one sentence: a
    // wrong `Release:` field and an unreachable Jira are different facts.
    const reason =
      read.why === 'unaskable'
        ? (read.reason ?? 'the tracker cannot answer a version read')
        : 'the tracker could not be reached';
    return { checked: false, unreachable: true, reason };
  }
  const drift = sprintReleaseDrift(mustHaves, read.value.issues.map((i) => i.id));
  return { checked: true, ...drift };
};

/**
 * Asks the domain for the gate's verdict: the sprint-owner refusal is checked
 * by the caller first; this answers the Jira Release comparison for every
 * sprint that declared a target.
 *
 * @param input - what the caller asked.
 * @param tracker - the connector the repository declared.
 * @returns the verdict, one entry per sprint declaring a `Release:` target.
 */
export const verdict = async (input: GateInput, tracker: Tracker): Promise<Verdict> => {
  // NOTHING TO COMPARE ASKS NO TRACKER. No sprint naming a Release behaves
  // exactly as it did before this bundle existed — the regression this gate
  // must not cause.
  const sprints = await Promise.all(
    input.releases.map(async ({ sprint, release, mustHaves }) => ({
      sprint,
      release,
      verdict: await sprintVerdict(release, mustHaves, input.limit, tracker),
    })),
  );
  return { sprints };
};

/**
 * Reads stdin, answers the gate, prints the verdict.
 *
 * @param text - the whole of stdin: the collector's report.
 * @param context - where the scripts and the repository are.
 * @param write - where the verdict goes.
 * @param warn - where a refusal's sentence goes.
 * @returns the process exit code — 0 checked (or nothing to check), 2 unreadable input, 3 external sprint owner.
 */
export const run = async (
  text: string,
  context: ShellContext,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  let input: GateInput;
  try {
    input = inputFrom(text);
  } catch (err) {
    warn(`plot-sprint-release-gate: ${(err as Error).message}\n`);
    return EXIT.usage;
  }
  const [declaredSprintOwner, declaredTracker] = await Promise.all([
    configShell(context, 'Sprint owner'),
    configShell(context, 'Tracker'),
  ]);
  const owner = sprintOwner(declaredSprintOwner, declaredTracker);
  if (owner.owns === 'external') {
    warn(
      `plot-sprint-release-gate: this repository's sprints are owned by its '${owner.scheme}' tracker — Plot does not read or write a sprint here.\n`,
    );
    return EXIT.externalOwner;
  }
  const tracker = await trackerShell(context);
  const answered = await verdict(input, tracker);
  write(`${JSON.stringify(answered)}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported. `pathToFileURL` rather than a template,
// for the reason `panel.ts` records: `import.meta.url` is realpath-resolved.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const context: ShellContext = {
    repoRoot: process.env.PLOT_REPO_ROOT ?? process.cwd(),
    scriptDir: process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..'),
  };
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(await run(Buffer.concat(chunks).toString('utf8'), context));
}
