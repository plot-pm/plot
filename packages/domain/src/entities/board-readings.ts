import { z } from 'zod';

import { MoscowTierSchema } from './sprint.js';

/** One member line of a sprint file, as `sprintRecordOf` reads it. */
export const SprintMemberRecordSchema = z.object({
  /** The plan slug the line links, or `''` for a bare item. */
  slug: z.string(),
  /** The line's text after the checkbox and the link. */
  text: z.string(),
  tier: MoscowTierSchema,
  checked: z.boolean(),
});
export type SprintMemberRecord = z.infer<typeof SprintMemberRecordSchema>;

/** One sprint file, as `sprintRecordOf` reads it. */
export const SprintRecordSchema = z.object({
  slug: z.string(),
  title: z.string(),
  /** The stated `State:` (or legacy `Phase:`), or `UNKNOWN` where the domain does not admit it. */
  phase: z.string(),
  release: z.string(),
  goal: z.string(),
  start: z.string(),
  end: z.string(),
  members: z.array(SprintMemberRecordSchema).readonly(),
});
export type SprintRecord = z.infer<typeof SprintRecordSchema>;

/** The sprint files under `<Sprint directory>/active/` on the default branch, each by its path. */
export const SprintsValueSchema = z.array(z.object({ path: z.string(), sprint: SprintRecordSchema })).readonly();
export type SprintsValue = z.infer<typeof SprintsValueSchema>;

/** One story file, as `storyRecordOf` reads it. */
export const StoryRecordSchema = z.object({
  slug: z.string(),
  title: z.string(),
  /** The declared `status:`, `UNKNOWN` where the domain does not admit it, or `''` where none is declared. */
  status: z.string(),
  declaredStatus: z.string(),
  issue: z.string(),
  author: z.string(),
  created: z.string(),
  updated: z.string(),
  objective: z.string(),
  design: z.string(),
  /** The story file's path, relative to the repository root. */
  path: z.string(),
  /** The `DESIGN-*.md` basenames beside the story file, in name order. */
  designDocs: z.array(z.string()).readonly(),
  hasOpenPoints: z.boolean(),
  hasSessionLog: z.boolean(),
});
export type StoryRecord = z.infer<typeof StoryRecordSchema>;

/** The story files under `<Story directory>` on the default branch: the live ones and those under `archived/`. */
export const StoriesValueSchema = z.object({
  live: z.array(StoryRecordSchema).readonly(),
  archived: z.array(StoryRecordSchema).readonly(),
});
export type StoriesValue = z.infer<typeof StoriesValueSchema>;

/** What `verificationOf` and `refutedClaims` read from one Delivered plan, and the commit its `Delivered:` record was written in. */
export const DeliveredInputSchema = z.object({
  /** The claim lines of the plan's `## Verification` section, as `verificationClaimLines` reads them. */
  claimLines: z.array(z.string()).readonly(),
  /** The commit that wrote the `Delivered:` record, or null where the history names none. */
  deliveryCommit: z.string().nullable(),
});
export type DeliveredInput = z.infer<typeof DeliveredInputSchema>;

/**
 * Builds the schema of one answer inside a reading's value: `read` with the
 * value, or `failed` with a reason. It carries no read time, so an unchanged
 * answer leaves the reading's content unchanged.
 *
 * @param value - the schema of the value a `read` answer holds.
 * @returns the answer schema.
 */
export const answerSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('state', [
    z.object({ state: z.literal('read'), value }),
    z.object({ state: z.literal('failed'), reason: z.string().min(1) }),
  ]);
