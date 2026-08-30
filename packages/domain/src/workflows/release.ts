import type { ItemStatus, MoscowTier } from '../entities/sprint.js';
import { normalizeVersion } from '../entities/release.js';
import {
  type Outcome,
  type PlanPhaseWrite,
  type PlanRecordWrite,
  type SprintNoteWrite,
  type Write,
  decide,
  refuse,
} from './decision.js';

/**
 * Why `release` refused.
 *
 * FIXTURE-VERIFIED ONLY — transcribed from `skills/plot-release/SKILL.md`,
 * which has no exit code. See `EVIDENCE` in `./decision.js`.
 *
 * `must-haves-open` is the sprint gate, and it refuses in BOTH modes:
 * `PLOT_UNATTENDED` answers *may I ask?* and never *may I proceed?*.
 */
export type ReleaseRefusal =
  | 'must-haves-open'
  | 'should-haves-declined'
  | 'version-underivable'
  | 'version-invalid'
  | 'tag-absent';

/** One sprint item as the release gate reads it. */
export interface ReleaseSprintItem {
  /** The sprint that promised it — named, since two sprints may share a train. */
  sprint: string;
  /** Which commitment tier it sits in. */
  tier: MoscowTier;
  /** The plan it names. */
  plan: string;
  /** What the plan estate says actually happened. */
  status: ItemStatus;
}

/** A plan at `Phase: Delivered`, and the tag its work landed in. Step 5b. */
export interface ReleasePlanReading {
  /** The plan's slug. */
  slug: string;
  /** The plan file's path. */
  file: string;
  /** The plan's type — `docs` and `infra` are skipped. */
  type: string;
  /**
   * The release tag containing the plan's last merged PR, or `''`.
   *
   * Resolved from git by `--contains`, never from dates: the delivery date is
   * when the plan was booked and not when its code merged, and those can be
   * months apart.
   */
  tag: string;
  /** The `Released:` record as written, or `''`. */
  releasedRecord: string;
}

/** What `release` reads about the estate. */
export interface ReleaseReadings {
  /**
   * The sprint items governing this release.
   *
   * Empty where no active sprint declares a `Release:` target — the majority
   * case, in which the gate does not apply at all.
   */
  sprintItems: readonly ReleaseSprintItem[];
  /** The sprint files that would carry an override note, by sprint slug. */
  sprintFiles: Readonly<Record<string, string>>;
  /** The plans at `Phase: Delivered` this release would mark. */
  deliveredPlans: readonly ReleasePlanReading[];
  /**
   * The version to cut, as the caller gave it, or `''`.
   *
   * Empty means it must be derived from the delivered plans' types.
   */
  version: string;
  /** The bump the delivered plans imply, or `''` where they are inconclusive. */
  derivedBump: string;
  /** Whether the tag for this version already exists. */
  tagExists: boolean;
}

/** What `release` was asked to do. */
export interface ReleaseInput {
  /** Whether this cuts a release candidate rather than a release. */
  candidate?: boolean;
  /** The named escape past the Must-Have gate, and past nothing else. */
  ignoreSprint?: boolean;
  /** Whether a person is there to answer the Should-Have prompt. */
  unattended?: boolean;
  /** The answer to the Should-Have prompt, where one was given. */
  proceedOverShoulds?: boolean;
  /** The date to record, ISO-8601. */
  on: string;
}

/** What a release decided, beyond its writes. */
export interface ReleaseDetail {
  /** The version, canonically spelled. */
  version: string;
  /** The plans this run would mark Released. */
  marked: readonly string[];
  /** The plans it would not, each with the reason. */
  notMarked: readonly ReleaseSkip[];
  /** Open Should Haves that were reported rather than gating. */
  openShoulds: readonly string[];
  /** Open Could Haves, which neither block nor prompt. */
  openCoulds: readonly string[];
  /** Questions that were not asked because nobody was there. */
  unasked: readonly string[];
}

/** One delivered plan this release leaves alone, and why. */
export interface ReleaseSkip {
  /** The plan's slug. */
  slug: string;
  /**
   * Why it stays where it is.
   *
   * `docs-live-on-merge` — /plot-deliver already told its author it was live,
   * and marking it Released contradicts a message Plot itself sends.
   * `unresolvable` — no annotation or no merge commit, so no version can be
   * resolved, and an invented one is a claim nobody re-checks.
   * `already-released` — the idempotent case.
   */
  reason: 'docs-live-on-merge' | 'unresolvable' | 'already-released';
}

/**
 * Decides what cutting a release would write.
 *
 * FIXTURE-VERIFIED ONLY. Transcribed from `skills/plot-release/SKILL.md` —
 * nine numbered steps, fifteen refusal statements, four `PLOT-UNASKED` shapes.
 *
 * The gate applies to the final cut and not to a candidate: an RC is how a
 * sprint's remaining work gets verified, so gating it would take away the tool
 * operators use to finish the very items being gated on. The skill marks that
 * reading as unsettled by its own plan, and it is carried here unchanged
 * rather than re-decided.
 *
 * Steps 4's mechanics — the changelog, the bump, the tag, the push — belong to
 * the project's own release process and are deliberately absent from the
 * writes: Plot's job ends with the cross-check, and this workflow's writes are
 * step 5b's plan records and step 5c's sprint note.
 *
 * @param readings - what the adapters measured about the sprint and the plans.
 * @param input - the version to cut and how the gate was answered.
 * @returns a decision naming every write, or a refusal naming the rule that
 *   fired: `must-haves-open`, `should-haves-declined`, `version-underivable`,
 *   `version-invalid` or `tag-absent`.
 */
export const release = (
  readings: ReleaseReadings,
  input: ReleaseInput,
): Outcome<ReleaseDetail, ReleaseRefusal> => {
  const no = (reason: ReleaseRefusal, detail: string) => refuse('release', reason, detail);
  const unasked: string[] = [];
  const candidate = input.candidate === true;

  const unfinished = (tier: MoscowTier) =>
    readings.sprintItems.filter((i) => i.tier === tier && i.status !== 'done');

  // Step 0 — the sprint gate. Run before anything else, because a release that
  // has been tagged cannot be un-cut and refusing is only cheap while it is
  // still ahead.
  const openMusts = unfinished('must');
  if (!candidate && !input.ignoreSprint && openMusts.length > 0) {
    const named = openMusts
      .map((i) => `[${i.plan}] — ${i.status === 'disputed' ? 'checked in the sprint, but the plan is not delivered' : 'not delivered'} (sprint ${i.sprint})`)
      .join('; ');
    return no(
      'must-haves-open',
      `${openMusts.length} unfinished Must Have(s): ${named}. Deliver them, move them to Deferred, or pass --ignore-sprint.`,
    );
  }

  const openShoulds = unfinished('should');
  if (!candidate && openShoulds.length > 0) {
    if (input.unattended) {
      // The prompt becomes a warning, never a refusal: nobody was asked, and
      // that is stated rather than hidden.
      unasked.push(
        `PLOT-UNASKED: Cut over ${openShoulds.length} open Should Have(s)? — default — proceeded; the items are listed`,
      );
    } else if (input.proceedOverShoulds === false) {
      // Answering no cuts nothing, changing no files.
      return no(
        'should-haves-declined',
        `${openShoulds.length} Should Have(s) are open and the cut was declined — nothing was changed.`,
      );
    }
  }

  // Step 1 — the version. There is no safe default for a version number:
  // guessing one tags a repository permanently.
  let version = normalizeVersion(readings.version);
  if (version === '') {
    if (readings.derivedBump === '') {
      return no(
        'version-underivable',
        'PLOT-UNASKED: What version should this release be? — stopped — plan types were inconclusive; nothing tagged',
      );
    }
    return no(
      'version-underivable',
      `no version was given; the delivered plans imply a '${readings.derivedBump}' bump, which needs confirming before anything is tagged.`,
    );
  }
  if (!isSemver(version)) {
    return no('version-invalid', `'${readings.version}' is not a valid version.`);
  }

  // Step 5b — only once the tag exists. A plan marked before it is cut claims a
  // version nobody released.
  if (!readings.tagExists) {
    return no(
      'tag-absent',
      `tag ${version} does not exist yet — hand off to the project's release process first, then record the release.`,
    );
  }

  // Typed to the three writes this workflow makes before its commit, all of
  // which land in a file. The commit stages them by reading `file` off each,
  // and this type is what makes that total rather than guarded — a write with
  // no file cannot be pushed here without a type error.
  const writes: (PlanPhaseWrite | PlanRecordWrite | SprintNoteWrite)[] = [];
  const marked: string[] = [];
  const notMarked: ReleaseSkip[] = [];

  for (const plan of readings.deliveredPlans) {
    if (plan.type === 'docs' || plan.type === 'infra') {
      notMarked.push({ slug: plan.slug, reason: 'docs-live-on-merge' });
      continue;
    }
    if (plan.tag === '') {
      notMarked.push({ slug: plan.slug, reason: 'unresolvable' });
      continue;
    }
    if (plan.releasedRecord.trim() !== '') {
      notMarked.push({ slug: plan.slug, reason: 'already-released' });
      continue;
    }
    marked.push(plan.slug);
    writes.push({ kind: 'plan-phase', file: plan.file, phase: 'Released' });
    writes.push({
      kind: 'plan-record',
      file: plan.file,
      field: 'Released',
      // The version each plan's own work landed in, which is not necessarily
      // the one being cut: a plan delivered two releases ago resolves to its.
      value: `${input.on}, ${normalizeVersion(plan.tag)}`,
    });
    // THE SYMLINK DOES NOT MOVE. `delivered/` means no longer active rather
    // than phase is exactly Delivered — unlike /plot-deliver, this moves
    // nothing.
  }

  // Step 5c — the override note, written now rather than at the gate: until the
  // tag exists a note claiming a version is the same defect step 5b guards
  // against.
  if (input.ignoreSprint === true && openMusts.length > 0) {
    for (const sprint of new Set(openMusts.map((i) => i.sprint))) {
      const file = readings.sprintFiles[sprint];
      if (file === undefined || file === '') continue;
      const items = openMusts.filter((i) => i.sprint === sprint).map((i) => `[${i.plan}]`).join(', ');
      writes.push({
        kind: 'sprint-note',
        file,
        note: `${version} cut ${input.on} with \`--ignore-sprint\`; ${openMusts.filter((i) => i.sprint === sprint).length} Must Have open: ${items}`,
      });
    }
  }

  const tail: Write[] = [];
  if (writes.length > 0) {
    tail.push({
      kind: 'commit',
      message: `plot: record ${version}`,
      // Read off the writes rather than re-derived: a path list built a second
      // way is one that can name a file no write touched.
      paths: writes.map((w) => w.file),
    });
    tail.push({ kind: 'push', branch: `plot/release-${version}`, onto: 'default' });
  }

  return decide('release', [...writes, ...tail], {
    version,
    marked,
    notMarked,
    openShoulds: openShoulds.map((i) => i.plan),
    openCoulds: unfinished('could').map((i) => i.plan),
    unasked,
  });
};

/**
 * Whether a version is one this workflow will act on.
 *
 * @param version - the version, already normalized to its `v` prefix.
 * @returns true for `vN.N.N`, with or without a pre-release suffix.
 */
const isSemver = (version: string): boolean => /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version);
