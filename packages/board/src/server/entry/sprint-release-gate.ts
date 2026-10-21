import { TRACKER_VERSION_SCHEMES, trackerShell, type ShellContext } from '@plot-pm/domain/adapters';
import { runProcess } from '@plot-pm/domain/adapters/run-script';
import { scriptPath } from '@plot-pm/domain/adapters/scripts';
import { sprintReleaseFactsShell } from '@plot-pm/domain/adapters/sprint-release';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import { sprintOwner } from '@plot-pm/domain/rules/issue-source';
import {
  releaseIsRead,
  resolveItemKey,
  sprintReleaseDrift,
  type SprintReleaseItem,
} from '@plot-pm/domain/rules/sprint-release';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Compares a Plot sprint's Must-haves against the Jira Release its
 * `Release:` field names, for `/plot-sprint` status and `/plot-release` step 0.
 *
 * ```
 * plot-sprint-release-gate.mjs [<sprint-slug>]
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
 * **NO TRACKER, OR A NON-JIRA ONE, IS NOT A REFUSAL.** The Release is read
 * only where `releaseIsRead` answers `true`: Plot owns the sprint and the
 * declared tracker's scheme is in `TRACKER_VERSION_SCHEMES`. Every other
 * repository answers `sprints: []`, asks no tracker, and reports no drift.
 *
 * The bundle runs `plot-sprint-release.sh` with its arguments and reads the
 * report from its stdout. `--stdin` reads the report from stdin instead and
 * runs no collector.
 *
 * **THE OWNER CHECK READS NO INPUT.** `--stdin` with `{}` asks only whether Plot
 * owns this repository's sprints: exit 3 or `{"sprints":[]}`. `/plot-sprint`
 * opens with that call, so a broken collector cannot stop `create`.
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

/** One Must-have as `plot-sprint-release.sh` reports it, enriched with its plan's raw issues array and `ticket:` frontmatter. */
interface ReportedMust {
  text?: unknown;
  issues?: unknown;
  ticket?: unknown;
}

/** An `issues` array entry read as a string, or `''` where it is not one — `resolveItemKey` itself filters for Jira shape. */
const issueLineKeys = (issues: unknown): readonly string[] => {
  if (!Array.isArray(issues)) return [];
  return issues.filter((v): v is string => typeof v === 'string');
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
      readonly notCompared: readonly SprintReleaseItem[];
    }
  | { readonly checked: false; readonly unreachable: true; readonly reason: string };

/** What the gate answered, per sprint that declared a `Release:` target. */
export interface Verdict {
  readonly sprints: readonly { readonly sprint: string; readonly release: string; readonly verdict: SprintVerdict }[];
}

/**
 * Reads one sprint block's Must-haves off the collector's JSON.
 *
 * Each Must-have's key is resolved by {@link resolveItemKey}, never guessed at
 * here: the `Issue:` line, `ticket:` frontmatter and item text are collected
 * from the report and handed to the domain, in that fixed order.
 *
 * @param block - one sprint's object from the report.
 * @param sprint - the sprint's slug, for the error it may throw.
 * @param ticketPrefixes - this repository's `Ticket prefixes`, for the item-text fallback.
 * @returns the sprint's Must-haves, each carrying the issue key resolution found.
 * @throws when the block's `must` is not a list or a Must-have is malformed.
 */
const mustHavesFrom = (block: ReportedSprint, sprint: string, ticketPrefixes: readonly string[]): SprintReleaseItem[] => {
  const mustHaves: SprintReleaseItem[] = [];
  const raw = block.must;
  if (raw === undefined) return mustHaves;
  if (!Array.isArray(raw)) throw new Error(`sprint '${sprint}' has a 'must' that is not a list`);
  for (const entry of raw as ReportedMust[]) {
    const text = typeof entry.text === 'string' ? entry.text : '';
    const ticket = typeof entry.ticket === 'string' ? entry.ticket : '';
    mustHaves.push({
      text,
      issue: resolveItemKey(issueLineKeys(entry.issues), ticket, text, ticketPrefixes),
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
 * @param ticketPrefixes - this repository's `Ticket prefixes`, for each Must-have's key resolution.
 * @returns the gate's input.
 * @throws when the JSON is unreadable or a sprint block is malformed.
 */
export const inputFrom = (text: string, ticketPrefixes: readonly string[] = []): GateInput => {
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
      releases.push({ sprint, release, mustHaves: mustHavesFrom(block, sprint, ticketPrefixes) });
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

/** What `run` reaches outside the process, replaceable in a test. */
export interface GateWorld {
  /** Reads one `## Plot Config` key's value; `''` where none is declared. */
  readonly config: (key: string) => Promise<string>;
  /** Builds the connector the repository declared. */
  readonly tracker: () => Promise<Tracker>;
}

/**
 * The world `run` reaches by default: `plot-config.sh` and `trackerShell`.
 *
 * @param context - where the scripts and the repository are.
 * @returns the config reader and tracker builder for that repository.
 */
export const shellWorld = (context: ShellContext): GateWorld => ({
  config: (key) => configShell(context, key),
  tracker: () => trackerShell(context),
});

/**
 * Reads the collector's report, answers the gate, prints the verdict.
 *
 * @param text - the collector's report.
 * @param world - the config reader and tracker builder.
 * @param write - where the verdict goes.
 * @param warn - where a refusal's sentence goes.
 * @returns the process exit code — 0 checked (or nothing to check), 2 unreadable input, 3 external sprint owner.
 */
export const run = async (
  text: string,
  world: GateWorld,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  const [declaredSprintOwner, declaredTracker, declaredTicketPrefixes] = await Promise.all([
    world.config('Sprint owner'),
    world.config('Tracker'),
    world.config('Ticket prefixes'),
  ]);
  const ticketPrefixes = declaredTicketPrefixes
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  let input: GateInput;
  try {
    input = inputFrom(text, ticketPrefixes);
  } catch (err) {
    warn(`plot-sprint-release-gate: ${(err as Error).message}\n`);
    return EXIT.usage;
  }
  const owner = sprintOwner(declaredSprintOwner, declaredTracker);
  if (owner.owns === 'external') {
    warn(
      `plot-sprint-release-gate: this repository's sprints are owned by its '${owner.scheme}' tracker — Plot does not read or write a sprint here.\n`,
    );
    return EXIT.externalOwner;
  }
  // NO VERSION READ, NO TRACKER BUILT: a repository whose tracker has no
  // Release, or that declared none, reports no drift line at all.
  if (!releaseIsRead(owner, declaredTracker, TRACKER_VERSION_SCHEMES) || input.releases.length === 0) {
    write(`${JSON.stringify({ sprints: [] })}\n`);
    return EXIT.ok;
  }
  const answered = await verdict(input, await world.tracker());
  write(`${JSON.stringify(answered)}\n`);
  return EXIT.ok;
};

/** Runs the collector with the bundle's arguments and returns its report; `''` where it wrote nothing. */
export type Collect = (args: readonly string[]) => Promise<string>;

/**
 * Picks where the collector's report comes from, then answers the gate.
 *
 * @param argv - the bundle's arguments: `--stdin`, or the collector's own (one sprint slug, or none).
 * @param collect - runs the collector.
 * @param readStdin - reads the whole of stdin.
 * @param world - the config reader and tracker builder.
 * @param write - where the verdict goes.
 * @param warn - where a refusal's sentence goes.
 * @returns the process exit code — 0 checked (or nothing to check), 2 unreadable input, 3 external sprint owner.
 */
export const main = async (
  argv: readonly string[],
  collect: Collect,
  readStdin: () => Promise<string>,
  world: GateWorld,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  if (argv[0] === '--stdin') return run(await readStdin(), world, write, warn);
  const facts = await collect(argv);
  if (facts === '') {
    warn('plot-sprint-release-gate: plot-sprint-release.sh reported nothing — the sprint estate could not be read.\n');
    return EXIT.usage;
  }
  return run(facts, world, write, warn);
};

// Only when RUN, never when imported. `pathToFileURL` rather than a template,
// for the reason `panel.ts` records: `import.meta.url` is realpath-resolved.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const context: ShellContext = {
    repoRoot: process.env.PLOT_REPO_ROOT ?? process.cwd(),
    scriptDir: process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..'),
  };
  const readStdin = async (): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  };
  const collect: Collect = (args) => sprintReleaseFactsShell(context, args);
  process.exit(await main(process.argv.slice(2), collect, readStdin, shellWorld(context)));
}
