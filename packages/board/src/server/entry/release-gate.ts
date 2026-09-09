import type { ItemStatus, MoscowTier } from '@plot-pm/domain/entities/sprint';
import {
  release,
  type ReleaseDetail,
  type ReleaseSprintItem,
} from '@plot-pm/domain/workflows/release';
import { refused, type Decision } from '@plot-pm/domain/workflows/decision';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-release-gate.sh` runs, once per release.
 *
 * ```
 * plot-sprint-release.sh | node plot-release-gate.mjs
 * pass
 * ```
 *
 * **THE FACTS WERE ALREADY COLLECTED AND THE JUDGEMENT WAS STILL PROSE.**
 * `plot-sprint-release.sh` reports every MoSCoW item's state and decides
 * nothing, deliberately and correctly. `/plot-release` then applied the rule in
 * skill text: an open Must refuses, a `disputed` blocks like an open one, a
 * `withdrawn` is named and never gates. `workflows/release.ts` holds that same
 * rule, carries a full test file, and — measured 2026-09-09 — is imported by
 * nothing outside `packages/domain/`. This bundle is the wire.
 *
 * **A RELEASE IS THE ONE ACTION NOBODY CAN UNDO.** A tag is public and a
 * published package cannot be recalled, which is why the gate in front of it is
 * a refusal rather than a paragraph a reader may skim past.
 *
 * **IT ANSWERS THE GATE AND NOT THE RELEASE.** `release` decides step 0's gate,
 * step 1's version and step 5b's plan records in one call; this asks only for
 * step 0, which runs before a version exists. So the readings it does not have
 * are supplied at their empty spelling and the workflow's own ordering does the
 * rest: the Must-Have gate is answered before the version is read, so a run
 * carrying no version still reaches the verdict this asks for. A bundle that
 * demanded a version to answer a gate that precedes one would refuse the
 * question rather than answer it.
 *
 * **THE OPERATOR'S APPROVAL STAYS REQUIRED AND STAYS SEPARATE.** This prints a
 * verdict and tags nothing, writes nothing and pushes nothing. It is the gate in
 * front of the approval, not a replacement for it — a `pass` says the sprint
 * does not object, and a person still names the version.
 *
 * **AN EIGHTEENTH artifact, for the reason `entry/sprint-transition.ts` gives.**
 * `plot-ask.mjs` answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh`, so
 * a script asking that artifact for a verdict would be a script calling an
 * artifact that calls a script. This one spawns nothing and reads nothing — the
 * facts arrive on stdin, as the collector already emits them.
 */

/** One item as `plot-sprint-release.sh` writes it. */
interface ReportedItem {
  slug?: unknown;
  state?: unknown;
}

/** One sprint's block of the collector's report. */
interface ReportedSprint {
  sprint?: unknown;
  must?: unknown;
  should?: unknown;
  could?: unknown;
}

/** The collector's whole report. */
interface Report {
  sprints?: unknown;
}

/** The four words `scoreItem` answers with, as the collector spells them. */
const STATUSES: readonly ItemStatus[] = ['done', 'open', 'disputed', 'withdrawn'];

/**
 * Read one tier's items out of a sprint's block.
 *
 * A status the collector could not produce is NOT coerced to a permissive one:
 * the permissive direction here reports a promise as kept, and a release cut
 * over it cannot be un-cut.
 *
 * @param block - one sprint's object from the report.
 * @param tier - the tier being read, as the domain names it.
 * @param key - the tier's key, as the collector names it.
 * @param sprint - the sprint's slug, carried onto each item.
 * @returns the tier's items.
 * @throws when an item names no plan or carries a status this wire does not.
 */
const tierFrom = (
  block: ReportedSprint,
  tier: MoscowTier,
  key: 'must' | 'should' | 'could',
  sprint: string,
): ReleaseSprintItem[] => {
  const raw = block[key];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`sprint '${sprint}' has a '${key}' that is not a list`);
  }
  return raw.map((entry: ReportedItem) => {
    const status = entry.state;
    if (typeof status !== 'string' || !STATUSES.includes(status as ItemStatus)) {
      throw new Error(
        `sprint '${sprint}' has a '${key}' item whose state is '${String(status)}' — expected done, open, disputed or withdrawn`,
      );
    }
    return {
      sprint,
      tier,
      // A lightweight task names no plan and the collector writes `""`. It is
      // carried through rather than dropped: an unfinished item with no plan is
      // still a promise the sprint made, and the gate names it by its text
      // being empty rather than by not appearing at all.
      plan: typeof entry.slug === 'string' ? entry.slug : '',
      status: status as ItemStatus,
    };
  });
};

/**
 * Read every sprint's items out of the collector's report.
 *
 * **EVERY ACTIVE SPRINT, because two teams may share one train.** The collector
 * reports them all and each item carries its own sprint, so a refusal names
 * which sprint each unfinished Must came from.
 *
 * A sprint declaring no `Release:` target contributes nothing: the gate does not
 * apply to it, which is the majority case and must stay silent.
 *
 * @param text - the collector's JSON.
 * @returns every governing item, across every sprint that declares a target.
 * @throws when the JSON is unreadable or an item is malformed.
 */
export const itemsFrom = (text: string): ReleaseSprintItem[] => {
  let report: Report;
  try {
    report = JSON.parse(text) as Report;
  } catch (err) {
    throw new Error(`could not read the sprint report: ${(err as Error).message}`);
  }
  const sprints = report.sprints;
  if (sprints === undefined) return [];
  if (!Array.isArray(sprints)) {
    throw new Error("the sprint report's 'sprints' is not a list");
  }
  const items: ReleaseSprintItem[] = [];
  for (const block of sprints as ReportedSprint[]) {
    const slug = typeof block.sprint === 'string' ? block.sprint : '';
    // No `Release:` target means this sprint says nothing about a release, so
    // its items govern nothing. Read as the collector writes it: `""`.
    if (typeof (block as { release?: unknown }).release !== 'string') continue;
    if ((block as { release: string }).release.trim() === '') continue;
    items.push(
      ...tierFrom(block, 'must', 'must', slug),
      ...tierFrom(block, 'should', 'should', slug),
      ...tierFrom(block, 'could', 'could', slug),
    );
  }
  return items;
};

/** How the caller answered the gate's two escapes. */
export interface GateInput {
  /** Whether this cuts a release candidate rather than a release. */
  candidate: boolean;
  /** The named escape past the Must-Have gate, and past nothing else. */
  ignoreSprint: boolean;
  /** Whether nobody is there to answer the Should-Have prompt. */
  unattended: boolean;
}

/**
 * Read the gate's input off the process arguments.
 *
 * @param argv - the process arguments.
 * @returns what the caller asked.
 */
export const inputFrom = (argv: readonly string[]): GateInput => ({
  candidate: argv.includes('--candidate'),
  ignoreSprint: argv.includes('--ignore-sprint'),
  unattended: argv.includes('--unattended'),
});

/** What the gate answered. */
export interface Verdict {
  /** Whether the sprint permits the cut. */
  readonly pass: boolean;
  /** The rule that fired, or `''` on a pass. */
  readonly reason: string;
  /** The refusal's own sentence, or `''` on a pass. */
  readonly detail: string;
  /** Open Should Haves, which prompt rather than gate. */
  readonly openShoulds: readonly string[];
  /** Open Could Haves, which neither block nor prompt. */
  readonly openCoulds: readonly string[];
  /** Items whose plan was withdrawn, in every tier, named and never gating. */
  readonly withdrawn: readonly string[];
}

/**
 * Ask the domain for the sprint's verdict on a release.
 *
 * **A REFUSAL IS PRINTED, NOT SWALLOWED.** `must-haves-open` names every open
 * item, its sprint, whether it is merely undelivered or checked-but-not, and
 * what clears it. A caller reporting *"the sprint refuses"* would throw away
 * every part a person acts on.
 *
 * @param items - the governing items, across every sprint declaring a target.
 * @param input - how the caller answered the gate's escapes.
 * @returns the verdict.
 */
export const verdict = (
  items: readonly ReleaseSprintItem[],
  input: GateInput,
): Verdict => {
  const readings = {
    sprintItems: items,
    sprintFiles: {},
    deliveredPlans: [],
    // THE GATE PRECEDES THE VERSION, so none is given. `release` answers the
    // Must-Have gate before it reads this and refuses `version-underivable`
    // after — which is the step this bundle does not ask about.
    version: '',
    derivedBump: '',
    tagExists: false,
  };
  const outcome = release(readings, {
    candidate: input.candidate,
    ignoreSprint: input.ignoreSprint,
    unattended: input.unattended,
    // THE SHOULD-HAVE PROMPT IS THE OPERATOR'S, and the skill asks it: a bundle
    // answering it would be the tool deciding what it exists to put to a person.
    // `proceedOverShoulds` is therefore never given, so `should-haves-declined`
    // cannot fire here and the open Shoulds are reported instead.
    on: '',
  });

  // THE TIER REPORTS COME FROM THE WORKFLOW, not from a second filter here.
  // Two places counting one sprint is how a checkbox and an estate came to
  // disagree, and the workflow already reports all three lists — but only on a
  // path it decided. So they are read from a run posed as a CANDIDATE with a
  // version and a tag: that is the same rule with every gate ahead of the
  // reports satisfied, so it always decides and the reports are always there.
  const reported = release(
    { ...readings, version: 'v0.0.0', tagExists: true },
    { candidate: true, on: '' },
  ) as Decision<ReleaseDetail>;
  const { openShoulds, openCoulds, withdrawn } = reported.detail;

  // `must-haves-open` IS THE ONLY REFUSAL THIS GATE OWNS. The three below it —
  // `version-underivable`, `version-invalid`, `tag-absent` — belong to steps
  // this was not asked about, and a gate reporting one would refuse a release
  // the sprint permits. `should-haves-declined` cannot fire, for the reason
  // above.
  if (refused(outcome) && outcome.reason === 'must-haves-open') {
    return {
      pass: false,
      reason: outcome.reason,
      detail: outcome.detail,
      openShoulds,
      openCoulds,
      withdrawn,
    };
  }
  return { pass: true, reason: '', detail: '', openShoulds, openCoulds, withdrawn };
};

/**
 * Answer one gate: read the collector's report, ask the domain.
 *
 * @param text - the collector's report.
 * @param argv - the process arguments.
 * @returns the verdict.
 * @throws when the report is unreadable.
 */
export const answer = (text: string, argv: readonly string[]): Verdict =>
  verdict(itemsFrom(text), inputFrom(argv));

/**
 * Read stdin, print the verdict.
 *
 * The verdict goes to stdout as JSON, whole, for a caller reading the three
 * tier lists. A refusal's own SENTENCE also goes to stderr, because one a
 * person has to extract from a JSON field with `jq` is one they read second.
 *
 * Three exit codes rather than two, because the caller repairs them
 * differently: a refusal is the sprint's state and the operator reads the
 * reason, while an unreadable report is the caller's own bug and no operator
 * can act on it.
 *
 * @param text - the whole of stdin.
 * @param write - where the verdict goes.
 * @param argv - the process arguments.
 * @param warn - where a refusal's sentence goes.
 * @returns the process exit code — 0 permitted, 1 refused, 2 unreadable input.
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  argv: readonly string[] = [],
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  let answered: Verdict;
  try {
    answered = answer(text, argv);
  } catch (err) {
    warn(`plot-release-gate: ${(err as Error).message}\n`);
    return 2;
  }
  write(`${JSON.stringify(answered)}\n`);
  if (answered.pass) return 0;
  warn(`plot-release-gate: ${answered.reason} — ${answered.detail}\n`);
  return 1;
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8'), undefined, process.argv));
}
