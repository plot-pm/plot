import { z } from 'zod';

/**
 * What the humans are doing about the knowledge a story holds.
 *
 * Written by a person, never derived: no mechanism can observe whether
 * knowledge is still being added to, so a story whose plans have all delivered
 * may still be `active`.
 */
export const StoryStatusSchema = z.enum(['draft', 'ready', 'active', 'in-review', 'paused', 'done']);
export type StoryStatus = z.infer<typeof StoryStatusSchema>;

/**
 * An umbrella of knowledge spanning several plans.
 *
 * Identity: a slug — the directory name, which fails by collision. State:
 * stated in the file's frontmatter, so it can be wrong and can go stale with
 * nothing detecting it.
 *
 * This type is what a board needs to know about a story, not the story: a
 * story's value is its prose, and any consumer needing that reads the file.
 */
export interface Story {
  /** The directory name — the identity. */
  slug: string;
  /** The story's title, from frontmatter. */
  title: string;
  /** What the humans are doing about it. */
  status: StoryStatus;
  /** `<slug>/STORY-<slug>.md`; `''` when the file was not found. */
  path: string;
  /** When it was created, ISO-8601. */
  created: string;
  /** When it was last updated, ISO-8601 — the only field saying whether it is being worked on. */
  updated: string;
  /** Who authored it. */
  author: string;
  /** When it was archived, ISO-8601; null unless done. */
  archived: string | null;
}

/**
 * Reads the tracker key a slug may carry.
 *
 * A slug may be written `{TICKET-ID}-{name}`, which is the only link from a
 * story to an issue that exists today.
 *
 * @param slug - the story's slug.
 * @returns the ticket key, or `''` when the slug carries none.
 */
export const trackerKeyOf = (slug: string): string => {
  const match = /^([A-Z][A-Z0-9]+-\d+)-/.exec(slug);
  return match === null ? '' : match[1];
};

/**
 * Whether a story is finished with.
 *
 * @param story - the story to test.
 * @returns true when its status is `done`.
 */
export const storyIsDone = (story: Story): boolean => story.status === 'done';

/**
 * Whether a story's archival is recorded consistently.
 *
 * Archiving is two writes that must agree — `status: done` and an `archived:`
 * date — so either alone is a half-archived story rather than an archived one.
 *
 * @param story - the story to test.
 * @returns true when both writes agree, or neither has happened.
 */
export const archivalIsConsistent = (story: Story): boolean =>
  storyIsDone(story) === (story.archived !== null);
