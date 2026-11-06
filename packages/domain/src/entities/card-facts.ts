import { z } from 'zod';

import { ChecksSchema, MergeabilitySchema } from './pr.js';
import { SprintStateSchema } from './sprint.js';
import { StoryStatusSchema } from './story.js';
import { TokenCountsSchema } from './slice-spend.js';
import { PlanStatusSchema, PlanTypeSchema } from '../rules/phase.js';
import type { HostReach } from '../rules/branch-state.js';
import type { SpikeCardState } from '../rules/spike-confirm.js';
import type { TicketLane } from '../rules/ticket-lane.js';
import type { Verification } from '../rules/verification-record.js';
import type { StoryStanding } from '../transitions/story.js';

/** Holds only when `A` and `B` are the same type; a mismatch fails to compile. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same = <A, B>(proof: Same<A, B>): Same<A, B> => proof;

/** The kind of board item a card describes. */
// plot-state: classification — which item a card is about; an item never becomes another kind.
export const CardKindSchema = z.enum(['ticket', 'story', 'plan']);
export type CardKind = z.infer<typeof CardKindSchema>;

/** Why a fact was not read: {@link HostReach} without `ok`. */
// plot-state: reading — why one read went unanswered on one board build; the next build asks again.
export const UnknownReachSchema = z.enum(['unasked', 'throttled', 'secondary', 'failed']);
export type UnknownReach = z.infer<typeof UnknownReachSchema>;
same<UnknownReach, Exclude<HostReach, 'ok'>>(true);

/** {@link TicketLane} as a schema. */
// plot-state: reading — the lane a ticket rendered in on one board build, re-derived every build.
const TicketLaneSchema = z.enum(['open', 'in-progress', 'done', 'hidden']);
same<z.infer<typeof TicketLaneSchema>, TicketLane>(true);

/** {@link SpikeCardState} as a schema. */
// plot-state: reading — where a Design plan stands against its spike; every board build re-reads it.
export const SpikeCardStateSchema = z.enum(['spike-not-approved', 'spike-approved', 'spike-merged']);
same<z.infer<typeof SpikeCardStateSchema>, SpikeCardState>(true);

/** {@link StoryStanding} as a schema. */
// plot-state: reading — the standing a story's plans prove on one board build, re-derived every build.
const StoryStandingSchema = z.enum([...StoryStatusSchema.options, 'archived']);
same<z.infer<typeof StoryStandingSchema>, StoryStanding>(true);

/**
 * Another board item a card points at, with the phase of the kind it points at.
 */
export const RefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ticket'), key: z.string(), title: z.string(), lane: TicketLaneSchema }),
  /** `status: null` names a story no story file exists for; its `title` is then the slug. */
  z.object({
    kind: z.literal('story'), slug: z.string(), title: z.string(), status: StoryStatusSchema.nullable(), archived: z.boolean(),
  }),
  z.object({ kind: z.literal('plan'), slug: z.string(), title: z.string(), status: PlanStatusSchema }),
  /** `state: null` names a sprint no sprint file exists for; its `title` is then the slug. */
  z.object({ kind: z.literal('sprint'), slug: z.string(), title: z.string(), state: SprintStateSchema.nullable() }),
  z.object({ kind: z.literal('slice'), plan: z.string(), branch: z.string(), pr: z.number().nullable() }),
]);
export type Ref = z.infer<typeof RefSchema>;

/**
 * A fact that was read, or the reason it was not.
 *
 * @param value - the schema of the read value.
 * @returns `{ value }` or `{ unknown: <reach> }`.
 */
export const knownSchema = <T extends z.ZodType>(value: T) =>
  z.union([z.object({ value }).strict(), z.object({ unknown: UnknownReachSchema }).strict()]);
/** A fact that was read, or the reason it was not. */
export type Known<T> = { value: T } | { unknown: UnknownReach };

/** An action a card can offer. */
// plot-state: classification — the kinds of action a card offers; none is a step towards another.
export const ActionKindSchema = z.enum([
  'create-plan', 'create-story', 'add-plan',
  'needs-design', 'interrogate', 'approve', 'approve-spike', 'confirm-slices',
  'start-work', 'deliver',
]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

/** A lineage relation an unread fact can name. */
// plot-state: classification — which relation a reason names; one relation never becomes another.
const LineageRelationSchema = z.enum(['plans', 'stories']);

/** What a progress count counts. */
// plot-state: classification — the unit a count is in; a count never changes unit.
const WorkUnitSchema = z.enum(['slices', 'plans']);

/** What happened at an item's `ownership.since` date. */
// plot-state: classification — which record dated the item; each kind of item has its own.
const SinceEventSchema = z.enum(['opened', 'updated', 'transitioned']);

/** Why an action is disabled. */
export const ReasonSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('action-unavailable'), action: ActionKindSchema }),
  z.object({ kind: z.literal('awaiting-fleet-scan') }),
  z.object({ kind: z.literal('nothing-eligible'), waitsOn: z.array(RefSchema) }),
  z.object({ kind: z.literal('awaits-spike'), spike: RefSchema }),
  z.object({ kind: z.literal('linked-from-many-stories'), stories: z.array(RefSchema) }),
  z.object({
    kind: z.literal('lineage-unknown'), relation: LineageRelationSchema, reach: UnknownReachSchema,
  }),
]);
export type Reason = z.infer<typeof ReasonSchema>;

/**
 * One action. `reason` is non-null exactly when `enabled` is false; the schema
 * refuses either half alone.
 */
export const ActionSchema = z
  .object({ action: ActionKindSchema, enabled: z.boolean(), reason: ReasonSchema.nullable() })
  .refine((a) => a.enabled === (a.reason === null), { message: 'reason is set exactly when enabled is false' });
export type Action = z.infer<typeof ActionSchema>;

/** Something about the item a reader should notice before anything else. */
export const AlertSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status-behind'), proven: StoryStandingSchema }),
  z.object({ kind: z.literal('issue-link-unreadable'), value: z.string().max(120) }),
  /** `commits` is `null` where the unpushed commits were not counted. */
  z.object({ kind: z.literal('not-pushed'), commits: z.number().nullable() }),
]);
export type Alert = z.infer<typeof AlertSchema>;

/** {@link Verification} as a schema. */
// plot-state: reading — what a Delivered plan's verification record answered on one board build.
const VerificationSchema = z.enum(['unverified', 'supported', 'refuted', 'stale']);
same<z.infer<typeof VerificationSchema>, Verification>(true);

/** A Delivered plan's verification: its state and the refuted claims it holds. */
export const VerificationReadingSchema = z.object({ state: VerificationSchema, refuted: z.number() });
export type VerificationReading = z.infer<typeof VerificationReadingSchema>;

/**
 * What a plan's slices cost on this machine: the four counters summed over the
 * measured slices (`null` where none was), and how many slices were measured,
 * held nothing, or could not be read.
 */
export const CostReadingSchema = z.object({
  tokens: TokenCountsSchema.nullable(),
  measured: z.number(),
  absent: z.number(),
  unreadable: z.number(),
  fromRuns: z.number(),
  slices: z.number(),
});
export type CostReading = z.infer<typeof CostReadingSchema>;

/** One pull request of an item, with its own build reading and whether it merges cleanly. */
export const CardPrSchema = z.object({
  number: z.number(), branch: z.string(), checks: ChecksSchema, mergeable: MergeabilitySchema,
});
export type CardPrFact = z.infer<typeof CardPrSchema>;

/**
 * What is true about one board item, in five facets: `identity` (what it is),
 * `lineage` (what it is part of), `progress` (how far it is), `next` (what can
 * be done now) and `ownership` (whose, since when).
 *
 * Holds no generated words. Its string fields are identifiers, ISO dates and
 * content copied verbatim from the item (`title`, `summary`, `value`).
 */
export const CardFactsSchema = z.object({
  identity: z.object({
    kind: CardKindSchema,
    id: z.string(),
    key: z.string().nullable(),
    title: z.string(),
    summary: z.string().max(280).nullable(),
    type: PlanTypeSchema.nullable(),
    opens: RefSchema,
    alerts: z.array(AlertSchema),
  }),
  lineage: z.object({
    tickets: knownSchema(z.array(RefSchema)),
    stories: knownSchema(z.array(RefSchema)),
    plans: knownSchema(z.array(RefSchema)),
    sprints: knownSchema(z.array(RefSchema)),
  }),
  progress: z
    .object({
      work: z
        .object({ unit: WorkUnitSchema, done: knownSchema(z.number()), total: z.number() })
        .nullable(),
      prs: knownSchema(z.array(CardPrSchema)),
      design: z.object({ rounds: z.number().nullable(), spike: SpikeCardStateSchema.nullable() }).nullable(),
      verification: VerificationReadingSchema.nullable(),
      cost: knownSchema(CostReadingSchema),
    })
    .nullable(),
  next: z.object({
    primary: ActionSchema.nullable(),
    secondary: z.array(ActionSchema),
  }),
  ownership: z.object({
    owner: z.string().nullable(),
    since: z.object({ at: z.string(), event: SinceEventSchema }).nullable(),
    source: z.union([RefSchema, z.object({ path: z.string() })]),
  }),
});
export type CardFacts = z.infer<typeof CardFactsSchema>;
