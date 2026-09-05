import { type Story, type StoryStatus, storyIsDone } from '../entities/story.js';

/*
 * THE VERBS CARRY THE ENTITY NAME — `setStoryStatus`, not `setStatus`.
 *
 * `transitions/plan.ts` names its verbs `approve`, `deliver`, `release` and the
 * barrel aliases them, because `workflows/` declares the same three and one of
 * the two must be renamed where both are in scope. That collision is what
 * excuses the alias: `scripts/count-domain-aliases.sh` counts a renaming
 * re-export whose original name is declared by exactly ONE module, and holds
 * the total at zero.
 *
 * A story's verbs collide with nothing today, so an alias on them would be a
 * name somebody chose to preserve — the residue that gate exists to refuse.
 * They also would not stay uncollided: `archive`, `settable` and `setStatus`
 * are exactly the words the agent, worktree and slice lifecycles behind this
 * slice will reach for.
 *
 * The TYPES do not follow that rule. `Decision`, `Refusal`, `Precondition`,
 * `RefusalReason` and `TransitionResult` are declared by `transitions/plan.ts`
 * too, so they genuinely collide and the barrel disambiguates them there — the
 * shape the gate already ignores, and the one `plan.ts` established.
 */

/**
 * What a story's status can be once `archived` is derived beside it.
 *
 * The six are what a person writes; `archived` is what the plans say. Keeping
 * them in ONE union and out of `StoryStatusSchema` is the whole point of this
 * file: `entities/story.ts:3` says the six are *"written by a person, never
 * derived"*, and a seventh value in that enum would make a derived answer
 * storable. Measured 2026-09-04, that is exactly what happened — the board's
 * `deriveStoryStatus` returned `'archived'` against a `string` return type, so
 * neither the domain's six nor the board's hand-copied six objected.
 */
export type StoryStanding = StoryStatus | 'archived';

/**
 * The six statuses, in the order `DESIGN-story.md` §4 draws them.
 *
 * Re-exported as a value because a renderer groups by status and needs the
 * order; `StoryStatusSchema.options` carries the same six and is the source.
 */
export const STORY_LIFECYCLE: readonly StoryStatus[] = [
  'draft',
  'ready',
  'active',
  'in-review',
  'paused',
  'done',
];

/**
 * Which statuses each status may become.
 *
 * Transcribed from `diagrams/story-lifecycle.mmd`, which is the spec's own
 * source for §4's diagram. A status not listed here is not reachable from the
 * key, and {@link setStoryStatus} refuses it.
 *
 * `done` leads nowhere: the exit from `done` is the archival — a date plus a
 * directory move — and not another status.
 */
const NEXT: Readonly<Record<StoryStatus, readonly StoryStatus[]>> = {
  draft: ['ready'],
  ready: ['active', 'paused'],
  active: ['in-review', 'paused', 'done'],
  'in-review': ['done'],
  paused: ['active'],
  done: [],
};

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape `transitions/plan.ts` uses, and for the same reason: a story
 * lives in a file on disk, and the domain reaches nothing.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a story transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'status-unrecognised'
  | 'status-terminal'
  | 'status-unreachable'
  | 'status-unchanged'
  | 'archive-not-done'
  | 'archive-date-missing'
  | 'archive-already'
  | 'precondition-unmet';

/**
 * A refused transition, naming which gate fired.
 *
 * @see RefusalReason for the gates.
 */
export interface Refusal {
  readonly outcome: 'refused';
  /** Which gate fired — branched on rather than matched as prose. */
  readonly reason: RefusalReason;
  /** The story the refusal is about. */
  readonly slug: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that should happen: the status to write, and the archive date
 * that must be written with it.
 *
 * `archived` and `status` travel together for the reason `transitions/plan.ts`
 * gives about a phase and its record: archiving is two writes that must agree
 * (`archivalIsConsistent`), and a decision carrying only one of them is the
 * half-archived story `plot-story-lint.sh` reports as S3.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The story to write to. */
  readonly slug: string;
  /** The status to write to frontmatter. */
  readonly status: StoryStatus;
  /** The `archived:` date to write, or `null` where the story keeps none. */
  readonly archived: string | null;
  /** Whether the story already carries this status and date, leaving nothing to write. */
  readonly alreadyRecorded: boolean;
}

/** What a story transition answers: the write it decided on, or the gate that stopped it. */
export type TransitionResult = Decision | Refusal;

/**
 * Narrows a result to a decided transition.
 *
 * @param result - the result to test.
 * @returns true when the transition decided on a write.
 */
export const isDecision = (result: TransitionResult): result is Decision =>
  result.outcome === 'decided';

/**
 * Narrows a result to a refusal.
 *
 * @param result - the result to test.
 * @returns true when a gate stopped the transition.
 */
export const isRefusal = (result: TransitionResult): result is Refusal =>
  result.outcome === 'refused';

const refuse = (slug: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  slug,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param slug - the story the readings are about.
 * @param preconditions - the readings a caller supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (slug: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    slug,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

const known = (status: string): status is StoryStatus =>
  (STORY_LIFECYCLE as readonly string[]).includes(status);

/** What `setStoryStatus` needs beyond the story. */
export interface SetStoryStatusInput {
  /** The status to move to. */
  to: string;
  /** The date to record where the move is to `done`, ISO-8601. */
  on?: string;
  /** Readings a caller measured, such as whether the story file is writable. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a story may move to a given status.
 *
 * Callable alone, because a board must know whether to offer the move before
 * anyone takes it. It is not a permission: {@link setStoryStatus} re-checks, because
 * a caller that asked is indistinguishable from one that did not.
 *
 * @param story - the story to test.
 * @param to - the status it would move to.
 * @returns true when the mechanical gates would pass.
 */
export const storyStatusSettable = (story: Story, to: string): boolean =>
  !isRefusal(setStoryStatus(story, { to, on: '0000-00-00' }));

/**
 * Decides the write that moving a story to a status calls for.
 *
 * The legal moves are `DESIGN-story.md` §4's graph, transcribed into
 * {@link NEXT}. Anything else refuses — including a move to the status the
 * story already holds, which is a no-op a caller should not be writing a file
 * for.
 *
 * Moving to `done` is the archival, so it carries the `archived:` date: the two
 * writes must agree, and a decision that could carry one without the other
 * would let a caller produce the half-archived story the lint reports as S3.
 *
 * @param story - the story to move.
 * @param input - the status to move to, the date for an archival, plus any readings.
 * @returns a decision carrying the status and its archive date, or a refusal
 *   naming the gate that fired: `status-unrecognised`, `status-terminal`,
 *   `status-unreachable`, `status-unchanged`, `archive-date-missing` or
 *   `precondition-unmet`.
 */
export const setStoryStatus = (story: Story, input: SetStoryStatusInput): TransitionResult => {
  if (!known(input.to)) {
    return refuse(
      story.slug,
      'status-unrecognised',
      `'${input.to}' is not a story status — the six are ${STORY_LIFECYCLE.join(', ')}.`,
    );
  }
  const to: StoryStatus = input.to;

  if (story.status === to) {
    return refuse(
      story.slug,
      'status-unchanged',
      `story '${story.slug}' is already '${to}' — nothing to move.`,
    );
  }

  if (storyIsDone(story)) {
    return refuse(
      story.slug,
      'status-terminal',
      `story '${story.slug}' is done — the exit from done is the archival, not another status.`,
    );
  }

  if (!NEXT[story.status].includes(to)) {
    return refuse(
      story.slug,
      'status-unreachable',
      // Every status reaching here has a non-empty edge list: `done` is the
      // one with none, and `status-terminal` above already refused it.
      `story '${story.slug}' cannot go '${story.status}' -> '${to}' — from '${story.status}' it may become ${NEXT[
        story.status
      ].join(' or ')}.`,
    );
  }

  const archived = to === 'done' ? (input.on ?? '').trim() : '';
  if (to === 'done' && archived === '') {
    return refuse(
      story.slug,
      'archive-date-missing',
      `story '${story.slug}' cannot become done without an archive date — done and 'archived:' are two writes that must agree.`,
    );
  }

  const blocked = unmet(story.slug, input.preconditions ?? []);
  if (blocked) return blocked;

  return {
    outcome: 'decided',
    slug: story.slug,
    status: to,
    archived: to === 'done' ? archived : null,
    alreadyRecorded: false,
  };
};

/** What `archiveStory` needs beyond the story. */
export interface ArchiveStoryInput {
  /** The date to record, ISO-8601. */
  on: string;
  /** Readings a caller measured, such as whether the `archived/` home exists. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a story is in a state where Archive should be offered.
 *
 * Callable alone; {@link archiveStory} re-checks regardless.
 *
 * @param story - the story to test.
 * @returns true when the mechanical gates would pass.
 */
export const storyArchivable = (story: Story): boolean =>
  !isRefusal(archiveStory(story, { on: '0000-00-00' }));

/**
 * Decides the write that archiving a story calls for.
 *
 * Archiving is the second half of `done`: the date, and the directory move to
 * `archived/`. The move is the caller's — the domain reaches no filesystem —
 * and the decision says which date belongs beside the status.
 *
 * A story already carrying both is refused rather than treated as idempotent,
 * which is where this differs from `transitions/plan.ts`. A plan's record is
 * repairable because its phase and its `Approved:` line are written separately
 * and one can be lost; a story's archival is one act, and re-running it over an
 * existing date would replace the day the knowledge was closed with today.
 *
 * @param story - the story to archive.
 * @param input - the date to record, plus any readings.
 * @returns a decision carrying `done` and its archive date, or a refusal naming
 *   the gate that fired: `archive-not-done`, `archive-already`,
 *   `archive-date-missing` or `precondition-unmet`.
 */
export const archiveStory = (story: Story, input: ArchiveStoryInput): TransitionResult => {
  if (!storyIsDone(story)) {
    return refuse(
      story.slug,
      'archive-not-done',
      `story '${story.slug}' is '${story.status}' — only a done story is archived.`,
    );
  }

  if (story.archived !== null) {
    return refuse(
      story.slug,
      'archive-already',
      `story '${story.slug}' was archived on ${story.archived} — refusing to overwrite the date it closed.`,
    );
  }

  const on = input.on.trim();
  if (on === '') {
    return refuse(
      story.slug,
      'archive-date-missing',
      `story '${story.slug}' cannot be archived without a date — an archival nobody can place is not one.`,
    );
  }

  const blocked = unmet(story.slug, input.preconditions ?? []);
  if (blocked) return blocked;

  return {
    outcome: 'decided',
    slug: story.slug,
    status: 'done',
    archived: on,
    alreadyRecorded: false,
  };
};

/**
 * A plan's state as this rule reads it — the spelling `plot-plan-meta.sh`
 * emits, lower-cased. The field is named `phase` because the wire key is.
 *
 * Taken as a reading rather than as the domain's `PlanState` type so a caller
 * holding the board's plan records passes them unchanged; an unrecognised
 * spelling is representable and counts as *not released*, which is the safe
 * direction: it can only hold a story back from `archived`.
 */
export interface StoryPlanReading {
  /** The plan's state, as the parser normalized it. */
  phase: string;
}

/**
 * What a story's plans say its standing is.
 *
 * **THIS IS THE ONE PLACE `archived` IS COMPUTED.** It was computed inline at
 * `board.ts:1393` against a `string` return type, which is how a seventh status
 * came to exist that neither the domain's six nor the board's hand-copied six
 * admitted. The board now reads this answer rather than deriving a second one.
 *
 * The declared status is the fallback, never the override: a story's status is
 * written by a person and no mechanism can observe what the humans are doing,
 * so this reports only what the plans prove — every plan released is an
 * archived story, every plan delivered is a done one, an approved plan is an
 * active one — and hands back the person's word for everything else.
 *
 * @param declared - the status the story's frontmatter carries.
 * @param plans - the phases of the plans naming this story.
 * @returns the standing the plans support, or the declared status where they
 *   support none.
 */
export const derivedStanding = (
  declared: StoryStatus,
  plans: readonly StoryPlanReading[],
): StoryStanding => {
  if (plans.length === 0) return declared;

  const phases = plans.map((p) => p.phase.toLowerCase());
  if (phases.every((p) => p === 'released')) return 'archived';
  if (phases.every((p) => p === 'released' || p === 'delivered')) return 'done';
  if (phases.some((p) => p === 'approved')) return 'active';
  return declared;
};
