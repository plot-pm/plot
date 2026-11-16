import { StoryStatusSchema, type Story, type StoryStatus } from '../entities/story.js';
import { unquoteScalar } from './story-record.js';
import type { EditResult } from './plan-record-edit.js';

/**
 * Reading a story file into the `Story` that `setStoryStatus` takes, and
 * writing the decision back into the file's front matter.
 *
 * Both run on the whole file's text and touch only the leading `---` block.
 * Neither reaches a filesystem.
 *
 * @concept story-status-edit
 */

/** Whether a line is a front-matter fence. */
const isFence = (line: string | undefined): boolean => line !== undefined && /^---\s*$/.test(line);

/** The index of the closing fence of a leading front-matter block, or -1 where there is none. */
const closingFence = (lines: readonly string[]): number => {
  if (!isFence(lines[0])) return -1;
  for (let i = 1; i < lines.length; i++) if (isFence(lines[i])) return i;
  return -1;
};

/** The value of a front-matter key, unquoted, with a trailing `# comment` dropped; `''` where the key is absent. */
const keyValue = (lines: readonly string[], end: number, key: string): string => {
  const pattern = new RegExp(`^${key}:[ \\t]*(.*)$`);
  for (let i = 1; i < end; i++) {
    const match = pattern.exec(lines[i]!);
    if (match !== null) return unquoteScalar(match[1]!.replace(/\s+#.*$/, '').trim());
  }
  return '';
};

/**
 * Reads a story file's front matter into a `Story`.
 *
 * @param content - the story file's text.
 * @param slug - the story's slug, from its directory name.
 * @param relPath - the file's path relative to the repository root.
 * @returns the story, or `null` where the file has no front matter or its
 *   `status:` is not one of the six statuses.
 */
export const storyOfContent = (content: string, slug: string, relPath: string): Story | null => {
  const lines = content.split('\n');
  const end = closingFence(lines);
  if (end === -1) return null;
  const status = StoryStatusSchema.safeParse(keyValue(lines, end, 'status'));
  if (!status.success) return null;
  const archived = keyValue(lines, end, 'archived');
  return {
    slug,
    title: keyValue(lines, end, 'title'),
    status: status.data,
    path: relPath,
    created: keyValue(lines, end, 'created'),
    updated: keyValue(lines, end, 'updated'),
    author: keyValue(lines, end, 'author'),
    archived: archived === '' ? null : archived,
  };
};

/**
 * Writes a status, and the archive date that travels with it, into a story's
 * front matter.
 *
 * Replaces the value of the existing `status:` line. Where `archived` is a
 * date, replaces the value of an existing `archived:` line, or inserts
 * `archived: <date>` directly after `status:`. Every other line stays
 * byte-identical.
 *
 * @param content - the story file's text.
 * @param status - the status to write.
 * @param archived - the `archived:` date to write, or `null` to leave that key alone.
 * @returns the edited content and `changed: true`; or the input and
 *   `changed: false` where the file has no front matter or no `status:` line.
 */
export const withStoryStatus = (content: string, status: StoryStatus, archived: string | null): EditResult => {
  const lines = content.split('\n');
  const end = closingFence(lines);
  if (end === -1) return { changed: false, content };
  const statusAt = lines.findIndex((line, i) => i > 0 && i < end && /^status:/.test(line));
  if (statusAt === -1) return { changed: false, content };

  const out = [...lines];
  out[statusAt] = `status: ${status}`;
  if (archived !== null) {
    const archivedAt = out.findIndex((line, i) => i > 0 && i < end && /^archived:/.test(line));
    if (archivedAt === -1) out.splice(statusAt + 1, 0, `archived: ${archived}`);
    else out[archivedAt] = `archived: ${archived}`;
  }
  const next = out.join('\n');
  return { changed: next !== content, content: next };
};

/**
 * The shape a story slug takes on the command line and in a request body: a
 * directory name with no path separator, so it cannot name a file outside the
 * story directory.
 */
export const STORY_STATUS_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
